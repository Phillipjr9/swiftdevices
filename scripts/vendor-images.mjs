import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

const root = '/Users/progressive/Documents/Qoder/2026-11-03/4b69ad57/swiftdevices';
const outDir = join(root, 'public/img/products');
const files = ['index.html', 'support.html', 'admin.html', 'contact.html', 'warranty.html', 'returns.html', 'privacy.html', 'terms.html', 'giftcards.html', 'tradein.html', 'payment-success.html', '404.html'];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Local name for an AT&T asset: <model-dir>__<file-base><ext>, so the origin stays traceable.
function localName(url) {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  const di = parts.lastIndexOf('defaultimage');
  const model = di > 0 ? parts[di - 1] : parts[parts.length - 2];
  const file = basename(u.pathname);
  const stem = file.replace(/-hero-zoom(?=\.[a-z]+$)/i, '').replace(/\.[a-z]+$/i, '');
  const ext = (file.match(/\.[a-z]+$/i) || ['.png'])[0].toLowerCase();
  return `${model}__${stem}${ext}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

const seen = new Map();
const refs = [];
for (const f of files) {
  let text;
  try { text = await readFile(join(root, 'public', f), 'utf8'); } catch { continue; }
  for (const m of text.matchAll(/https:\/\/www\.att\.com\/scmsassets\/[^\s"'()<>]+/g)) {
    const url = m[0];
    if (!seen.has(url)) seen.set(url, localName(url));
    refs.push({ file: f, url, name: seen.get(url) });
  }
}

await mkdir(outDir, { recursive: true });
const queue = [...seen.entries()];
const results = new Map();
const dry = process.argv[2] === '--dry-run';
let cursor = 0;

function placeholderSvg(label) {
  const text = label.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300" height="300" role="img" aria-label="${text} - photo pending">
  <rect width="300" height="300" fill="#f8fafc"/>
  <rect x="105" y="52" width="90" height="176" rx="20" fill="none" stroke="#cbd5e1" stroke-width="6" stroke-dasharray="14 10"/>
  <circle cx="150" cy="126" r="26" fill="none" stroke="#cbd5e1" stroke-width="6"/>
  <path d="M150 100v52M124 126h52" stroke="#cbd5e1" stroke-width="6" stroke-linecap="round"/>
  <text x="150" y="252" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#94a3b8">PHOTO PENDING</text>
  <text x="150" y="272" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="12" font-weight="bold" fill="#64748b">${text}</text>
</svg>
`;
}

// AT&T keeps the same asset under either devices/phones/ or devices/other/, so a
// 404 on one path family is worth one retry on the other before giving up.
const alternates = (url) => [url, url.replace('/devices/phones/', '/devices/other/'), url.replace('/devices/other/', '/devices/phones/')];
async function worker() {
  while (cursor < queue.length) {
    const [url, name] = queue[cursor++];
    let done = false;
    for (const candidate of alternates(url)) {
      try {
        const res = await fetch(candidate, { headers: { 'user-agent': UA }, redirect: 'follow' });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !type.startsWith('image/')) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) continue;
        if (!dry) await writeFile(join(outDir, name), buf);
        results.set(url, { name, status: res.status, type, bytes: buf.length, via: candidate === url ? 'direct' : 'alternate-path' });
        done = true;
        break;
      } catch { /* try the next candidate */ }
    }
    if (done) continue;
    // Dead upstream: ship a labelled local placeholder instead of leaving a hotlink
    // that renders as a broken image, and keep it obvious that art is missing.
    const stem = name.replace(/\.[a-z]+$/, '');
    const svgName = `${stem}.svg`;
    if (!dry) await writeFile(join(outDir, svgName), placeholderSvg(stem.replace(/__/g, ' - ')));
    results.set(url, { name: svgName, status: 'placeholder', type: 'image/svg+xml', bytes: 0, original: url });
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

const failed = [...results.entries()].filter(([, r]) => r.bytes === 0 && r.status !== 'placeholder');
const placeholders = [...results.entries()].filter(([, r]) => r.status === 'placeholder');
const totalBytes = [...results.values()].reduce((s, r) => s + r.bytes, 0);

if (!dry) {
  for (const f of files) {
    const p = join(root, 'public', f);
    let text;
    try { text = await readFile(p, 'utf8'); } catch { continue; }
    text = text.replace(/https:\/\/www\.att\.com\/scmsassets\/[^\s"'()<>]+/g, (url) => {
      const r = results.get(url);
      return r && (r.bytes > 0 || r.status === 'placeholder') ? `/img/products/${r.name}` : url;
    });
    await writeFile(p, text);
  }
}

console.log(JSON.stringify({
  dry_run: dry,
  distinct_urls: seen.size,
  references_rewritten: refs.length,
  downloaded: [...results.values()].filter((r) => r.bytes > 0).length,
  local_placeholders: placeholders.map(([u, r]) => ({ file: r.name, dead_url: u })),
  unresolved: failed.map(([u, r]) => ({ name: r.name, status: r.status, url: u })),
  bytes_written: totalBytes,
  per_file_references: refs.reduce((m, r) => ({ ...m, [r.file]: (m[r.file] || 0) + 1 }), {}),
}, null, 2));
