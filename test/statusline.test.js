'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const payload = JSON.stringify({
  model: { display_name: 'Test Claude' },
  rate_limits: { five_hour: { used_percentage: 23 }, seven_day: { used_percentage: 45 } },
});
const fallback = 'Test Claude  5h used 23% · 7d used 45%';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of ['statusline-both.js', 'statusline-usage.js', 'setup-statusline.js']) {
    fs.copyFileSync(path.join(root, file), path.join(dir, file));
  }
  const env = { ...process.env, HOME: dir, USERPROFILE: dir,
    CLAUDE_USAGE_CACHE: path.join(dir, 'usage-cache.json') };
  delete env.EXTRA_STATUSLINE_COMMAND;
  const write = (name, value) => {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value));
  };
  const run = (file, args = []) => spawnSync(process.execPath,
    [path.join(dir, file), ...args], { env, input: payload, encoding: 'utf8', timeout: 25000 });
  const extra = (source) => {
    fs.writeFileSync(path.join(dir, 'extra.js'), source);
    // JSON quoting is sufficient here for the controlled fixture paths.
    return '"' + process.execPath + '" "' + path.join(dir, 'extra.js') + '"';
  };
  return { dir, env, write, run, extra };
}

for (const [name, source, expected] of [
  ['multiline ANSI output is preserved verbatim',
    "process.stdout.write('  \\x1b[32mHUD\\x1b[0m\\n tools: 2\\n\\n');",
    '  \x1b[32mHUD\x1b[0m\n tools: 2\n\n'],
  ['empty output falls back', '', fallback],
  ['whitespace output falls back', "process.stdout.write(' \\n\\t');", fallback],
  ['nonzero exit discards partial stdout', "process.stdout.write('partial HUD'); process.exitCode = 1;", fallback],
  ['stderr alone falls back', "process.stderr.write('failure');", fallback],
  ['missing command falls back', null, fallback],
]) {
  test(name + ' and usage cache updates', (t) => {
    const f = fixture(t);
    if (source !== null) f.write('config.json', { extraStatuslineCommand: f.extra(source) });
    const result = f.run('statusline-both.js');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(fs.readFileSync(f.env.CLAUDE_USAGE_CACHE)).rate_limits,
      JSON.parse(payload).rate_limits);
  });
}

test('command not found falls back', (t) => {
  const f = fixture(t);
  f.write('config.json', { extraStatuslineCommand: 'dashboard-nonexistent-test-command' });
  assert.equal(f.run('statusline-both.js').stdout, fallback);
});

test('timed out command discards partial output', (t) => {
  const f = fixture(t);
  f.write('config.json', { extraStatuslineCommand:
    f.extra("process.stdout.write('partial'); setTimeout(() => {}, 18000);") });
  const result = f.run('statusline-both.js');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, fallback);
});

test('environment override receives identical stdin', (t) => {
  const f = fixture(t);
  f.write('config.json', { extraStatuslineCommand: 'dashboard-nonexistent-test-command' });
  f.env.EXTRA_STATUSLINE_COMMAND = f.extra("process.stdin.pipe(process.stdout);");
  assert.equal(f.run('statusline-both.js').stdout, payload);
});

test('HUD still displays when dashboard child fails', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'statusline-usage.js'), 'process.exit(1);');
  f.write('config.json', { extraStatuslineCommand: f.extra("process.stdout.write('HUD');") });
  assert.equal(f.run('statusline-both.js').stdout, 'HUD');
  fs.unlinkSync(path.join(f.dir, 'config.json'));
  assert.equal(f.run('statusline-both.js').stdout, 'Claude');
});

for (const args of [[], ['--fanout']]) {
  test('setup preserves original command, settings and backups: ' + args.join(' '), (t) => {
    const f = fixture(t);
    const original = { theme: 'dark', statusLine: {
      type: 'command', command: 'node "/original/HUD.js" --option', padding: 3, custom: true,
    } };
    f.write('.claude/settings.json', original);
    f.write('config.json', { other: 'retained' });
    const result = f.run('setup-statusline.js', args);
    assert.equal(result.status, 0, result.stderr);
    const configPath = path.join(f.dir, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath));
    assert.deepEqual(config, { other: 'retained', extraStatuslineCommand: original.statusLine.command });
    const settings = JSON.parse(fs.readFileSync(path.join(f.dir, '.claude/settings.json')));
    assert.equal(settings.theme, 'dark');
    assert.equal(settings.statusLine.padding, 3);
    assert.equal(settings.statusLine.custom, true);
    assert.match(settings.statusLine.command, args.length ? /statusline-both.js/ : /statusline-usage.js/);
    const backup = fs.readdirSync(path.join(f.dir, '.claude')).find(x => x.startsWith('settings.json.bak-'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, '.claude', backup))), original);
    const configBackup = fs.readdirSync(f.dir).find(x => x.startsWith('config.json.bak-'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, configBackup))), { other: 'retained' });
    assert.equal(f.run('setup-statusline.js', ['--fanout']).status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath)), config);
  });
}

test('setup retains explicit extra command', (t) => {
  const f = fixture(t);
  f.write('.claude/settings.json', { statusLine: { command: 'original HUD' } });
  f.write('config.json', { extraStatuslineCommand: 'explicit HUD', other: true });
  assert.equal(f.run('setup-statusline.js', ['--fanout']).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'config.json'))),
    { extraStatuslineCommand: 'explicit HUD', other: true });
});

test('setup rejects malformed config before replacing settings', (t) => {
  const f = fixture(t);
  const settings = { statusLine: { command: 'original HUD' } };
  f.write('.claude/settings.json', settings);
  fs.writeFileSync(path.join(f.dir, 'config.json'), '{invalid');
  assert.equal(f.run('setup-statusline.js', ['--fanout']).status, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, '.claude/settings.json'))), settings);
});

for (const script of ['statusline-both.js', 'statusline-usage.js']) {
  test('setup never saves its own wrapper: ' + script, (t) => {
    const f = fixture(t);
    f.write('.claude/settings.json', { statusLine: {
      command: '"node" "C:\\old dashboard\\' + script + '"',
    } });
    assert.equal(f.run('setup-statusline.js', ['--fanout']).status, 0);
    assert.equal(fs.existsSync(path.join(f.dir, 'config.json')), false);
  });
}

test('fresh fanout install works without an existing command', (t) => {
  const f = fixture(t);
  assert.equal(f.run('setup-statusline.js', ['--fanout']).status, 0);
  assert.equal(f.run('statusline-both.js').stdout, fallback);
});
