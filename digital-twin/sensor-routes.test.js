'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {buildRoute} = require('../docs/sensor-routes');

const docs = file => fs.readFileSync(path.join(__dirname, '../docs', file), 'utf8');
const context = {window: {}};
vm.createContext(context);
vm.runInContext(docs('board-data.js'), context);
const board = JSON.parse(JSON.stringify(context.window.SensorBoard));
const part = ref => board.footprints.find(fp => fp.ref === ref);
const padOf = (ref, pin) => part(ref).pads.find(pad => pad.pin === String(pin));
const inPad = (point, pad) => Math.abs(point[0] - pad.xy[0]) <= pad.size[0] / 2 + 1e-8 &&
  Math.abs(point[1] - pad.xy[1]) <= pad.size[1] / 2 + 1e-8;
// Drawn start and end of a routed segment (direction -1 reverses a->b).
const ends = segment => segment.direction === -1 ? [segment.b, segment.a] : [segment.a, segment.b];

// bottom: the group is expected to use bottom copper and vias on this board.
const sourceGroups = [
  {nets: ['SW', '5V_BUCK', '+5V'], sourcePads: [{ref: 'U3', pin: 5}, {ref: 'L1', pin: 2}, {ref: 'D7', pin: 1}]},
  {nets: ['D4_EXC', 'VREF'], sourcePads: [{ref: 'U1', pin: 45}, {ref: 'R11', pin: 2}]},
  {nets: ['D9_HEAT', 'HEAT_GATE'], sourcePads: [{ref: 'U1', pin: 29}, {ref: 'R9', pin: 2}], bottom: true},
  {nets: ['A4_SDA', 'A5_SCL'], sourcePads: [{ref: 'U1', pin: 47}, {ref: 'U1', pin: 48}], bottom: true},
  {nets: ['HEAT_RTN'], sourcePads: [{ref: 'RH17', pin: 2}], bottom: true}
];

test('actual routes include every selected copper item with exact geometry, layer and index', () => {
  const before = JSON.stringify(board);
  for (const {bottom, ...options} of sourceGroups) {
    const route = buildRoute(board, options);
    const expected = board.tracks.map((track, index) => ({track, index})).filter(item => options.nets.includes(item.track.net));
    assert.equal(route.length, expected.length);
    assert.ok(route.length > 0);
    assert.deepEqual(route.map(segment => segment.index), expected.map(item => item.index));
    for (const segment of route) {
      const {index, direction, ...geometry} = segment;
      assert.deepEqual(geometry, board.tracks[index]);
      assert.ok([-1, 0, 1].includes(direction));
      assert.ok(options.nets.includes(segment.net));
      assert.notEqual(segment.a, board.tracks[index].a);
      assert.notEqual(segment.b, board.tracks[index].b);
    }
    if (bottom) {
      assert.ok(route.some(segment => segment.via), options.nets + ': selected vias are retained');
      assert.ok(route.some(segment => !segment.via && segment.layer === 'bottom'), options.nets + ': bottom copper is retained');
    }
    // Every source pad sits on a selected net, so none is skipped silently.
    for (const source of options.sourcePads) assert.ok(options.nets.includes(padOf(source.ref, source.pin).net));
  }
  assert.equal(JSON.stringify(board), before, 'source export is not mutated');
});

test('selection is explicit, net-exact and never includes zones or invented links', () => {
  const route = buildRoute(board, {nets: ['VREF', 'VREF']});
  assert.ok(route.length > 0);
  assert.ok(route.every(segment => segment.net === 'VREF' && segment.direction === 0));
  assert.equal(new Set(route.map(segment => segment.index)).size, route.length);
  assert.deepEqual(buildRoute(board, {nets: []}), []);
  assert.deepEqual(buildRoute(board, {nets: ['not-a-net']}), []);
  assert.throws(() => buildRoute(board, {nets: 'VREF'}), TypeError);
  assert.throws(() => buildRoute(board, {nets: ['VREF'], sourcePads: [{ref: 'missing', pin: 1}]}),
    {name: 'RangeError', message: 'Unknown source pad: missing.1'});
});

