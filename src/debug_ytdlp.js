// Archivo temporal de diagnóstico — borrar después
// Corre con: node src/debug_ytdlp.js
const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const cookiesPath = path.join(process.cwd(), 'cookies.txt');
const url = 'https://youtube.com/watch?v=oujzyZfQF94';

const cookiesArgs = fs.existsSync(cookiesPath) ? `--cookies ${cookiesPath}` : '';

console.log('🔍 Cookies file exists:', fs.existsSync(cookiesPath));
console.log('🔍 Listando formatos disponibles...\n');

try {
  const out = execSync(
    `yt-dlp ${cookiesArgs} --list-formats --no-warnings "${url}" 2>&1`,
    { timeout: 30000 }
  ).toString();
  console.log(out);
} catch (e) {
  console.error('Error:', e.stdout?.toString() || e.message);
}
