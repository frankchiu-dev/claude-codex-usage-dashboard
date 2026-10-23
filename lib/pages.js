'use strict';
const qrcode = require('../vendor/qrcode');
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function shell(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) + '</title><style>*{box-sizing:border-box}body{font:18px/1.6 system-ui,sans-serif;background:#ebe6d9;color:#2b2a26;margin:0;padding:24px}main{max-width:720px;margin:auto;background:white;padding:24px;border-radius:12px}h1,h2{overflow-wrap:anywhere}a{color:#4c57a0;overflow-wrap:anywhere}svg{max-width:100%;height:auto}input,button{font:inherit;max-width:100%;padding:10px}label{display:block}nav{display:flex;gap:20px;flex-wrap:wrap}code{overflow-wrap:anywhere}</style></head><body><main>' + body + '</main></body></html>';
}
function connectPage(settings, port, hosts, key) {
  let body = '<nav><a href="/">Overview</a><a href="/details">History &amp; forecast</a></nav><h1>Connect a phone or tablet</h1>';
  if (settings.loopback && !settings.publicUrl) {
    return shell('Connect a device', body + '<p>This dashboard is available on this computer only.</p><p>To share on the same Wi-Fi, stop it and run:</p><pre>node server.js --lan</pre><p>Then open the local pairing link printed in the terminal and return here to scan a QR code. No Cloudflare account is needed.</p>');
  }
  const origins = settings.publicUrl ? [settings.publicUrl] : hosts.map(host => 'http://' + host + ':' + port);
  body += '<p>' + (settings.publicUrl ? 'Open your private remote URL.' : 'Connect this device and your phone to the same trusted Wi-Fi. Choose the address for your Wi-Fi or Ethernet adapter.') + '</p><p>Pairing links grant access to your usage. Keep them private. ' + (settings.pairingKey ? 'The configured pairing key remains valid until you change it.' : 'Restarting the dashboard changes the key and signs devices out.') + '</p>';
  for (const origin of origins) {
    const url = origin + '/pair?key=' + encodeURIComponent(key);
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    body += '<h2>' + escape(origin) + '</h2>' + qr.createSvgTag({ cellSize: 4, margin: 16 }) + '<p><a href="' + escape(url) + '">' + escape(url) + '</a></p>';
  }
  return shell('Connect a device', body + '<p>After pairing, use <code>/k</code> for a KOBO or e-ink screen. The source computer must stay awake and the dashboard must keep running.</p>');
}
function pairingPage(failed = false) {
  return shell('Pair this device', '<h1>Pair this device</h1><p>Scan the QR code on the source computer, or paste the pairing key from its terminal link.</p>' + (failed ? '<p role="alert">The pairing key is invalid. Check the current terminal link.</p>' : '') + '<form method="post" action="/pair"><label>Pairing key <input name="key" type="password" autocomplete="off" required maxlength="128"></label><button>Pair device</button></form>');
}
module.exports = { connectPage, pairingPage };
