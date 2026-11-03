import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = '/Users/progressive/Documents/Qoder/2026-11-03/4b69ad57/swiftdevices';
const baselineRef = process.argv[2] || 'd509987:public/index.html';
const workingPath = join(root, process.argv[3] || 'public/index.html');
const rate = 0.8;

const baseline = execFileSync('git', ['show', baselineRef], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const working = readFileSync(workingPath, 'utf8');

function parse(text) {
  const start = text.indexOf('const products = [');
  const end = text.indexOf('\n        ];', start);
  if (start < 0 || end < 0) throw new Error('products array not found in input');
  const block = text.slice(start, end);
  const rows = [];
  const re = /\{ id: (\d+), name: "((?:[^"\\]|\\.)*)",([^]*?)price: (\d+(?:\.\d+)?), oldPrice: (\d+(?:\.\d+)?|null),/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    rows.push({ id: Number(m[1]), name: m[2], price: Number(m[4]), oldPrice: m[5] === 'null' ? null : Number(m[5]) });
  }
  return rows;
}

const before = parse(baseline);
const after = parse(working);
const cents = (n) => Math.round(n * 100) / 100;
const failures = [];

if (before.length !== 95) failures.push(`expected 95 baseline products, found ${before.length}`);
if (after.length !== before.length) failures.push(`product count changed: ${before.length} -> ${after.length}`);

for (let i = 0; i < Math.min(before.length, after.length); i++) {
  const b = before[i];
  const a = after[i];
  if (b.id !== a.id) failures.push(`index ${i}: id changed ${b.id} -> ${a.id}`);
  if (b.name !== a.name) failures.push(`id ${b.id}: name changed`);
  const expected = cents(b.price * rate);
  if (a.price !== expected) failures.push(`id ${b.id} (${b.name}): price ${a.price} != expected ${expected} (from ${b.price})`);
  if (a.oldPrice !== b.price) failures.push(`id ${b.id} (${b.name}): oldPrice ${a.oldPrice} != pre-cut price ${b.price}`);
  if (a.price >= b.price) failures.push(`id ${b.id}: price did not decrease (${b.price} -> ${a.price})`);
}

const bl = baseline.split('\n');
const wl = working.split('\n');
if (bl.length !== wl.length) failures.push(`line count changed: ${bl.length} -> ${wl.length}`);
let changedLines = 0;
let productLinesChanged = 0;
let copyLinesChanged = 0;
for (let i = 0; i < Math.min(bl.length, wl.length); i++) {
  if (bl[i] === wl[i]) continue;
  changedLines++;
  if (/\{ id: \d+, name: "[^"]*"/.test(wl[i])) productLinesChanged++;
  else copyLinesChanged++;
}

const minPrice = Math.min(...after.map((p) => p.price));
const maxPrice = Math.max(...after.map((p) => p.price));

console.log(JSON.stringify({
  ok: failures.length === 0,
  products_checked: after.length,
  lines_changed: changedLines,
  product_lines_changed: productLinesChanged,
  copy_lines_changed: copyLinesChanged,
  catalog_range_after_cut: `$${minPrice} - $${maxPrice}`,
  savings_at_largest_item: `$${cents(maxPrice / rate - maxPrice).toFixed(2)}`,
  failures: failures.slice(0, 12),
}, null, 2));

if (productLinesChanged !== 95) {
  console.error(`expected exactly 95 product lines to change, saw ${productLinesChanged}`);
  process.exit(1);
}

process.exit(failures.length === 0 ? 0 : 1);
