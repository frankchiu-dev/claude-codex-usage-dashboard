const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopHud', {
  beginDrag: (x, y) => ipcRenderer.send('hud-drag-begin', { x, y }),
  dragTo: (x, y) => ipcRenderer.send('hud-drag-move', { x, y }),
  endDrag: () => ipcRenderer.send('hud-drag-end'),
});