test('orientation follows source-connected endpoints across a real via, preserving original coordinates', () => {
  const trace = (a, b, layer = 'top', net = 'A', via = false) => ({a, b, layer, net, via, width: via ? 0.6 : 0.2});
  const fixture = {footprints: [{ref: 'U', pads: [{pin: '1', net: 'A', xy: [0, 0], size: [0.1, 0.1], drill: [0, 0]}]}], tracks: [
    trace([0, 0], [1, 0]), trace([2, 0], [1, 0]), trace([2, 0], [2, 0], 'top', 'A', true),
    trace([3, 0], [2, 0], 'bottom'), trace([3, 0], [4, 0], 'top'), trace([0, 0], [1, 0], 'top', 'B')
  ]};
  const route = buildRoute(fixture, {nets: ['A', 'B'], sourcePads: [{ref: 'U', pin: 1}]});
  assert.deepEqual(route.map(segment => segment.direction), [1, -1, 0, -1, 0, 0]);
  route.forEach(segment => assert.deepEqual(segment.a, fixture.tracks[segment.index].a));
  assert.equal(route[4].direction, 0, 'a crossing coordinate cannot join different layers without a via');
  assert.equal(route[5].direction, 0, 'coincident different nets cannot connect');
});

test('unresolved branches and pad-interior endpoints stay conservative; separate nets need separate sources', () => {
  const fixture = {footprints: [{ref: 'R', pads: [
    {pin: '1', net: 'A', xy: [0, 0], size: [0.8, 0.6], drill: [0, 0]},
    {pin: '2', net: 'B', xy: [2, 0], size: [0.8, 0.6], drill: [0, 0]}
  ]}], tracks: [
    {a: [0.2, 0], b: [1, 0], net: 'A', layer: 'top', width: 0.2, via: false},
    {a: [2, 0], b: [3, 0], net: 'B', layer: 'top', width: 0.2, via: false},
    {a: [7, 0], b: [8, 0], net: 'A', layer: 'top', width: 0.2, via: false}
  ]};
  const route = buildRoute(fixture, {nets: ['A', 'B'], sourcePads: [{ref: 'R', pin: 1}]});
  assert.deepEqual(route.map(segment => segment.direction), [1, 0, 0]);
  const both = buildRoute(fixture, {nets: ['A', 'B'], sourcePads: [{ref: 'R', pin: 1}, {ref: 'R', pin: 2}]});
  assert.deepEqual(both.map(segment => segment.direction), [1, 1, 0]);
  assert.equal(route.length, fixture.tracks.length, 'unresolved copper remains visible without fabricated direction');
});

test('T-junctions join same-net, same-layer copper only, within a small tolerance', () => {
  const trace = (a, b, layer = 'top', net = 'A') => ({a, b, layer, net, via: false, width: 0.2});
  const fixture = {footprints: [{ref: 'U', pads: [{pin: '1', net: 'A', xy: [0, 0], size: [0.1, 0.1], drill: [0, 0]}]}], tracks: [
    trace([0, 0], [4, 0]),                                   // 0: fed from U.1
    {a: [2, 0], b: [2, 0], layer: 'top', net: 'A', via: true, width: 0.6, layers: ['top', 'inner2']},
    trace([2, 0], [2, 3], 'inner2'),                         // 2: leaves the via in the middle of 0
    trace([3, 2], [3, 0.0005]),                              // 3: ends on 0 within tolerance
    trace([1, 0], [1, -2], 'top', 'B'),                      // 4: other net touching 0
    trace([1.5, 0], [1.5, 2], 'bottom'),                     // 5: other layer touching 0
    trace([3.5, 0.01], [3.5, 2])                             // 6: 0.01 mm away, not joined
  ]};
  const route = buildRoute(fixture, {nets: ['A', 'B'], sourcePads: [{ref: 'U', pin: 1}]});
  assert.deepEqual(route.map(segment => segment.direction), [1, 0, 1, -1, 0, 0, 0]);
  route.forEach(segment => assert.deepEqual([segment.a, segment.b], [fixture.tracks[segment.index].a, fixture.tracks[segment.index].b]),
    'split points are graph-only; returned geometry is unchanged');
});

