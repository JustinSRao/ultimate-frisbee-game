// Bundles client/src + client/template.html into one self-contained HTML file.
// Output: client/dist/index.html (used by Tauri + Pages) and a copy at dist/index.html (repo root).
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const define = { __SERVER_URL__: JSON.stringify(process.env.WUL_SERVER_URL || '') };
const r = await esbuild.build({ entryPoints: [path.join(here, 'src/index.js')], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020', legalComments: 'none', define });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\/script');
let html = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
// self-hosted font (no Google Fonts request): inline the woff2 files as data URIs
const fontDir = path.join(here, 'assets/fonts');
if (fs.existsSync(fontDir)) {
  const faces = fs.readdirSync(fontDir).filter(f => f.endsWith('.woff2')).map(f => {
    const w = f.match(/(\d{3})/)[1];
    return `@font-face{font-family:"Saira Condensed";font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(fontDir, f)).toString('base64')}) format("woff2")}`;
  }).join('');
  html = html.replace('/*FONTS*/', () => faces);
}
html = html.replace('<script>/*BUNDLE*/</script>', () => '<script>' + js + '</script>');
for (const out of [path.join(here, 'dist'), path.join(root, 'dist')]) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), html);
}
// static extras for the hosted site (privacy policy etc.) go next to client/dist/index.html only
const pub = path.join(here, 'public');
if (fs.existsSync(pub)) for (const f of fs.readdirSync(pub)) fs.copyFileSync(path.join(pub, f), path.join(here, 'dist', f));
console.log('built', (html.length / 1024).toFixed(0) + ' KB');
