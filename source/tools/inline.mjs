/**
 * 把 Vite 构建产物压成「单文件 HTML」：
 *   - CSS 内联进 <style>
 *   - JS  内联进 <script>
 * 产出的 index.html 无任何外部依赖（除 Google Fonts 外链），
 * 双击即可在浏览器打开，也适合直接作为 GitHub Pages 的站点入口。
 */
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const entry = join(dist, 'index.html');

if (!existsSync(entry)) {
  console.error('[inline] 找不到 dist/index.html，请先执行 vite build');
  process.exit(1);
}

let html = readFileSync(entry, 'utf8');

// ---- 内联 CSS ----
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*>/g, (tag) => {
  const m = tag.match(/href="([^"]+)"/);
  if (!m) return tag;
  const file = join(dist, m[1].replace(/^\.?\//, ''));
  if (!existsSync(file)) return tag;
  const css = readFileSync(file, 'utf8').replace(/<\/style/gi, '<\\/style');
  return `<style>\n${css}\n</style>`;
});

// ---- 内联 JS ----
html = html.replace(/<script([^>]*)\ssrc="([^"]+)"([^>]*)>\s*<\/script>/g, (tag, pre, src, post) => {
  const file = join(dist, src.replace(/^\.?\//, ''));
  if (!existsSync(file)) return tag;
  const js = readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script${pre}${post}>\n${js}\n</script>`;
});

// 清理已内联的 assets 引用
html = html.replace(/<link[^>]+rel="modulepreload"[^>]*>/g, '');

writeFileSync(entry, html, 'utf8');

// 移除已内联的 assets 目录，保持产物干净
const assets = join(dist, 'assets');
if (existsSync(assets)) {
  for (const f of readdirSync(assets)) {
    rmSync(join(assets, f), { force: true, recursive: true });
  }
  rmSync(assets, { force: true, recursive: true });
}

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log(`[inline] 已生成单文件 dist/index.html（${kb} KB，可直接部署 / 双击打开）`);