test('segment ends inside the same pad join through that pad', () => {
  const fixture = {footprints: [
    {ref: 'U', pads: [{pin: '1', net: 'A', xy: [0, 0], size: [0.1, 0.1], drill: [0, 0]}]},
    {ref: 'C', pads: [{pin: '1', net: 'A', xy: [5, 0], size: [1, 1], drill: [0, 0]},
      {pin: '2', net: 'B', xy: [6.5, 0], size: [1, 1], drill: [0, 0]}]}
  ], tracks: [
    {a: [0, 0], b: [4.8, 0], net: 'A', layer: 'top', width: 0.2, via: false},
    {a: [8, 0], b: [5.2, 0.1], net: 'A', layer: 'top', width: 0.2, via: false},
    {a: [6.4, 0], b: [9, 0], net: 'B', layer: 'top', width: 0.2, via: false}
  ]};
  const route = buildRoute(fixture, {nets: ['A', 'B'], sourcePads: [{ref: 'U', pin: 1}]});
  assert.deepEqual(route.map(segment => segment.direction), [1, -1, 0]);
});

test('browser and CommonJS expose the same geometry selection', () => {
  const browser = {};
  vm.createContext(browser);
  vm.runInContext(docs('sensor-routes.js'), browser);
  const actual = browser.SensorRoutes.buildRoute(board, sourceGroups[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), buildRoute(board, sourceGroups[0]));
});

test('four-layer vias connect only layers with actual copper annuli', () => {
  const fixture = {footprints: [{ref: 'U', pads: [{pin: '1', net: 'A', xy: [0, 0], size: [.1, .1], drill: [0, 0]}]}], tracks: [
    {a: [0, 0], b: [1, 0], layer: 'top', net: 'A', width: .2, via: false},
    {a: [1, 0], b: [1, 0], layer: 'top', net: 'A', width: .6, via: true,
      layers: ['top', 'inner2', 'bottom'], holeLayers: ['top', 'inner1', 'inner2', 'bottom']},
    {a: [1, 0], b: [2, 0], layer: 'inner2', net: 'A', width: .2, via: false},
    {a: [1, 0], b: [2, 0], layer: 'inner1', net: 'A', width: .2, via: false}
  ]};
  const route = buildRoute(fixture, {nets: ['A'], sourcePads: [{ref: 'U', pin: 1}]});
  assert.deepEqual(route.map(segment => segment.direction), [1, 0, 1, 0]);
});

test('heater feed and return get a direction along the real copper', () => {
  const inner = board.tracks.filter(track => track.net === 'VIN_P' && track.layer === 'inner2' && !track.via);
  assert.ok(inner.length > 0, 'the VIN_P heater feed runs on In2');
  assert.ok(inner.every(track => track.width >= 1.2 - 1e-9), 'the In2 heater feed is a 1.2 mm strip');
  const feed = buildRoute(board, {nets: ['VIN', 'VIN_P'], sourcePads: [{ref: 'J1', pin: 1}, {ref: 'D1', pin: 1}]});
  const strip = feed.filter(segment => segment.layer === 'inner2');
  assert.equal(strip.length, inner.length);
  assert.ok(strip.every(segment => segment.direction !== 0), 'the In2 strip is directed from D1 toward R5');
  const r5 = padOf('R5', 1), d1 = padOf('D1', 1);
  // The strip carries current away from D1 (near J1) toward R5.
  for (const segment of strip) {
    const [from, to] = ends(segment);
    assert.ok(Math.hypot(to[0] - r5.xy[0], to[1] - r5.xy[1]) < Math.hypot(from[0] - r5.xy[0], from[1] - r5.xy[1]));
  }
  const toR5 = feed.find(segment => segment.layer === 'top' && segment.width >= .5 && inPad(segment.a, r5) !== inPad(segment.b, r5));
  assert.ok(toR5 && inPad(ends(toR5)[1], r5), 'the feed surfaces and ends in R5 pin 1');
  assert.ok(feed.filter(segment => !segment.via && (inPad(segment.a, d1) || inPad(segment.b, d1)))
    .every(segment => inPad(ends(segment)[0], d1)), 'VIN_P leaves D1 pin 1');
  const back = buildRoute(board, {nets: ['HEAT_RTN'], sourcePads: [{ref: 'RH17', pin: 2}]});
  assert.ok(back.filter(segment => !segment.via).every(segment => segment.direction !== 0));
  const q1 = padOf('Q1', 3);
  assert.ok(back.some(segment => !segment.via && inPad(ends(segment)[1], q1)), 'the return ends at Q1 drain');
});

