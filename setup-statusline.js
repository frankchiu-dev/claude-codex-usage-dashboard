'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const configPath = path.join(__dirname, 'config.json');

const useFanout = process.argv.includes('--fanout');
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const scriptName = useFanout ? 'statusline-both.js' : 'statusline-usage.js';
const scriptPath = path.join(__dirname, scriptName);

function quote(value) {
  return '"' + String(value).replace(/"/g, '\\"') + '"';
}

function backupPathFor(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return filePath + '.bak-' + stamp;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node setup-statusline.js [--fanout]');
  console.log('');
  console.log('--fanout  Use statusline-both.js so this dashboard can coexist with another statusLine command.');
  process.exit(0);
}

let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) || {};
  } catch (error) {
    console.error('Failed to parse Claude settings: ' + settingsPath);
    process.exit(1);
  }
}

// Preserve the previous display command before replacing settings, even when
// installing without --fanout so a later switch to fanout can recover it.
const previousCommand = settings.statusLine && settings.statusLine.command;
const isDashboardCommand = (value) => typeof value === 'string'
  && /(?:^|[\\/\s"'])statusline-(?:both|usage)\.js(?:$|[\s"'])/i.test(value);
if (typeof previousCommand === 'string' && previousCommand.trim()
    && !isDashboardCommand(previousCommand)) {
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Expected a config object');
      }
    } catch (error) {
      console.error('Failed to parse dashboard config; settings were not changed: ' + configPath);
      process.exit(1);
    }
  }
  // An explicit, nonempty command always takes precedence over auto-discovery.
  if (typeof config.extraStatuslineCommand !== 'string'
      || !config.extraStatuslineCommand.trim()) {
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, backupPathFor(configPath));
    }
    config.extraStatuslineCommand = previousCommand;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('Preserved existing statusLine command in config.json.');
  }
}

if (fs.existsSync(settingsPath)) {
  try {
    const backupPath = backupPathFor(settingsPath);
    fs.copyFileSync(settingsPath, backupPath);
    console.log('Backed up existing settings to:');
    console.log('  ' + backupPath);
  } catch (error) {
    console.error('Could not back up settings.json; settings were not changed.');
    process.exit(1);
  }
}

const command = quote(process.execPath) + ' ' + quote(scriptPath);
settings.statusLine = {
  ...settings.statusLine,
  type: 'command',
  command,
  padding: settings.statusLine?.padding ?? 0,
};

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

console.log('');
console.log('Claude Code statusLine is now configured:');
console.log('  ' + command);
console.log('');
console.log('Next steps:');
console.log('  1. Restart Claude Code completely.');
console.log('  2. Send one message in Claude Code.');
console.log('  3. Refresh the dashboard.');
if (useFanout) {
  console.log('');
  console.log('Fanout mode is enabled. The extra command owns the display when successful and nonempty; otherwise the dashboard display is used. Configure extraStatuslineCommand in config.json if needed.');
}
