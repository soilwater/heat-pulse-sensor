'use strict';
/* Builds docs/kansas-soil-data.js (every Kansas Mesonet core and its KD2 Pro readings, for the
 * dashboard's Soil panel) from the Kansas Mesonet soil database, and prints the checks
 * summarized in KANSAS_SOIL.md.
 *
 *   node digital-twin/kansas-soil-build.js            write docs/kansas-soil-data.js + print checks
 *   node digital-twin/kansas-soil-build.js --check    print checks only
 *
 * Source: reference/kansas_mesonet_soil_database_summary_2026.xlsx (copy of the workbook in
 * the kansas-soil-props repository). Heat-pulse data are KD2 Pro SH-1 readings: 30 mm needles,
 * 6 mm spacing, 60 readings 2 s apart, heater on for the first 60 s.
 *
 * Each station depth has two cores. Particle size was measured on one (core 2) and organic
 * matter on the other (core 1), so both cores take texture and OM from their depth "layer". */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {readWorkbook, records} = require('./xlsx-read.js');
const T = require('../docs/engine.js');
const S = require('../docs/sensor-model.js');

const ROOT = path.join(__dirname, '..');
const SOURCE = 'reference/kansas_mesonet_soil_database_summary_2026.xlsx';
const OUT = path.join(ROOT, 'docs', 'kansas-soil-data.js');
const CHECK_ONLY = process.argv.includes('--check');

// Water states, wet to dry: sheet label, id, short label, thermal_properties column suffix.
const STATES = [
  {id: 'sat', sheet: 'Saturated', short: 'Saturated', column: 'sat'},
  {id: '5kPa', sheet: '5 kPa', short: '5 kPa', column: '5kPa'},
  {id: '10kPa', sheet: '10 kPa', short: '10 kPa', column: '10kPa'},
  {id: '33kPa', sheet: '33 kPa', short: '33 kPa', column: '33kPa'},
  {id: '70kPa', sheet: '70 kPa', short: '70 kPa', column: '70kPa'},
  {id: 'ad2', sheet: 'Air-dry (2 days)', short: 'Air-dry 2 d', column: 'air_dry_2day'},
  {id: 'ad3', sheet: 'Air-dry (3 days)', short: 'Air-dry 3 d', column: 'air_dry_3day'},
  {id: 'od40', sheet: 'Oven-dry (40 °C)', short: 'Oven-dry', column: 'ovendry_40'}
];
const MAIN_STATES = ['sat', '33kPa', '70kPa', 'ad2', 'od40']; // measured on most cores
const stateBySheet = new Map(STATES.map(s => [s.sheet, s]));

const buf = fs.readFileSync(path.join(ROOT, SOURCE));
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
const W = readWorkbook(path.join(ROOT, SOURCE));
const pulses = records(W.heat_pulse_timeseries), general = records(W.general_properties), qa = records(W.qaqc_log);
const key = r => [r.station_name, r.ring_number, r.core_number, r.nominal_depth].join('|');
const layerKey = r => r.station_name + '|' + r.nominal_depth;

// Texture from the core with particle size, OM from the core with chemistry, per station depth.
const layers = new Map();
for (const r of general) {
  const L = layers.get(layerKey(r)) || {}; layers.set(layerKey(r), L);
  if (Number.isFinite(r.sand)) Object.assign(L, {sand: r.sand, silt: r.silt, clay: r.clay, textureCore: r.core_number});
  if (Number.isFinite(r.OM)) Object.assign(L, {om: r.OM, omCore: r.core_number});
  L.texture = L.texture || r.textural_class;
}

// QA/QC: one blanket flag on all 5 and 10 kPa heat capacities, plus individually flagged ones.
const blanket = qa.find(r => r.type === 'flagged' && !r.station_name && /heat_capacity_5kPa/.test(r.column));
const flagged = new Map(qa.filter(r => r.type === 'flagged' && r.station_name && /^heat_capacity_/.test(r.column))
  .map(r => [key(r) + '|' + r.column.replace('heat_capacity_', ''), r.issue]));
