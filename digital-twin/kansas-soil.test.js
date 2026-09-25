'use strict';
// Run with: node digital-twin/kansas-soil.test.js (also works with node --test).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const K = require('../docs/kansas-soil-data.js');
const M = require('../docs/sensor-model.js');
const T = require('../docs/engine.js');
require('../docs/sensor-soil.js');
const {readWorkbook, records} = require('./xlsx-read.js');

const source = path.join(__dirname, '..', K.source);
const readings = K.samples.flatMap(s => Object.entries(s.readings).map(([state, r]) => ({s, state, r})));

test('soil data were built from the current reference workbook', () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  assert.equal(K.sha256, sha, 'workbook changed: run node digital-twin/kansas-soil-build.js');
});

test('xlsx reader returns the heat-pulse sheet with 60 readings per record', () => {
  const rows = records(readWorkbook(source).heat_pulse_timeseries);
  assert.equal(rows.length, 1448);
  const first = rows[0], temps = Object.keys(first).filter(k => /^temp_\d+s$/.test(k));
  assert.equal(temps.length, 60);
  assert.equal(first.thermal_cond, 1.515);
  assert.equal(first.temp_0s, 21.33);
});

test('every reading is kept and every core has texture, OM and bulk density', () => {
  assert.equal(readings.length, 1448);
  for (const s of K.samples) {
    assert.ok([s.sand, s.silt, s.clay, s.om, s.bd].every(Number.isFinite), s.station + ' ' + s.depth);
    assert.ok(Math.abs(s.sand + s.silt + s.clay - 100) < 0.5);
  }
  // Texture comes from core 2 and OM from core 1 at each station depth.
  assert.ok(K.samples.filter(s => s.core === 1).every(s => s.textureFromPair && !s.omFromPair));
  assert.ok(K.samples.filter(s => s.core === 2).every(s => !s.textureFromPair && s.omFromPair));
});

test('QA/QC heat-capacity flags reach the dashboard data', () => {
  assert.ok(readings.filter(x => x.state === '5kPa' || x.state === '10kPa').every(x => x.r.flag));
  assert.ok(readings.filter(x => x.state === 'sat').filter(x => x.r.flag).length === 0);
  assert.ok(readings.filter(x => x.r.flag).length > 78);
});

test('every reading is accepted by the sensor model', () => {
  for (const {r} of readings) assert.ok(M.validate({soilLambda: r.lambda, soilC: r.C * 1e6}).valid);
});

test('the twin reproduces a stored KD2 Pro curve', () => {
  const r = K.samples[0].readings.sat, model = globalThis.SoilPanel.kd2Model(r, K.probe, T);
  const meas = r.riseMk.map(v => v / 1000), ratio = Math.max(...model) / Math.max(...meas);
  assert.equal(meas.length, 60);
  assert.ok(ratio > 0.95 && ratio < 1.12, 'peak ratio ' + ratio);
  const rmse = Math.sqrt(model.reduce((a, v, i) => a + (v - meas[i]) ** 2, 0) / meas.length);
  assert.ok(rmse < 0.08, 'rmse ' + rmse);
});

test('the same core gives a larger side-needle rise when dry than when saturated', () => {
  const core = K.samples.find(s => s.readings.sat && s.readings.od40);
  const peak = r => { const run = M.simulate({soilLambda: r.lambda, soilC: r.C * 1e6}, T);
    return Math.max(...run.series.map(p => p.tempL)) - run.config.ambientC; };
  assert.ok(peak(core.readings.od40) > peak(core.readings.sat));
});

test('the dashboard opens on a typical, unflagged 33 kPa reading', () => {
  const s = K.samples.find(x => x.id === K.defaultSample.id), r = s.readings[K.defaultSample.state];
  assert.equal(K.defaultSample.state, '33kPa');
  assert.ok(!r.flag);
  assert.ok(Math.abs(r.lambda - 1.28) < 0.05 && Math.abs(r.C - 2.33) < 0.1, 'close to the Kansas 33 kPa medians');
});
