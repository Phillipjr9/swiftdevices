'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const htmlFiles = fs.readdirSync(publicDir).filter((name) => name.endsWith('.html'));
let checked = 0;
for (const filename of htmlFiles) {
  const html = fs.readFileSync(path.join(publicDir, filename), 'utf8');
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(scripts)) {
    const attrs = match[1] || '';
    const code = match[2] || '';
    if (/\bsrc\s*=/.test(attrs) || /\btype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(attrs) || !code.trim()) continue;
    try {
      new vm.Script(code, { filename: `${filename}:inline-script-${checked + 1}` });
      checked += 1;
    } catch (error) {
      console.error(`${filename}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
if (!process.exitCode) console.log(`Syntax-checked ${checked} inline scripts across ${htmlFiles.length} public pages.`);