function flagFor(p, st) {
  const own = flagged.get(key(p) + '|' + st.column);
  if (own) return 'Heat capacity flagged in the QA/QC log: ' + own;
  if (blanket && (st.id === '5kPa' || st.id === '10kPa')) return 'Heat capacity flagged in the QA/QC log: every 5 and 10 kPa reading is about 30% below the de Vries estimate.';
  return null;
}

const quantile = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return NaN;
  const i = p * (s.length - 1), lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const round = (x, d) => Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null;
const row = (label, a, d = 3) => console.log(label.padEnd(34), [0.05, 0.5, 0.95].map(p => quantile(a, p).toFixed(d).padStart(8)).join(''));
const tempsOf = p => Object.keys(p).filter(k => /^temp_\d+s$/.test(k)).map(k => p[k]);

// ---------- samples: every core with its readings ----------
const coreRows = new Map();
for (const g of general) coreRows.set(key(g), g);
const coreList = [...coreRows.values()].map((g, id) => {
  const L = layers.get(layerKey(g));
  return {id, station: g.station_name, county: g.county, depth: g.nominal_depth, top: g.top_depth, bottom: g.bottom_depth,
    ring: g.ring_number, core: g.core_number, texture: L.texture,
    sand: round(L.sand, 1), silt: round(L.silt, 1), clay: round(L.clay, 1), om: round(L.om, 1),
    textureFromPair: L.textureCore !== g.core_number, omFromPair: L.omCore !== g.core_number,
    bd: round(g.bulk_density, 3), porosity: round(g.porosity, 3), readings: {}};
});
const coreByKey = new Map([...coreRows.keys()].map((k, i) => [k, coreList[i]]));
for (const p of pulses) {
  const st = stateBySheet.get(p.water_state), c = coreByKey.get(key(p));
  if (!st || !c || !Number.isFinite(p.thermal_cond) || !Number.isFinite(p.heat_capacity)) continue;
  const temps = tempsOf(p);
  c.readings[st.id] = {theta: round(p.vwc, 3), lambda: p.thermal_cond, C: p.heat_capacity, D: p.diffusivity,
    // 60 readings over read_time_min minutes, so read_time_min seconds apart; heater on for the first half.
    powerWm: p.heater_power_W_per_m, dtS: p.read_time_min, heatS: 30 * p.read_time_min,
    riseMk: temps.every(Number.isFinite) ? temps.map(v => Math.round((v - temps[0]) * 1000)) : null, // rise above first reading
    flag: flagFor(p, st)};
}
const samples = coreList.filter(c => Object.keys(c.readings).length);

// Dashboard default: the unflagged 33 kPa reading closest to the Kansas medians of lambda and C.
function typicalSample() {
  const pool = samples.filter(c => c.readings['33kPa'] && !c.readings['33kPa'].flag);
  const mL = quantile(pool.map(c => c.readings['33kPa'].lambda), 0.5), mC = quantile(pool.map(c => c.readings['33kPa'].C), 0.5);
  const d = c => ((c.readings['33kPa'].lambda - mL) / mL) ** 2 + ((c.readings['33kPa'].C - mC) / mC) ** 2;
  const best = pool.reduce((a, c) => d(c) < d(a) ? c : a);
  return {id: best.id, state: '33kPa'};
}

// ---------- medians per main water state (context for KANSAS_SOIL.md) ----------
function medians() {
  console.log('\nMedians per water state (flagged heat capacities excluded)');
  for (const id of MAIN_STATES) {
    const r = samples.map(c => c.readings[id]).filter(x => x && !x.flag);
    console.log(`  ${id.padEnd(6)} n=${String(r.length).padStart(3)}  lambda ${quantile(r.map(x => x.lambda), 0.5).toFixed(3)}  C ${quantile(r.map(x => x.C), 0.5).toFixed(2)}  theta ${quantile(r.map(x => x.theta), 0.5).toFixed(3)}`);
  }
}

