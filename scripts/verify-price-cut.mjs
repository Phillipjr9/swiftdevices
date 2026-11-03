import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = '/Users/progressive/Documents/Qoder/2026-11-03/4b69ad57/swiftdevices';
const baselineRef = process.argv[2] || 'd509987:public/index.html';
const workingPath = join(root, process.argv[3] || 'public/index.html');
const rate = Number(process.argv[4] || '0.8');

const baseline = execFileSync('git', ['show', baselineRef], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const working = readFileSync(workingPath, 'utf8');

const PRODUCT_LINE = /^\s*\{ id: \d+, name: "(?:[^"\\]|\\.)*",/;

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

function multisetDiff(beforeText, afterText) {
  const count = (lines) => {
    const map = new Map();
    for (const line of lines) map.set(line, (map.get(line) || 0) + 1);
    return map;
  };
  const only = (from, minus) => {
    let total = 0, product = 0;
    for (const [line, n] of from) {
      const delta = n - (minus.get(line) || 0);
      if (delta <= 0) continue;
      total += delta;
      if (PRODUCT_LINE.test(line)) product += delta;
    }
    return { total, product, other: total - product };
  };
  const b = count(beforeText.split('\n'));
  const w = count(afterText.split('\n'));
  return { removed: only(b, w), added: only(w, b) };
}

const cents = (n) => Math.round(n * 100) / 100;
const key = (p) => `${p.id}|${p.name}`;

const before = parse(baseline);
const after = parse(working);
const failures = [];

if (before.length === 0) failures.push('baseline products array is empty - nothing to verify');

const beforeByKey = new Map(before.map((p) => [key(p), p]));
const afterByKey = new Map(after.map((p) => [key(p), p]));

if (afterByKey.size !== after.length) failures.push('duplicate id+name pairs in the working products array');

// 1. Every baseline product must survive the cut unchanged in identity, and
//    carry price = round(baseline price * rate) with oldPrice = baseline price.
for (const p of before) {
  const a = afterByKey.get(key(p));
  if (!a) { failures.push(`id ${p.id} (${p.name}): product disappeared from the working file`); continue; }
  const expected = cents(p.price * rate);
  if (a.price !== expected) failures.push(`id ${p.id} (${p.name}): price ${a.price} != expected ${expected} (from ${p.price})`);
  if (a.oldPrice !== p.price) failures.push(`id ${p.id} (${p.name}): oldPrice ${a.oldPrice} != pre-cut price ${p.price}`);
  if (a.price >= p.price) failures.push(`id ${p.id}: price did not decrease (${p.price} -> ${a.price})`);
}

// 2. Campaign invariant over the whole working catalog: every product is
//    discounted from its own oldPrice by exactly rate, so new SKUs cannot be
//    added at full price and silently undercut the advertised sale.
for (const a of after) {
  if (a.oldPrice === null) { failures.push(`id ${a.id} (${a.name}): no oldPrice, promo copy promises a crossed-out price`); continue; }
  if (cents(a.oldPrice * rate) !== a.price) failures.push(`id ${a.id} (${a.name}): price ${a.price} != ${cents(a.oldPrice * rate)} (=${rate}x list ${a.oldPrice})`);
  if (a.oldPrice <= a.price) failures.push(`id ${a.id} (${a.name}): oldPrice ${a.oldPrice} is not above price ${a.price}`);
}

const added = after.filter((p) => !beforeByKey.has(key(p)));
const diff = multisetDiff(baseline, working);

// 3. Parser completeness: a product literal the regex fails to read would drop
//    out of every check above instead of failing one, so count the real ones.
const productLineCount = (text) => {
  const start = text.indexOf('const products = [');
  const end = text.indexOf('\n        ];', start);
  return text.slice(start, end).split('\n').filter((line) => PRODUCT_LINE.test(line)).length;
};
for (const [label, text, rows] of [['baseline', baseline, before], ['working', working, after]]) {
  const lines = productLineCount(text);
  if (lines !== rows.length) failures.push(`${label}: ${lines} product literals but ${rows.length} parsed - objects must stay one per line or a SKU escapes this check`);
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  rate,
  baseline_products: before.length,
  working_products: after.length,
  products_added: added.length,
  products_added_ids: added.map((p) => p.id),
  lines_removed: diff.removed.total,
  lines_added: diff.added.total,
  product_lines_rewritten: diff.removed.product,
  non_product_lines_changed: diff.removed.other + diff.added.other,
  catalog_range_after_cut: `$${Math.min(...after.map((p) => p.price))} - $${Math.max(...after.map((p) => p.price))}`,
  list_price_range: `$${Math.min(...after.map((p) => p.oldPrice))} - $${Math.max(...after.map((p) => p.oldPrice))}`,
  failures: failures.slice(0, 12),
}, null, 2));

process.exit(failures.length === 0 ? 0 : 1);