test('VREF flows from R11 pin 2 through the R23 pad toward AREF, not back from R23', () => {
  const route = buildRoute(board, {nets: ['D4_EXC', 'VREF'], sourcePads: [{ref: 'U1', pin: 45}, {ref: 'R11', pin: 2}]});
  assert.ok(route.every(segment => segment.via || segment.direction !== 0), 'every excitation segment is directed');
  const r11 = padOf('R11', 2), r23 = padOf('R23', 1), aref = padOf('U1', 59);
  assert.equal(r23.net, 'VREF');
  assert.equal(aref.net, 'VREF');
  const vref = route.filter(segment => segment.net === 'VREF');
  const fromR11 = vref.filter(segment => inPad(segment.a, r11) || inPad(segment.b, r11));
  assert.ok(fromR11.length > 0 && fromR11.every(segment => inPad(ends(segment)[0], r11)));
  const atR23 = vref.filter(segment => inPad(segment.a, r23) || inPad(segment.b, r23));
  const same = (p, q) => p[0] === q[0] && p[1] === q[1];
  // The R23 segment that shares a vertex with the R11 branch feeds R23; the other leaves it.
  const r11Side = atR23.filter(segment => fromR11.some(branch => [branch.a, branch.b].some(p => same(p, segment.a) || same(p, segment.b))));
  assert.ok(r11Side.length > 0 && r11Side.every(segment => inPad(ends(segment)[1], r23)));
  assert.ok(atR23.filter(segment => !r11Side.includes(segment)).every(segment => inPad(ends(segment)[0], r23)));
  assert.ok(vref.filter(segment => inPad(segment.a, aref) || inPad(segment.b, aref)).every(segment => inPad(ends(segment)[1], aref)),
    'VREF enters AREF (U1 pin 59)');
});

// Minimal SVG DOM for mounting the board drawing in Node.
function fakeDom() {
  class Element {
    constructor(tag) {
      this.tagName = tag; this.attributes = {}; this.children = []; this.dataset = {}; this.textContent = '';
      const classes = new Set();
      this.classList = {add: (...names) => names.forEach(name => classes.add(name)), remove: name => classes.delete(name),
        contains: name => classes.has(name) || (this.attributes.class || '').split(/\s+/).includes(name),
        toggle: (name, force) => { const on = force === undefined ? !classes.has(name) : !!force; on ? classes.add(name) : classes.delete(name); return on; }};
      this.style = {setProperty: (key, value) => { this.style[key] = value; }};
    }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key]; }
    append(...children) { this.children.push(...children); }
    addEventListener() {}
    dispatchEvent() { return true; }
    querySelectorAll() { return []; }
    *walk() { yield this; for (const child of this.children) if (child instanceof Element) yield* child.walk(); }
  }
  return {Element, document: {createElementNS: (ns, tag) => new Element(tag), createElement: tag => new Element(tag)}};
}

