/* Soil picker: every Kansas Mesonet core on a USDA texture triangle, its water states,
 * measured properties and the KD2 Pro reading behind them. The twin uses the selected
 * reading's measured conductivity and heat capacity; nothing is interpolated.
 * Data: kansas-soil-data.js (window.KansasSoil). Thermal model: engine.js (window.HPTwin). */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  // USDA class polygons as [clay, silt, sand] vertices.
  const USDA = {
    'sand': [[0, 0, 100], [10, 0, 90], [0, 15, 85]],
    'loamy sand': [[0, 15, 85], [10, 0, 90], [15, 0, 85], [0, 30, 70]],
    'sandy loam': [[0, 30, 70], [15, 0, 85], [20, 0, 80], [20, 28, 52], [7, 41, 52], [7, 50, 43], [0, 50, 50]],
    'loam': [[7, 41, 52], [20, 28, 52], [27, 28, 45], [27, 50, 23], [7, 50, 43]],
    'silt loam': [[0, 50, 50], [7, 50, 43], [27, 50, 23], [27, 73, 0], [12, 88, 0], [12, 80, 8], [0, 80, 20]],
    'silt': [[0, 80, 20], [12, 80, 8], [12, 88, 0], [0, 100, 0]],
    'sandy clay loam': [[20, 0, 80], [35, 0, 65], [35, 20, 45], [27, 28, 45], [20, 28, 52]],
    'clay loam': [[27, 28, 45], [40, 15, 45], [40, 40, 20], [27, 53, 20]],
    'silty clay loam': [[27, 53, 20], [40, 40, 20], [40, 60, 0], [27, 73, 0]],
    'sandy clay': [[35, 0, 65], [55, 0, 45], [35, 20, 45]],
    'silty clay': [[40, 40, 20], [40, 60, 0], [60, 40, 0]],
    'clay': [[40, 15, 45], [55, 0, 45], [100, 0, 0], [60, 40, 0], [40, 40, 20]]
  };
  const SHORT = {'sand': 'S', 'loamy sand': 'LS', 'sandy loam': 'SL', 'loam': 'L', 'silt loam': 'SiL', 'silt': 'Si',
    'sandy clay loam': 'SCL', 'clay loam': 'CL', 'silty clay loam': 'SiCL', 'sandy clay': 'SC', 'silty clay': 'SiC', 'clay': 'C'};
  const LABEL_AT = {'sand': [3, 4, 93], 'loamy sand': [6, 12, 82], 'sandy loam': [10, 28, 62], 'silt loam': [14, 64, 22], 'silt': [5, 88, 7]};
  // One sequential blue ramp (light -> dark) for every color-by variable.
  const RAMP_LIGHT = ['#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
  // Dark surface: the same blue ramp run the other way, so larger values are brighter.
  const RAMP_DARK = ['#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
  const ramp = () => document.documentElement.dataset.theme === 'dark' ? RAMP_DARK : RAMP_LIGHT;
  const COLOR_BY = {
    om: {label: 'Organic matter', unit: '%', digits: 1, get: s => s.om},
    bd: {label: 'Bulk density', unit: 'g/cm³', digits: 2, get: s => s.bd},
    depth: {label: 'Depth', unit: 'cm', digits: 0, get: s => s.depth},
    theta: {label: 'Water content', unit: 'm³/m³', digits: 2, get: (s, state) => s.readings[state] ? s.readings[state].theta : null}
  };
  const SIDE = 272, PAD_X = 34, PAD_Y = 14, H = SIDE * Math.sqrt(3) / 2;
  const pt = (clay, sand) => [PAD_X + (100 - sand - clay + clay / 2) / 100 * SIDE, PAD_Y + H - clay / 100 * H];
  const fmt = (v, d) => Number.isFinite(v) ? v.toFixed(d) : '—';
  const esc = v => String(v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  function node(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    if (parent) parent.append(e);
    return e;
  }
  const quantile = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s[Math.round(p * (s.length - 1))]; };

  /** Ideal KD2 Pro SH-1 curve (finite 30 mm heater, 6 mm spacing) for one reading, in degrees C. */
  function kd2Model(reading, probe, engine) {
    const L = probe.lengthMm / 1000, r = probe.spacingMm / 1000, n = 30;
    const soil = {lambda: reading.lambda, C: reading.C * 1e6, alpha: reading.lambda / (reading.C * 1e6)};
    const src = Array.from({length: n}, (_, i) => ({z: (i + 0.5) * L / n, p: reading.powerWm * L / n}));
    return reading.riseMk.map((_, i) => engine.dTpoint(src, r, L / 2, i * reading.dtS, reading.heatS, soil));
  }

  function mount(panel, data, onChange, engine) {
    const $ = id => panel.querySelector('#' + id);
    const samples = data.samples, states = data.states, stateInfo = Object.fromEntries(states.map(s => [s.id, s]));
    const initial = data.defaultSample || {id: data.samples[0].id, state: 'sat'};
    let colorBy = 'om', texture = '', sampleId = initial.id, stateId = initial.state, lastPick = 0;
    const current = () => samples.find(s => s.id === sampleId);

    // ---------- static controls ----------
    const classes = [...new Set(samples.map(s => s.texture))].sort();
    $('soilTexture').innerHTML = '<option value="">All textures (' + samples.length + ' cores)</option>' +
      classes.map(c => '<option value="' + esc(c) + '">' + esc(c[0].toUpperCase() + c.slice(1)) + ' (' + samples.filter(s => s.texture === c).length + ')</option>').join('');
    $('soilColor').innerHTML = Object.entries(COLOR_BY).map(([k, v]) => '<option value="' + k + '">' + esc(v.label) + '</option>').join('');

    // ---------- triangle frame ----------
    const svg = $('soilTriangle');
    svg.setAttribute('viewBox', '0 0 ' + (SIDE + 2 * PAD_X) + ' ' + (H + PAD_Y + 34));
    const grid = node('g', {class: 'tri-grid'}, svg);
    for (let v = 20; v < 100; v += 20) {
      const seg = (a, b) => node('line', {x1: a[0], y1: a[1], x2: b[0], y2: b[1]}, grid);
      seg(pt(v, 100 - v), pt(v, 0)); seg(pt(0, v), pt(100 - v, v)); seg(pt(0, 100 - v), pt(100 - v, 0));
    }
    const classLayer = node('g', {}, svg), classPaths = {};
    for (const [name, poly] of Object.entries(USDA))
      classPaths[name] = node('path', {class: 'tri-class', d: 'M' + poly.map(([cl, , sa]) => pt(cl, sa).join(',')).join('L') + 'Z'}, classLayer);
    node('path', {class: 'tri-edge', d: 'M' + pt(0, 100) + 'L' + pt(100, 0) + 'L' + pt(0, 0) + 'Z'}, svg);
    const labels = node('g', {class: 'tri-label'}, svg);
    for (const [name, poly] of Object.entries(USDA)) {
      const c = LABEL_AT[name] || poly.reduce((a, p) => a.map((v, i) => v + p[i] / poly.length), [0, 0, 0]);
      const [x, y] = pt(c[0], c[2]);
      node('text', {x, y, dy: '0.32em'}, labels, SHORT[name]);
    }
    const axes = node('g', {class: 'tri-axis'}, svg);
    for (let v = 20; v <= 80; v += 20) {
      let [x, y] = pt(v, 100 - v); node('text', {x: x - 5, y, dy: '0.32em', 'text-anchor': 'end'}, axes, v);
      [x, y] = pt(100 - v, 0); node('text', {x: x + 5, y, dy: '0.32em'}, axes, v);
      [x, y] = pt(0, v); node('text', {x, y: y + 11, 'text-anchor': 'middle'}, axes, v);
    }
    const [lx, ly] = pt(50, 50), [rx, ry] = pt(50, 0);
    node('text', {class: 'tri-title', 'text-anchor': 'middle', transform: 'translate(' + (lx - 22) + ',' + ly + ') rotate(-60)'}, svg, 'Clay %');
    node('text', {class: 'tri-title', 'text-anchor': 'middle', transform: 'translate(' + (rx + 22) + ',' + ry + ') rotate(60)'}, svg, 'Silt %');
    node('text', {class: 'tri-title', 'text-anchor': 'middle', x: PAD_X + SIDE / 2, y: PAD_Y + H + 27}, svg, 'Sand %');
    const dotLayer = node('g', {}, svg), ringLayer = node('g', {}, svg);
    const dots = samples.map(s => { const [x, y] = pt(s.clay, s.sand); return {s, x, y, el: node('circle', {class: 'tri-dot', cx: x, cy: y, r: 3.6}, dotLayer)}; });
    const ring = node('circle', {class: 'tri-ring', r: 6.8}, ringLayer);

    // ---------- rendering ----------
    function scale() {
      const def = COLOR_BY[colorBy], vals = samples.map(s => def.get(s, stateId));
      const lo = quantile(vals, 0.02), hi = quantile(vals, 0.98);
      return {def, lo, hi, color: v => { const R = ramp(); return Number.isFinite(v) ? R[Math.max(0, Math.min(R.length - 1, Math.round((v - lo) / ((hi - lo) || 1) * (R.length - 1))))] : '#7d8a88'; }};
    }
    function renderTriangle() {
      const sc = scale();
      for (const d of dots) {
        const on = !texture || d.s.texture === texture;
        d.el.setAttribute('fill', sc.color(sc.def.get(d.s, stateId)));
        d.el.classList.toggle('muted', !on);
      }
      for (const [name, p] of Object.entries(classPaths)) p.classList.toggle('on', name === texture);
      const sel = current();
      ring.style.display = sel ? '' : 'none';
      if (sel) { const [x, y] = pt(sel.clay, sel.sand); ring.setAttribute('cx', x); ring.setAttribute('cy', y); }
      $('soilLegend').innerHTML = (colorBy === 'theta' ? '<span>at ' + esc(stateInfo[stateId].short) + '</span>' : '') +
        '<span class="soil-ramp"><b>' + fmt(sc.lo, sc.def.digits) + '</b><i style="background:linear-gradient(90deg,' + ramp().join(',') + ')"></i><b>' + fmt(sc.hi, sc.def.digits) + ' ' + esc(sc.def.unit) + '</b></span>';
    }
    function renderSampleList() {
      const list = samples.filter(s => !texture || s.texture === texture);
      const byStation = {};
      for (const s of list) (byStation[s.station] = byStation[s.station] || []).push(s);
      $('soilSample').innerHTML = '<option value="">Choose a core…</option>' + Object.keys(byStation).sort().map(st =>
        '<optgroup label="' + esc(st) + '">' + byStation[st].sort((a, b) => a.depth - b.depth || a.core - b.core).map(s =>
          '<option value="' + s.id + '">' + esc(st + ' · ' + s.depth + ' cm · core ' + s.core + ' · ' + s.texture) + '</option>').join('') + '</optgroup>').join('');
      $('soilSample').value = current() && list.includes(current()) ? String(sampleId) : '';
    }
    function renderDetails() {
      const s = current(), r = s && s.readings[stateId];
      $('soilStates').innerHTML = states.filter(st => s.readings[st.id]).map(st => {
        const x = s.readings[st.id];
        return '<button type="button" data-state="' + st.id + '" aria-pressed="' + (st.id === stateId) + '"' + (x.flag ? ' class="flagged" title="' + esc(x.flag) + '"' : '') +
          '><span>' + esc(st.short) + (x.flag ? ' <i aria-label="flagged">!</i>' : '') + '</span><b>θ ' + fmt(x.theta, 2) + '</b></button>';
      }).join('');
      $('soilFlag').hidden = !r.flag; $('soilFlag').textContent = r.flag || '';
      const facts = [
        ['Texture', s.texture],
        ['Sand · silt · clay', fmt(s.sand, 0) + ' · ' + fmt(s.silt, 0) + ' · ' + fmt(s.clay, 0) + ' %'],
        ['OM · bulk density', fmt(s.om, 1) + ' % · ' + fmt(s.bd, 2) + ' g/cm³'],
        ['Water content θ', fmt(r.theta, 3) + ' m³/m³'],
        ['Conductivity λ', fmt(r.lambda, 3) + ' W/(m·K)'],
        ['Heat capacity C', fmt(r.C, 2) + ' MJ/(m³·K)']
      ];
      $('soilFacts').innerHTML = facts.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('');
      const note = (s.textureFromPair || s.omFromPair) ? 'Texture and OM come from the paired core at the same station and depth.' : '';
      $('soilNote').textContent = note; $('soilNote').hidden = !note;
      renderCurve(s, r);
    }

    // ---------- KD2 Pro reading of the selected sample ----------
    const curve = $('soilCurve'), CW = 340, CH = 96, M = {l: 30, r: 8, t: 8, b: 20};
    curve.setAttribute('viewBox', '0 0 ' + CW + ' ' + CH);
    let curveData = null;
    function renderCurve(s, r) {
      curve.replaceChildren(); curveData = null;
      $('soilCurveBox').hidden = !(r && r.riseMk);
      if (!r || !r.riseMk) return;
      const meas = r.riseMk.map(v => v / 1000), model = engine ? kd2Model(r, data.probe, engine) : null;
      const tMax = (meas.length - 1) * r.dtS, yMax = Math.max(...meas, ...(model || [0])) * 1.08;
      const X = t => M.l + t / tMax * (CW - M.l - M.r), Y = v => CH - M.b - v / yMax * (CH - M.t - M.b);
      node('rect', {class: 'kd2-heat', x: X(0), y: M.t, width: X(r.heatS) - X(0), height: CH - M.t - M.b}, curve);
      node('text', {class: 'kd2-axis', x: X(r.heatS / 2), y: M.t + 9, 'text-anchor': 'middle'}, curve, 'heater on');
      const step = yMax > 2 ? 1 : yMax > 1 ? 0.5 : 0.25;
      for (let v = 0; v <= yMax; v += step) {
        node('line', {class: 'kd2-grid', x1: M.l, x2: CW - M.r, y1: Y(v), y2: Y(v)}, curve);
        node('text', {class: 'kd2-axis', x: M.l - 4, y: Y(v), dy: '0.32em', 'text-anchor': 'end'}, curve, v.toFixed(step < 1 ? 2 : 0));
      }
      for (let t = 0; t <= tMax; t += 30) node('text', {class: 'kd2-axis', x: X(t), y: CH - 6, 'text-anchor': 'middle'}, curve, t + (t === 0 ? '' : t + 30 > tMax ? ' s' : ''));
      if (model) node('path', {class: 'kd2-model', d: 'M' + model.map((v, i) => X(i * r.dtS).toFixed(1) + ',' + Y(v).toFixed(1)).join('L')}, curve);
      const pts = node('g', {class: 'kd2-meas'}, curve);
      meas.forEach((v, i) => node('circle', {cx: X(i * r.dtS), cy: Y(v), r: 1.9}, pts));
      const cursor = node('line', {class: 'kd2-cursor', y1: M.t, y2: CH - M.b, opacity: 0}, curve);
      curveData = {meas, model, r, X, cursor, tMax};
      const peak = Math.max(...meas), ip = meas.indexOf(peak);
      const ratio = model ? Math.max(...model) / peak : NaN;
      curveData.note = 'Measured peak ' + fmt(peak, 2) + ' °C at ' + ip * r.dtS + ' s · ' + fmt(r.powerWm, 1) + ' W/m' +
        (model ? ' · twin peak ' + (ratio >= 1 ? '+' : '') + fmt((ratio - 1) * 100, 1) + '%' : '');
      $('soilCurveNote').textContent = curveData.note;
    }
    curve.addEventListener('pointermove', e => {
      if (!curveData) return;
      const b = curve.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * CW;
      const {meas, model, r, X, cursor, tMax} = curveData;
      const i = Math.max(0, Math.min(meas.length - 1, Math.round((x - M.l) / (CW - M.l - M.r) * tMax / r.dtS)));
      cursor.setAttribute('x1', X(i * r.dtS)); cursor.setAttribute('x2', X(i * r.dtS)); cursor.setAttribute('opacity', 1);
      $('soilCurveNote').textContent = i * r.dtS + ' s · measured ' + fmt(meas[i], 3) + ' °C' + (model ? ' · twin ' + fmt(model[i], 3) + ' °C' : '');
    });
    curve.addEventListener('pointerleave', () => { if (curveData) { curveData.cursor.setAttribute('opacity', 0); $('soilCurveNote').textContent = curveData.note; } });

    // ---------- selection ----------
    function emit() {
      const s = current(), r = s && s.readings[stateId];
      onChange({id: 'core-' + s.id + '-' + stateId, station: s.station, depth: s.depth, core: s.core, state: stateInfo[stateId].short,
        label: s.station + ' ' + s.depth + ' cm · ' + stateInfo[stateId].short, texture: s.texture, bd: s.bd,
        lambda: r.lambda, C: r.C * 1e6, theta: r.theta, flag: r.flag});
    }
    function pickState(s, preferred) {
      if (s.readings[preferred]) return preferred;
      const order = states.map(st => st.id), at = order.indexOf(preferred);
      return order.map((id, i) => [id, Math.abs(i - at)]).filter(([id]) => s.readings[id]).sort((a, b) => a[1] - b[1])[0][0];
    }
    function selectSample(id, notify = true) {
      const s = samples.find(x => x.id === id);
      if (!s) return;
      sampleId = s.id; stateId = pickState(s, stateId);
      renderTriangle(); renderSampleList(); renderDetails();
      if (notify) emit();
    }

    // Hover and click use the nearest visible dot within 12 px; repeated clicks cycle through
    // cores that share a texture (the two cores at each station depth share one position).
    // Screen <-> triangle coordinates through the SVG's own transform (the triangle is letterboxed).
    const toSvg = (cx, cy) => { const m = svg.getScreenCTM().inverse(); return [m.a * cx + m.c * cy + m.e, m.b * cx + m.d * cy + m.f]; };
    const toScreen = (x, y) => { const m = svg.getScreenCTM(); return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; };
    function nearest(e) {
      const [x, y] = toSvg(e.clientX, e.clientY), k = 1 / svg.getScreenCTM().a;
      const hits = dots.filter(d => !d.el.classList.contains('muted')).map(d => [d, Math.hypot(d.x - x, d.y - y)]).filter(([, dist]) => dist < 12 * k + 4)
        .sort((a, b) => a[1] - b[1]);
      if (!hits.length) return [];
      const [x0, y0] = [hits[0][0].x, hits[0][0].y];
      return hits.map(h => h[0]).filter(d => d.x === x0 && d.y === y0);
    }
    const tip = $('soilTip');
    svg.addEventListener('pointermove', e => {
      const hit = nearest(e);
      svg.style.cursor = hit.length ? 'pointer' : '';
      if (!hit.length) { tip.hidden = true; return; }
      const sc = scale(), s = hit[0].s, host = panel.querySelector('.soil-triangle').getBoundingClientRect();
      tip.innerHTML = '<strong>' + esc(hit.map(h => h.s.station + ' ' + h.s.depth + ' cm').filter((v, i, a) => a.indexOf(v) === i).join(', ')) + '</strong>' +
        '<span>' + esc(s.texture) + ' · sand ' + fmt(s.sand, 0) + ' · clay ' + fmt(s.clay, 0) + ' %</span>' +
        '<span>' + esc(sc.def.label) + ' ' + hit.map(h => fmt(sc.def.get(h.s, stateId), sc.def.digits)).join(' / ') + ' ' + esc(sc.def.unit) + (hit.length > 1 ? ' · ' + hit.length + ' cores, click to cycle' : '') + '</span>';
      tip.hidden = false;
      const [sx, sy] = toScreen(hit[0].x, hit[0].y), x = sx - host.left, y = sy - host.top;
      tip.style.left = Math.min(host.width - tip.offsetWidth - 4, Math.max(4, x - tip.offsetWidth / 2)) + 'px';
      tip.style.top = (y - tip.offsetHeight - 10 < 0 ? y + 12 : y - tip.offsetHeight - 10) + 'px';
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; svg.style.cursor = ''; });
    svg.addEventListener('click', e => {
      const hit = nearest(e); if (!hit.length) return;
      const at = hit.findIndex(h => h.s.id === sampleId);
      lastPick = at >= 0 ? (at + 1) % hit.length : 0;
      selectSample(hit[lastPick].s.id);
    });
    $('soilSample').addEventListener('change', e => { if (e.target.value !== '') selectSample(Number(e.target.value)); });
    $('soilTexture').addEventListener('change', e => { texture = e.target.value; renderTriangle(); renderSampleList(); });
    $('soilColor').addEventListener('change', e => { colorBy = e.target.value; renderTriangle(); });
    $('soilStates').addEventListener('click', e => {
      const b = e.target.closest('button[data-state]'); if (!b) return;
      stateId = b.dataset.state; renderTriangle(); renderDetails(); emit();
    });

    $('soilColor').value = colorBy;
    selectSample(sampleId, false);
    return {selectSample: (id, state) => { if (state) stateId = state; selectSample(id); }, emit, redraw: () => { renderTriangle(); renderDetails(); }, get selection() { return {sampleId, stateId}; }};
  }

  root.SoilPanel = {mount, kd2Model, USDA};
})(typeof globalThis !== 'undefined' ? globalThis : this);
