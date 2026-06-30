const { app, BrowserWindow, Menu, MenuItem, Tray, ipcMain, nativeImage, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.DASHBOARD_PORT || process.env.PORT || 8787);
const HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
let DATA_DIR = null;
let WINDOW_STATE_FILE = null;

const DASHBOARD_URL = `http://${HOST}:${PORT}`;
const DASHBOARD_PATH = process.env.DASHBOARD_PATH || '/desktop';
const HEALTH_URL = `${DASHBOARD_URL}/api/usage`;
const ERROR_PAGE = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Usage Dashboard unavailable</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; }
    body { display: grid; place-items: center; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #0b0f16; color: #edf1fa; }
    .card { width: min(520px, calc(100% - 48px)); padding: 20px; border-radius: 16px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 20px 45px rgba(0,0,0,.45); }
    button { margin-top: 12px; border: 0; padding: 10px 14px; border-radius: 10px; color: #f2f4fc; background: #2d68ff; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h2 style="margin: 0 0 8px 0;">Usage dashboard is not responding</h2>
    <p style="margin: 0; color: #b5bed7; line-height: 1.5">
      本地服务未在规定时间启动，请稍后重试。可先点 Reload。
    </p>
    <div>
      <button onclick="location.reload()">Reload</button>
    </div>
  </div>
</body>
</html>
`;

let serverProcess = null;
let serverOwned = false;
let mainWindow = null;
let isAlwaysOnTop = true;
let dragState = null;
let tray = null;
let isQuitting = false;

const DEFAULT_WIDTH = 364;
const DEFAULT_HEIGHT = 424;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildErrorPageUrl() {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(ERROR_PAGE);
}

async function isDashboardReady() {
  try {
    const res = await fetch(HEALTH_URL, { cache: 'no-store' });
    return res.ok;
  } catch (error) {
    return false;
  }
}

async function waitDashboardReady(timeoutMs = 8000) {
  const endAt = Date.now() + timeoutMs;
  while (Date.now() < endAt) {
    if (await isDashboardReady()) return true;
    await sleep(250);
  }
  return false;
}

function ensureStateDir() {
  if (!DATA_DIR || !WINDOW_STATE_FILE) {
    DATA_DIR = app.getPath('userData');
    WINDOW_STATE_FILE = path.join(DATA_DIR, 'window-state.json');
  }

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (error) {
    console.warn('[dashboard-desktop] cannot create state dir:', error.message);
  }
}

function loadWindowState() {
  try {
    if (!WINDOW_STATE_FILE || !fs.existsSync(WINDOW_STATE_FILE)) return null;
    const raw = fs.readFileSync(WINDOW_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      !parsed
      || typeof parsed.x !== 'number'
      || typeof parsed.y !== 'number'
      || typeof parsed.width !== 'number'
      || typeof parsed.height !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveWindowState(bounds) {
  if (!bounds) return;
  try {
    ensureStateDir();
    fs.writeFileSync(
      WINDOW_STATE_FILE,
      JSON.stringify({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        alwaysOnTop: isAlwaysOnTop,
      }, null, 2),
      'utf8',
    );
  } catch (error) {
    console.warn('[dashboard-desktop] save window state failed:', error.message);
  }
}

function clampToScreen(bounds) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.min(Math.max(area.x, bounds.x), Math.max(area.x, area.width + area.x - bounds.width)),
    y: Math.min(Math.max(area.y, bounds.y), Math.max(area.y, area.height + area.y - bounds.height)),
    width: bounds.width,
    height: bounds.height,
  };
}

function buildInitialWindowBounds() {
  const saved = loadWindowState();
  const area = screen.getPrimaryDisplay().workArea;
  if (saved) {
    isAlwaysOnTop = saved.alwaysOnTop !== false;
    return clampToScreen({
      x: saved.x,
      y: saved.y,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
  }

  return {
    x: Math.floor(area.x + area.width - DEFAULT_WIDTH - 24),
    y: Math.floor(area.y + area.height - DEFAULT_HEIGHT - 24),
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
}

async function detectServerRunning() {
  return isDashboardReady();
}

function spawnServer() {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST,
      NODE_NO_WARNINGS: '1',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  child.on('error', (error) => {
    console.error('[dashboard-desktop] server spawn failed:', error.message);
  });

  child.on('exit', (code, signal) => {
    console.log('[dashboard-desktop] server exited:', code, signal);
    if (mainWindow && mainWindow.webContents && mainWindow.webContents.isLoadingMainFrame()) {
      mainWindow.webContents.loadURL(buildErrorPageUrl());
    }
  });

  return child;
}

async function ensureServer() {
  if (await detectServerRunning()) {
    serverOwned = false;
    return true;
  }

  if (!serverProcess) {
    console.log('[dashboard-desktop] starting local server...');
    serverProcess = spawnServer();
    serverOwned = true;
  }

  const ok = await waitDashboardReady(12000);
  if (!ok) {
    console.error('[dashboard-desktop] server startup timeout');
  }
  return ok;
}

function bindWindowStatePersistence(window) {
  let timer = null;
  const persist = () => {
    if (window && !window.isDestroyed()) {
      const bounds = window.getBounds();
      saveWindowState(bounds);
    }
  };

  const schedulePersist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, 200);
  };

  window.on('moved', schedulePersist);
  window.on('resized', schedulePersist);
  window.on('close', persist);
}

function bindDragIpc() {
  ipcMain.on('hud-drag-begin', (event, point) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed() || !point) return;
    dragState = {
      window,
      startX: Number(point.x),
      startY: Number(point.y),
      bounds: window.getBounds(),
    };
  });

  ipcMain.on('hud-drag-move', (event, point) => {
    if (!dragState || dragState.window.isDestroyed() || !point) return;
    const nextX = Number(point.x);
    const nextY = Number(point.y);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
    dragState.window.setBounds({
      ...dragState.bounds,
      x: Math.round(dragState.bounds.x + nextX - dragState.startX),
      y: Math.round(dragState.bounds.y + nextY - dragState.startY),
    });
  });

  ipcMain.on('hud-drag-end', () => {
    if (dragState && dragState.window && !dragState.window.isDestroyed()) {
      saveWindowState(dragState.window.getBounds());
    }
    dragState = null;
  });
}

function setTopMost(window) {
  isAlwaysOnTop = true;
  if (!window || window.isDestroyed()) return;
  window.setAlwaysOnTop(true, 'screen-saver');
}

function applyTopMost(window, value) {
  isAlwaysOnTop = Boolean(value);
  if (!window || window.isDestroyed()) return;
  window.setAlwaysOnTop(isAlwaysOnTop, 'screen-saver');
  rebuildTrayMenu();
}

function buildTrayIcon() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray.ico');
  const pngPath = path.join(__dirname, '..', 'assets', 'tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) return icon;

  const png = nativeImage.createFromPath(pngPath);
  if (!png.isEmpty()) return png;

  return nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAfElEQVR4Ae3XsQmAMAwF0S6RKuQ+KXsHOVskuydCuohkqWQO0iUgQf5+9xL8z/g0G87JuVdiKcslJpzw7XBlxKnAoIGneZNBpzgkKNAeMwpYHI5o0HwJVAhX0EFrAaBmhGuFmJqew7UCim8V4a86JoJ0bENQq4GkqN+Vq7wAi7E+gUJpB8oAAAAASUVORK5CYII=');
}

function showWindow() {
  revealWindow(mainWindow);
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  saveWindowState(mainWindow.getBounds());
  mainWindow.hide();
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) {
    hideWindow();
  } else {
    showWindow();
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: mainWindow && mainWindow.isVisible() ? '隐藏浮窗' : '显示浮窗',
      click: toggleWindow,
    },
    {
      label: '重载',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload();
          showWindow();
        }
      },
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: isAlwaysOnTop,
      click: (menuItem) => applyTopMost(mainWindow, menuItem.checked),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]));
}

function ensureTray() {
  if (tray) return;
  tray = new Tray(buildTrayIcon());
  tray.setToolTip('Usage Watch - Claude / Codex / Antigravity');
  tray.on('click', toggleWindow);
  tray.on('double-click', showWindow);
  rebuildTrayMenu();
}

function attachContextMenu(window) {
  const menu = Menu.buildFromTemplate([
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: isAlwaysOnTop,
      click: (menuItem) => applyTopMost(window, menuItem.checked),
    },
    { type: 'separator' },
    {
      label: '重载',
      accelerator: 'CmdOrCtrl+R',
      click: () => window && !window.isDestroyed() && window.reload(),
    },
    {
      label: '打开开发者工具',
      accelerator: 'F12',
      click: () => {
        if (!window || window.isDestroyed()) return;
        if (window.webContents.isDevToolsOpened()) {
          window.webContents.closeDevTools();
        } else {
          window.webContents.openDevTools({ mode: 'detach' });
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      accelerator: 'Alt+F4',
      click: () => app.quit(),
    },
  ]);

  window.webContents.on('context-menu', (event) => {
    menu.popup({ window });
    event.preventDefault();
  });
}

function makeSimpleMenu() {
  const menu = new Menu();
  menu.append(new MenuItem({
    label: 'File',
    submenu: [
      {
        label: 'Reload',
        accelerator: 'F5',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.reload();
          }
        },
      },
      {
        label: 'Toggle DevTools',
        accelerator: 'F12',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.webContents.isDevToolsOpened()) {
              mainWindow.webContents.closeDevTools();
            } else {
              mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => app.quit(),
      },
    ],
  }));
  Menu.setApplicationMenu(menu);
}

function revealWindow(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) {
    window.restore();
  }
  window.setSkipTaskbar(true);
  if (isAlwaysOnTop) {
    window.setAlwaysOnTop(true, 'screen-saver');
  }
  window.show();
  window.moveTop();
  window.focus();
  rebuildTrayMenu();
}

async function createWindow() {
  const ready = await ensureServer();
  const bounds = buildInitialWindowBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    movable: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Claude / Codex Usage Dashboard',
  });
  mainWindow.setOpacity(0.94);

  applyTopMost(mainWindow, isAlwaysOnTop);
  makeSimpleMenu();
  attachContextMenu(mainWindow);
  bindWindowStatePersistence(mainWindow);

  const targetUrl = ready
    ? `${DASHBOARD_URL}${DASHBOARD_PATH}`
    : buildErrorPageUrl();
  mainWindow.loadURL(targetUrl).catch((error) => {
    console.error('[dashboard-desktop] failed to open dashboard URL:', error.message);
  });
  mainWindow.once('ready-to-show', () => {
    revealWindow(mainWindow);
  });
  mainWindow.webContents.once('did-finish-load', () => {
    revealWindow(mainWindow);
  });

  mainWindow.on('focus', () => {
    if (isAlwaysOnTop) {
      setTopMost(mainWindow);
    }
  });

  mainWindow.on('hide', rebuildTrayMenu);
  mainWindow.on('show', rebuildTrayMenu);
  mainWindow.on('minimize', rebuildTrayMenu);
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideWindow();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rebuildTrayMenu();
  });
}

function stopServer() {
  if (serverProcess && serverOwned && !serverProcess.killed) {
    try {
      serverProcess.kill();
    } catch (error) {
      console.warn('[dashboard-desktop] stop server failed:', error.message);
    }
    serverProcess = null;
  }
}

app.whenReady().then(async () => {
  try {
    bindDragIpc();
    ensureTray();
    await createWindow();
  } catch (error) {
    console.error('[dashboard-desktop] startup failed:', error.message);
    if (mainWindow) {
      mainWindow.loadURL(buildErrorPageUrl()).catch(() => {});
      mainWindow.show();
    } else {
      app.quit();
    }
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});