function mountBoard() {
  const {Element, document} = fakeDom();
  const page = {document, console};
  page.window = page;
  vm.createContext(page);
  vm.runInContext(docs('board-data.js'), page);
  vm.runInContext(docs('sensor-routes.js'), page);
  const calls = [], original = page.SensorRoutes.buildRoute;
  page.SensorRoutes = {buildRoute(data, options) { calls.push(JSON.parse(JSON.stringify(options))); return original(data, options); }};
  vm.runInContext(docs('sensor-annotations.js'), page);
  page.SensorHeatmap = {mount: () => ({refresh() {}, update() {}})};
  vm.runInContext(docs('sensor-board.js'), page);
  const svg = new Element('svg');
  const view = page.SensorBoardView.mount(svg, page.SensorBoard, () => {});
  return {svg, view, calls, byId: id => [...svg.walk()].find(element => element.attributes.id === id)};
}

test('sensor-board.js names only exported nets and source pads, and every route builds', () => {
  const {calls} = mountBoard();
  const nets = new Set([...board.tracks.map(track => track.net), ...board.footprints.flatMap(fp => fp.pads.map(pad => pad.net))]);
  assert.ok(calls.length >= 10, 'the drawing builds its activity routes');
  for (const options of calls) {
    for (const net of options.nets) assert.ok(nets.has(net), 'net ' + net + ' exists on the board');
    assert.ok(options.nets.some(net => board.tracks.some(track => track.net === net)), options.nets + ' selects copper');
    for (const source of options.sourcePads || []) {
      const pad = padOf(source.ref, source.pin);
      assert.ok(pad, 'source pad ' + source.ref + '.' + source.pin + ' exists');
      assert.ok(options.nets.includes(pad.net), source.ref + '.' + source.pin + ' (' + pad.net + ') is on a routed net');
    }
    assert.doesNotThrow(() => buildRoute(board, options));
  }
  // Net lists used for pad and zone coloring.
  const source = docs('sensor-board.js');
  const listed = [...source.matchAll(/\b\w+Nets=\[([^\]]*)\]/g)].flatMap(match => [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]));
  assert.ok(listed.length > 10);
  for (const net of listed) assert.ok(nets.has(net), 'colored net ' + net + ' exists on the board');
  assert.doesNotMatch(source, /'(?:5V_LDO|EXC_GATE|TH_RTN|A0_TH1|A2_TH3|Y1|J5|R12|R17|Q2)'/, 'no removed nets or parts');
});

test('sensor-board.js lights VREF only while pin D4 is HIGH and draws the In2 feed in the Parts view', () => {
  const {svg, view, byId} = mountBoard();
  const state = {stage: 'baseline', timeS: 1, activeRefs: [], heaterOn: false, logicValid: true, d9: false, d4: false};
  const run = {config: {fault: 'none'}};
  const vrefPads = [...svg.walk()].filter(element => element.attributes['data-net'] === 'VREF' && element.attributes.class === 'copper-pad');
  assert.ok(vrefPads.length > 0);
  view.update(state, run, true);
  assert.ok(vrefPads.every(element => !element.classList.contains('energized')), 'VREF is unpowered while pin D4 is LOW');
  assert.ok(byId('flow-logic').classList.contains('on') && !byId('flow-usb').classList.contains('on'));
  view.update({...state, d4: true}, run, true);
  assert.ok(vrefPads.every(element => element.classList.contains('energized')), 'VREF is powered while pin D4 is HIGH');
  view.update({...state, stage: 'pulse', heaterOn: true, d9: true}, run, true);
  assert.ok(byId('flow-heat').classList.contains('on') && byId('flow-return').classList.contains('on'));
  view.update(state, {config: {fault: 'usb-only'}}, true);
  assert.ok(byId('flow-usb').classList.contains('on') && !byId('flow-logic').classList.contains('on') &&
    !byId('flow-supply').classList.contains('on'), 'USB-only lights the clip feed, not the battery or buck');
  const heat = byId('flow-heat');
  assert.ok(heat.attributes.class.split(' ').includes('component-only'));
  const guides = heat.children.filter(element => (element.attributes.class || '').includes('inner-layer-guide'));
  const strip = board.tracks.map((track, index) => ({track, index})).filter(({track}) => track.layer === 'inner2' && track.net === 'VIN_P');
  assert.deepEqual(guides.map(element => Number(element.attributes['data-track-index'])).sort(), strip.map(item => item.index).sort());
  assert.ok(guides.every(element => !('data-copper-layers' in element.attributes) && !element.attributes.class.includes('undirected')));
  const shown = heat.children.filter(element => element.tagName === 'path');
  assert.ok(shown.every(element => board.tracks[Number(element.attributes['data-track-index'])].width >= .5 - 1e-9),
    'the Parts-view heater path uses only heater-current copper');
});

