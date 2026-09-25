'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {buildRoute} = require('../docs/sensor-routes');

const context = {window: {}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/board-data.js'), 'utf8'), context);
const board = JSON.parse(JSON.stringify(context.window.SensorBoard));
const sourceGroups = [
  {nets: ['5V_LDO', '+5V', 'VREF'], sourcePads: [{ref: 'U3', pin: 3}, {ref: 'D7', pin: 1}, {ref: 'R11', pin: 2}]},
  {nets: ['D9_HEAT', 'HEAT_GATE', 'D4_EXC', 'EXC_GATE'], sourcePads: [{ref: 'U1', pin: 29}, {ref: 'R9', pin: 2}, {ref: 'U1', pin: 45}, {ref: 'R12', pin: 2}]},
  {nets: ['A4_SDA', 'A5_SCL'], sourcePads: [{ref: 'U1', pin: 47}, {ref: 'U1', pin: 48}]}
];

test('actual routes include every selected copper item with exact geometry, layer and index', () => {
  const before = JSON.stringify(board);
  for (const options of sourceGroups) {
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
    assert.ok(route.some(segment => segment.via), 'selected vias are retained');
    assert.ok(route.some(segment => !segment.via && segment.layer === 'bottom'), 'bottom copper is retained');
  }
  assert.equal(JSON.stringify(board), before, 'source export is not mutated');
});

test('selection is explicit, net-exact and never includes zones or invented links', () => {
  const route = buildRoute(board, {nets: ['VREF', 'VREF']});
  assert.ok(route.every(segment => segment.net === 'VREF' && segment.direction === 0));
  assert.equal(new Set(route.map(segment => segment.index)).size, route.length);
  assert.deepEqual(buildRoute(board, {nets: []}), []);
  assert.deepEqual(buildRoute(board, {nets: ['not-a-net']}), []);
  assert.throws(() => buildRoute(board, {nets: 'VREF'}), TypeError);
  assert.throws(() => buildRoute(board, {nets: ['VREF'], sourcePads: [{ref: 'missing', pin: 1}]}), RangeError);
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

test('browser and CommonJS expose the same geometry selection', () => {
  const browser = {};
  vm.createContext(browser);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sensor-routes.js'), 'utf8'), browser);
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

test('Nano export matches released sources and retains all four layers', () => {
  const {createHash} = require('node:crypto');
  const digest = file => createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex');
  assert.equal(board.sha256, digest(board.source));
  assert.equal(board.bomSource, 'flat-nano/fab/HP-SDI12-NANO_BOM.csv');
  assert.equal(board.bomSha256, digest(board.bomSource));
  assert.equal(board.heaterSpec.heaterCount, 17);
  assert.equal(board.heaterSpec.rEachOhm, 3.3);
  assert.equal(board.heaterSpec.heaterRatingW, .33);
  const heaters = board.footprints.filter(fp => /^RH\d+$/.test(fp.ref));
  assert.equal(heaters.length, 17);
  for (const fp of heaters) {
    assert.equal(fp.mpn, 'CRCW06033R30FKEAHP');
    assert.equal(fp.lcsc, 'C313752');
    assert.ok(Math.abs(fp.xy[0] - (board.bodyLengthMm + 8.8 + (Number(fp.ref.slice(2))-1)*2.6)) < .001);
  }
  assert.deepEqual(board.copperLayers, ['top', 'inner1', 'inner2', 'bottom']);
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