// ---------- check 1: twin thermal engine vs measured KD2 Pro curves ----------
function kd2Check() {
  const r = 0.006, L = 0.030, N = 60, out = [];
  for (const p of pulses) {
    const temps = tempsOf(p);
    if (temps.some(v => !Number.isFinite(v))) continue;
    const dt = p.read_time_min, t0 = 30 * dt, t = temps.map((_, i) => i * dt), y = temps.map(v => v - temps[0]);
    const soil = {lambda: p.thermal_cond, C: p.heat_capacity * 1e6, alpha: p.thermal_cond / (p.heat_capacity * 1e6)};
    const src = Array.from({length: N}, (_, i) => ({z: (i + 0.5) * L / N, p: p.heater_power_W_per_m * L / N}));
    const fin = t.map(x => T.dTpoint(src, r, L / 2, x, t0, soil));
    const ils = t.map(x => T.dTils(p.heater_power_W_per_m, r, x, t0, soil.lambda, soil.C));
    const peak = Math.max(...y), rmse = a => Math.sqrt(a.reduce((s, v, i) => s + (v - y[i]) ** 2, 0) / a.length);
    out.push({peak, tPeak: t[y.indexOf(peak)], fin: Math.max(...fin) / peak, ils: Math.max(...ils) / peak, rFin: rmse(fin), rIls: rmse(ils)});
  }
  console.log(`\nCheck 1: twin engine vs ${out.length} KD2 Pro SH-1 curves (reported lambda, C and heater power)`);
  console.log(''.padEnd(34) + '     p5  median     p95');
  row('measured peak rise (C)', out.map(o => o.peak));
  row('measured time of peak (s)', out.map(o => o.tPeak), 0);
  row('peak ratio, finite 30 mm heater', out.map(o => o.fin));
  row('peak ratio, infinite line source', out.map(o => o.ils));
  row('RMSE finite heater (C)', out.map(o => o.rFin));
  row('RMSE infinite line source (C)', out.map(o => o.rIls));
}

// ---------- check 2: r2 sensor response over the measured Kansas range ----------
function r2Envelope() {
  const run = S.simulate({}, T), c = run.config, e = run.electrical, src = run._thermalSources;
  const heatedLen = (c.heaterCount - 1) * c.heaterPitchMm / 1000 + 0.0016, qP = e.heaterPowerW / heatedLen;
  const rows = pulses.filter(p => Number.isFinite(p.thermal_cond) && Number.isFinite(p.heat_capacity)).map(p => {
    const soil = {lambda: p.thermal_cond, C: p.heat_capacity * 1e6, alpha: p.thermal_cond / (p.heat_capacity * 1e6)};
    const t = Array.from({length: c.pulseS + c.cooldownS}, (_, i) => i + 1);
    const y = t.map(x => T.dTpoint(src, c.spacingMm / 1000, 0.0298, x, c.pulseS, soil)), peak = Math.max(...y);
    let hot = 0; for (let x = 0.5; x <= c.pulseS + 3; x += 0.5) hot = Math.max(hot, T.dTpoint(src, 0.001385, 0.0298, x, c.pulseS, soil));
    const fit = T.fitILS(t, y, qP, c.spacingMm / 1000, c.pulseS, {lambda: 1, C: 2e6});
    return {state: stateBySheet.get(p.water_state).id, peak, tPeak: t[y.indexOf(peak)], hot,
      eL: 100 * (fit.lambda / soil.lambda - 1), eC: 100 * (fit.C / soil.C - 1)};
  });
  console.log(`\nCheck 2: r2 sensor (${e.heaterPowerW.toFixed(2)} W average for ${c.pulseS} s, ${c.spacingMm} mm spacing) in ${rows.length} measured Kansas soil states`);
  console.log(''.padEnd(34) + '     p5  median     p95');
  row('side-needle peak rise (C)', rows.map(o => o.peak));
  row('time of peak after heater on (s)', rows.map(o => o.tPeak), 0);
  row('heated-zone soil rise (C)', rows.map(o => o.hot), 1);
  row('line-source fit lambda error (%)', rows.map(o => o.eL), 1);
  row('line-source fit C error (%)', rows.map(o => o.eC), 1);
  for (const id of MAIN_STATES) {
    const s = rows.filter(o => o.state === id);
    row(`  ${id}: peak (C)`, s.map(o => o.peak)); row(`  ${id}: heated zone (C)`, s.map(o => o.hot), 1);
  }
}