test('the Parts-view heater path ends only in heater-path pads, not in the buck input or surge branches', () => {
  const {byId} = mountBoard();
  const drawn = id => byId(id).children.filter(element => element.tagName === 'path').map(element => {
    const [, from, to] = element.attributes.d.match(/^M(\S+) L(\S+)$/);
    return {net: element.attributes['data-net'], from: from.split(',').map(Number), to: to.split(',').map(Number)};
  });
  const excluded = ['U3', 'C18', 'C1', 'D2'].flatMap(ref => part(ref).pads.map(pad => ({ref, pad})));
  const hits = point => excluded.filter(({pad}) => inPad(point, pad)).map(({ref, pad}) => ref + '.' + pad.pin);
  // The 0.5 mm VIN and VIN_P copper does branch to these parts, so the check below is not vacuous.
  const wide = buildRoute(board, {nets: ['VIN', 'VIN_P']}).filter(segment => !segment.via && segment.width >= .5 - 1e-9);
  assert.ok(wide.some(segment => hits(segment.a).length || hits(segment.b).length), 'the buck-input and surge branches exist');
  const heat = drawn('flow-heat');
  for (const segment of heat)
    assert.deepEqual([...hits(segment.from), ...hits(segment.to)], [], 'drawn heat segment on ' + segment.net + ' touches a pad without heater current');
  const reaches = (segments, ref, pin) => segments.some(segment => segment.net === padOf(ref, pin).net && inPad(segment.to, padOf(ref, pin)));
  for (const [ref, pin] of [['D1', 2], ['C3', 1], ['R5', 1], ...Array.from({length: 17}, (_, i) => ['RH' + (i + 1), 1])])
    assert.ok(reaches(heat, ref, pin), 'the heater path still reaches ' + ref + ' pin ' + pin);
  assert.ok(reaches(drawn('flow-return'), 'Q1', 3), 'the return still reaches Q1 pin 3');
});

test('J1 and J2 outlines span all of their holes', () => {
  const {byId} = mountBoard();
  for (const ref of ['J1', 'J2']) {
    const fp = part(ref), outline = byId('part-' + ref).children.find(element => element.attributes.class === 'part-outline');
    const x = Number(outline.attributes.x), y = Number(outline.attributes.y);
    const w = Number(outline.attributes.width), h = Number(outline.attributes.height);
    for (const pad of fp.pads)
      assert.ok(pad.xy[0] - pad.size[0] / 2 >= x && pad.xy[0] + pad.size[0] / 2 <= x + w &&
        pad.xy[1] - pad.size[1] / 2 >= y && pad.xy[1] + pad.size[1] / 2 <= y + h, ref + '.' + pad.pin + ' inside its outline');
    assert.equal(byId('part-' + ref).children.filter(element => element.attributes.class === 'part-body').length, 0, ref + ' has no package body');
  }
});

