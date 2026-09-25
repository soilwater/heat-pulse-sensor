'use strict';
/* Minimal dependency-free .xlsx reader for Node (no Python/npm on this machine).
 * Reads the zip central directory, inflates the sheet XML and returns each
 * worksheet as an array of row arrays (strings or numbers). Enough for plain
 * data workbooks; formulas return their cached values, styles are ignored. */
const fs = require('node:fs');
const zlib = require('node:zlib');

function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
const text = xml => unescape([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));
function colIndex(ref) { let n = 0; for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }

function readWorkbook(file) {
  const z = unzip(fs.readFileSync(file)), get = n => (z.get(n) || Buffer.alloc(0)).toString('utf8');
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => text(m[1]));
  const rels = new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map(m =>
    [m[0].match(/Id="([^"]+)"/)[1], m[0].match(/Target="([^"]+)"/)[1].replace(/^\/?(xl\/)?/, 'xl/')]));
  const sheets = {};
  for (const m of get('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescape(m[0].match(/name="([^"]+)"/)[1]), rid = m[0].match(/r:id="([^"]+)"/)[1];
    const rows = [];
    for (const r of get(rels.get(rid)).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] || '', ref = attrs.match(/r="([A-Z]+)\d+"/);
        const type = (attrs.match(/t="([^"]+)"/) || [])[1], v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = null;
        if (type === 's') val = shared[+v];
        else if (type === 'inlineStr') val = text(body);
        else if (type === 'str' || type === 'e') val = v == null ? null : unescape(v);
        else if (type === 'b') val = v === '1';
        else if (v != null) val = Number(v);
        row[ref ? colIndex(ref[1]) : row.length] = val;
      }
      rows.push(Array.from(row, x => x === undefined ? null : x));
    }
    sheets[name] = rows;
  }
  return sheets;
}

/** Sheet rows -> objects keyed by the header row. */
function records(rows, headerRow = 0) {
  const h = rows[headerRow];
  return rows.slice(headerRow + 1).filter(r => r.some(v => v != null && v !== ''))
    .map(r => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? null : r[i]])));
}

module.exports = {readWorkbook, records};
