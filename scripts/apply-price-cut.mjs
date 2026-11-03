import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const target = process.argv[2] || 'public/index.html';
const rate = Number(process.argv[3] || 0.8);
const root = '/Users/progressive/Documents/Qoder/2026-11-03/4b69ad57/swiftdevices';
const path = join(root, target);

const text = readFileSync(path, 'utf8');
const start = text.indexOf('const products = [');
const end = text.indexOf('\n        ];', start);
if (start < 0 || end < 0) throw new Error('products array not found');
const head = text.slice(0, start);
const block = text.slice(start, end);
const tail = text.slice(end);

const cents = (n) => Math.round(n * 100) / 100;
let changed = 0;
const nextBlock = block.replace(
  /\{ id: (\d+), name: "((?:[^"\\]|\\.)*)",([^]*?)price: (\d+(?:\.\d+)?), oldPrice: (\d+(?:\.\d+)?|null),/g,
  (whole, id, name, between, price, oldPrice) => {
    const before = Number(price);
    const after = cents(before * rate);
    changed++;
    return `{ id: ${id}, name: "${name}",${between}price: ${after}, oldPrice: ${before},`;
  }
);

writeFileSync(path, head + nextBlock + tail, 'utf8');
console.log(JSON.stringify({ file: target, rate, products_rewritten: changed }));