test('Nano export matches its sources and retains all four layers', () => {
  const {createHash} = require('node:crypto');
  const digest = file => createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex');
  assert.equal(board.sha256, digest(board.source));
  assert.equal(board.bomSource, 'flat-nano/fab/HP-SDI12-NANO_BOM.csv');
  assert.equal(board.bomSha256, digest(board.bomSource));
  assert.equal(board.revision, undefined);
  assert.doesNotMatch(JSON.stringify({board: board.board, notes: board.geometryNotes}), /\br\d\b|revision/i);
  assert.equal(board.heaterSpec.heaterCount, 17);
  assert.equal(board.heaterSpec.rEachOhm, 3.3);
  assert.equal(board.heaterSpec.heaterRatingW, .33);
  assert.equal(board.footprints.length, 70);
  const heaters = board.footprints.filter(fp => /^RH\d+$/.test(fp.ref));
  assert.equal(heaters.length, 17);
  for (const fp of heaters) {
    assert.equal(fp.mpn, 'CRCW06033R30FKEAHP');
    assert.equal(fp.lcsc, 'C313752');
    assert.ok(Math.abs(fp.xy[0] - (board.bodyLengthMm + 8.8 + (Number(fp.ref.slice(2))-1)*2.6)) < .001);
  }
  assert.deepEqual(board.copperLayers, ['top', 'inner1', 'inner2', 'bottom']);
  assert.equal(board.zones.length, 4, 'filled copper zones only; keepout rule areas are skipped');
  assert.ok(board.zones.every(zone => zone.net && zone.polygons.length > 0));
  for (const [layer, net] of [['inner1', 'GND'], ['inner2', '+5V']]) {
    const zones = board.zones.filter(zone => zone.layer === layer);
    assert.equal(zones.length, 1);
    assert.equal(zones[0].net, net);
    assert.ok(zones[0].polygons.length > 0);
    assert.ok(zones[0].polygons.every(poly => poly.outer.every(point => point[0] <= board.bodyLengthMm)));
  }
  const prongVias = board.tracks.filter(track => track.via && track.a[0] > board.bodyLengthMm);
  assert.ok(prongVias.length > 0);
  assert.ok(prongVias.every(via => !via.layers.includes('inner1') && !via.layers.includes('inner2')));
  assert.ok(prongVias.every(via => via.holeLayers.length === 4));
});

test('J1 pad 1 (+12 V) is the square middle hole on the center line', () => {
  const j1 = part('J1'), holes = [...j1.pads].sort((a, b) => a.xy[1] - b.xy[1]);
  assert.equal(j1.pads.length, 3);
  assert.equal(holes[1].pin, '1');
  assert.equal(holes[1].net, 'VIN');
  assert.equal(holes[1].shape, 'rectangle');
  assert.ok(Math.abs(holes[1].xy[1] - 9) < 1e-9, 'pad 1 lies on the board center line');
  assert.deepEqual(holes.filter(pad => pad.pin !== '1').map(pad => pad.net).sort(), ['GND', 'SDI_LINE']);
  assert.ok(j1.pads.every(pad => pad.drill[0] > 0), 'cable holes are plated through-holes');
  const j2 = part('J2');
  assert.deepEqual(j2.pads.map(pad => pad.net), ['VUSB', 'USB_DM', 'USB_DP', 'GND', 'MD']);
});

test('every footprint carries its package name and a body box', () => {
  for (const fp of board.footprints) {
    assert.equal(typeof fp.footprint, 'string');
    assert.ok(fp.footprint.length > 0);
    const [x0, y0, x1, y1] = fp.bodyBox;
    assert.ok(x1 > x0 && y1 > y0, fp.ref + ' body box has an area');
    assert.ok(Math.abs((x0 + x1) / 2 - fp.xy[0]) < 7 && Math.abs((y0 + y1) / 2 - fp.xy[1]) < 7);
    assert.equal(fp.bodySource, ['J1', 'J2'].includes(fp.ref) ? 'courtyard' : 'fab', fp.ref + ' body source');
  }
  const size = ref => { const [x0, y0, x1, y1] = part(ref).bodyBox; return [x1 - x0, y1 - y0].map(v => Math.round(v * 100) / 100); };
  assert.deepEqual(size('U1'), [10, 10]);
  assert.deepEqual(size('U3'), [2, 2]);
  assert.deepEqual(size('L1'), [4, 4]);
  assert.deepEqual(size('RH1'), [1.6, 0.85]);
});