// ---------- check 3: engine soilProps (Lu et al. 2007 / de Vries) vs measured ----------
function propertyModelCheck() {
  const res = [];
  for (const c of samples) for (const [id, r] of Object.entries(c.readings)) {
    if (!Number.isFinite(r.theta) || !Number.isFinite(c.sand) || !Number.isFinite(c.bd)) continue;
    const m = T.soilProps({mode: 'model', bulkDensity: c.bd, theta: r.theta, sandFrac: c.sand / 100});
    res.push({state: id, dl: m.lambda - r.lambda, dc: m.C / 1e6 - r.C});
  }
  const rm = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length), mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  console.log(`\nCheck 3: engine.soilProps (texture model) vs ${res.length} measurements`);
  console.log(`  lambda RMSE ${rm(res.map(r => r.dl)).toFixed(3)} W/m/K, bias ${mean(res.map(r => r.dl)).toFixed(3)}`);
  console.log(`  C      RMSE ${rm(res.map(r => r.dc)).toFixed(3)} MJ/m3/K, bias ${mean(res.map(r => r.dc)).toFixed(3)}`);
  for (const id of MAIN_STATES) { const s = res.filter(r => r.state === id);
    console.log(`  ${id.padEnd(6)} lambda bias ${mean(s.map(r => r.dl)).toFixed(3).padStart(7)}   C bias ${mean(s.map(r => r.dc)).toFixed(3).padStart(7)}`); }
}

console.log(`Source ${SOURCE}\nSHA-256 ${sha256}\n${samples.length} cores, ${samples.reduce((a, c) => a + Object.keys(c.readings).length, 0)} readings`);
medians(); kd2Check(); r2Envelope(); propertyModelCheck();

if (!CHECK_ONLY) {
  const data = {source: SOURCE, sha256,
    citation: 'Parker, N., Kluitenberg, G. J., Redmond, C., & Patrignani, A. (2022). A database of soil physical properties for the Kansas Mesonet. Soil Science Society of America Journal, 86(6), 1495-1508. https://doi.org/10.1002/saj2.20465',
    probe: {name: 'KD2 Pro SH-1', spacingMm: 6, lengthMm: 30},
    units: {lambda: 'W/(m K)', C: 'MJ/(m3 K)', D: 'mm2/s', theta: 'm3/m3', bd: 'g/cm3', sand: '%', om: '%', riseMk: 'mK', powerWm: 'W/m'},
    states: STATES.map(({id, sheet, short}) => ({id, label: sheet, short})),
    defaultSample: typicalSample(),
    samples};
  // Compact: one sample per line so the file stays readable in diffs.
  const body = '{\n' + Object.entries(data).map(([k, v]) => '    ' + JSON.stringify(k) + ': ' + (k === 'samples'
    ? '[\n' + v.map(s => '      ' + JSON.stringify(s)).join(',\n') + '\n    ]' : JSON.stringify(v))).join(',\n') + '\n  }';
  fs.writeFileSync(OUT, '// Generated by kansas-soil-build.js from ' + SOURCE + '. Do not edit by hand.\n' +
    '(function (root) {\n  const data = ' + body + ';\n' +
    '  if (typeof module !== \'undefined\' && module.exports) module.exports = data; else root.KansasSoil = data;\n' +
    '})(typeof globalThis !== \'undefined\' ? globalThis : this);\n');
  console.log(`\nWrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} kB)`);
}
