// Dev server for the client: rebuilds on change and serves client/dist on http://localhost:5173
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const build = () => { const r = spawnSync(process.execPath, [path.join(root, 'client/build.mjs')], { stdio: 'inherit', env: process.env }); return r.status === 0; };
build();
let t = null;
for (const d of ['client/src', 'client/template.html', 'shared']) fs.watch(path.join(root, d), { recursive: true }, () => { clearTimeout(t); t = setTimeout(build, 150); });
const port = +process.env.PORT || 5173;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, 'client/dist', path.normalize(p).replace(/^([/\])+/, ''));
  if (!f.startsWith(path.join(root, 'client/dist')) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`client on http://localhost:${port}`));
