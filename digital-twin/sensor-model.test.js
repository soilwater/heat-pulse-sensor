'use strict';
// Run with: node digital-twin/sensor-model.test.js (also works with node --test).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../docs/sensor-model.js');
const T = require('../docs/engine.js');

function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('PWM weights ON/OFF losses and current, and does not square the average current', () => {
  const on = M.electrical({dutyPct: 100}), off = M.electrical({dutyPct: 0});
  for (const dutyPct of [0, 50, 100]) {
    const e = M.electrical({dutyPct}), d = dutyPct / 100;
    near(e.currentA, d * on.currentA);
    near(e.heaterPowerW, d * on.heaterPowerW);
    near(e.batteryPowerW, d * on.batteryPowerW + (1-d) * off.batteryPowerW);
    near(e.onCurrentA, on.currentA); near(e.onHeaterPowerW, on.heaterPowerW);
    near(e.onShuntVoltageV, on.shuntVoltageV);
    near(e.toleranceWorst.powerW, on.toleranceWorst.powerW);
    near(e.toleranceWorst.averagePowerW, d * on.toleranceWorst.powerW);
    for (const key of Object.keys(e.losses)) near(e.losses[key], d * on.losses[key] + (1-d) * off.losses[key]);
    for (const part of e.parts) {
      near(part.onPowerW, on.parts[0].powerW);
      near(part.powerW, d * part.onPowerW);
      near(part.utilization, on.parts[0].utilization);
    }
    near(e.batteryPowerW, e.heaterPowerW + Object.values(e.losses).reduce((a,b) => a+b, 0));
    near(e.inaPowerW - e.heaterPowerW, e.losses.copperW + e.losses.mosfetW);
  }
  const half = M.electrical({dutyPct: 50});
  near(half.heaterPowerW, 2 * half.currentA ** 2 * half.chainOhm);
  assert.ok(half.losses.cableW > half.totalA ** 2 * half.cableOhm);
});

test('low duty does not hide ON-state INA saturation or brownout', () => {
  const run = M.simulate({fault: 'chain-short', dutyPct: 1}, T);
  assert.ok(run.electrical.shuntVoltageV < 0.08192);
  assert.ok(run.electrical.onShuntVoltageV > 0.08192);
  assert.ok(run.warnings.some(w => w.code === 'INA_SATURATION'));
  assert.equal(M.stateAt(run, run.stages[2].startS + 1).logicValid, false);
});

test('zero duty keeps the heater cold and inactive while electronics and sensing operate', () => {
  const run = M.simulate({dutyPct: 0}, T), t = run.stages[2].startS + 1, s = M.stateAt(run, t);
  assert.equal(s.d9, false); assert.equal(s.heaterOn, false);
  assert.equal(s.onCurrentA, 0); assert.equal(s.onHeaterPowerW, 0);
  assert.equal(s.readings.length, 4);
  assert.ok(!s.activeRefs.some(ref => /^RH\d+$/.test(ref)));
  near(run.deliveredHeaterEnergyJ, 0);
  assert.ok(run.series.every(p => p.tempL === 22 && p.tempTip === 22 && p.tempHeatedZoneSoil === 22));
  const power = M.instantaneousPower(run, t);
  near(power.heaterW, 0); near(power.batteryW, 0.12);
  assert.ok(power.logicRailW > 0);
});

test('PWM energy and ideal thermal response scale with duty from a cold start', () => {
  const full = M.simulate({dutyPct: 100}, T), half = M.simulate({dutyPct: 50}, T);
  near(half.deliveredHeaterEnergyJ, 0.5 * full.deliveredHeaterEnergyJ);
  for (const run of [full, half]) {
    for (const t of [0, 1, run.stages[2].startS]) {
      const s = M.stateAt(run, t);
      near(s.heaterEnergyJ, 0);
      assert.ok(s.temperaturesC.every(temp => temp === 22));
    }
  }
  for (const t of [full.stages[2].startS + 3, full.stages[2].endS, full.stages[2].endS + 20]) {
    const a = M.stateAt(full, t), b = M.stateAt(half, t);
    near(b.heaterEnergyJ, a.heaterEnergyJ / 2);
    for (let i = 0; i < 4; i++) near(b.temperaturesC[i] - 22, (a.temperaturesC[i] - 22) / 2);
  }
});

test('a physically stuck heater ignores 0/50/100% duty in every stage', () => {
  const full = M.simulate({fault: 'Q1-stuck', dutyPct: 100}, T);
  for (const dutyPct of [0, 50, 100]) {
    const run = M.simulate({fault: 'Q1-stuck', dutyPct}, T);
    near(run.electrical.dutyPct, 100);
    near(run.electrical.heaterPowerW, full.electrical.heaterPowerW);
    near(run.deliveredHeaterEnergyJ, full.deliveredHeaterEnergyJ);
    for (const stage of run.stages) {
      const t = stage.startS + 0.05, s = M.stateAt(run, t);
      assert.equal(s.heaterOn, true); assert.equal(s.dutyPct, 100);
      near(s.heaterEnergyJ, full.electrical.onHeaterPowerW * t);
      near(M.instantaneousPower(run, t).heaterW, full.electrical.onHeaterPowerW);
      assert.deepEqual(s.temperaturesC, M.stateAt(full, t).temperaturesC);
    }
  }
});

test('heater identity controls count, rating, tolerance and thermal spacing without stale defaults', () => {
  const spec = {heaterCount: 12, rEachOhm: 4.7, heaterRatingW: 0.25, tolerancePct: 2,
    heaterDeratingStartC: 105, heaterMaxC: 155, heaterPartNumber: 'what-if-test', heaterStartMm: 9, heaterPitchMm: 3};
  const context = {HPTwin: T, SensorBoard: {heaterSpec: spec}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sensor-model.js'), 'utf8'), context);
  const browser = context.SensorModel, run = browser.simulate(), nodeRun = M.simulate(spec, T);
  assert.equal(browser.HEATER_COUNT, 12);
  assert.equal(run.electrical.parts.length, 12);
  assert.equal(run.electrical.parts.at(-1).ref, 'RH12');
  near(run.electrical.chainOhm, 12 * 4.7);
  near(run.electrical.ratingW, .25);
  near(browser.ratingAt(130), .125);
  near(run.electrical.toleranceWorst.highPartOhm, 4.7 * 1.02);
  const s = browser.stateAt(run, run.stages[2].startS + 1);
  assert.ok(s.activeRefs.includes('RH12')); assert.ok(!s.activeRefs.includes('RH13'));
  near(browser.temperatureAtPosition(run, 25, 1.385, 29.8), M.temperatureAtPosition(nodeRun, 25, 1.385, 29.8));
  assert.ok(!run.warnings.some(w => w.code === 'WHAT_IF'));
  assert.ok(nodeRun.warnings.some(w => w.code === 'WHAT_IF'));
});

test('released circuit values and modeled component refs match the flat netlist', () => {
  const n = JSON.parse(fs.readFileSync(path.join(__dirname, '../flat-nano/kicad/netlist.json'), 'utf8')).parts;
  assert.equal(Object.keys(n).filter(r => /^RH\d+$/.test(r)).length, M.HEATER_COUNT);
  const e = M.electrical();
  for (const p of e.parts) assert.equal(Number(n[p.ref].value), p.ohm);
  assert.equal(n.Q1.pins['3'], 'HEAT_RTN');
  assert.equal(n.Q2.pins['3'], 'TH_RTN');
  assert.equal(n.R11.pins['2'], 'VREF');
  assert.equal(n.U4.pins['8'], 'HEAT_P');
  const run = M.simulate({}, T);
  for (const stage of run.stages) {
    for (const ref of M.stateAt(run, stage.startS + 0.005).activeRefs) assert.ok(n[ref], `${ref} is absent from current netlist`);
  }
});

test('DC circuit obeys Ohm law and complete battery power accounting', () => {
  const c = {...M.defaultConfig(), dutyPct: 100}, e = M.electrical(c), chain = c.heaterCount * c.rEachOhm;
  near(e.chainOhm, 56.1, 1e-9);
  near(e.heaterPowerW, e.currentA ** 2 * chain);
  near(e.heaterVoltageV, chain * e.currentA);
  const losses = Object.values(e.losses).reduce((a, b) => a + b, 0);
  near(e.batteryPowerW, e.heaterPowerW + losses);
  near(e.inaPowerW - e.heaterPowerW, e.losses.copperW + e.losses.mosfetW);
  assert.ok(e.inaPowerW > e.heaterPowerW);
  assert.ok(e.currentA > 0.20 && e.currentA < 0.21);
});

test('pulse duration changes energy, not DC current or part power', () => {
  const a = M.electrical({pulseS: 8}), b = M.electrical({pulseS: 15});
  near(a.currentA, b.currentA);
  near(a.parts[0].powerW, b.parts[0].powerW);
  near(b.heaterEnergyJ / a.heaterEnergyJ, 15 / 8);
});

test('cycle-average ledger conserves battery power at 0/50/100% in every stage', () => {
  for (const dutyPct of [0, 50, 100]) {
  const run = M.simulate({dutyPct}, T);
  for (const stage of run.stages) {
    const atS = (stage.startS + stage.endS) / 2;
    const p = M.instantaneousPower(run, atS);
    assert.equal(p.valid, true);
    assert.equal(p.stage, stage.id);
    const sum = p.heaterW + p.shuntW + p.mosfetW + p.copperW + p.D1W + p.cableW +
      p.U3dissipationW + p.D7dissipationW + p.logicRailW;
    near(p.batteryW, sum);
    near(p.batteryW, run.config.batteryV * p.batteryCurrentA);
    near(p.batteryCurrentA - p.currentA, run.config.logicMa / 1000);
    near(p.electronics.inputW, p.U3dissipationW + p.D7dissipationW + p.logicRailW);
    near(p.perHeaterW.reduce((s, r) => s + r.powerW, 0), p.heaterW);
    assert.ok(p.U3dissipationW > 0 && p.D7dissipationW > 0 && p.logicRailW > 0);
  }
  }
});

test('heater power goes to zero at turn-off while the electronics remain powered', () => {
  const run = M.simulate({}, T), end = run.stages[2].endS;
  const before = M.instantaneousPower(run, end - 1e-6), after = M.instantaneousPower(run, end);
  assert.ok(before.heaterW > 1 && before.currentA > 0.1);
  for (const key of ['heaterW', 'currentA', 'shuntW', 'mosfetW', 'copperW']) near(after[key], 0);
  assert.ok(after.perHeaterW.every(p => p.powerW === 0));
  near(after.batteryW, 12 * 0.010);
  near(after.logicRailW, 4.75 * 0.010);
  near(after.D7dissipationW, 0.25 * 0.010);
  near(before.logicRailW, after.logicRailW);
  assert.ok(after.U3dissipationW > before.U3dissipationW, 'Less cable drop leaves slightly more regulator dissipation at fixed logic current.');
  near(after.cableW, 0.010 ** 2 * run.electrical.cableOhm);
  near(after.D1W, 0.010 * run.config.diodeV);
});

test('instantaneous electronics scale with the chosen aggregate current without invented chip allocations', () => {
  const zero = M.instantaneousPower(M.simulate({logicMa: 0}, T), 3);
  for (const key of ['batteryW', 'U3dissipationW', 'D7dissipationW', 'logicRailW']) near(zero[key], 0);
  const run = M.simulate({logicMa: 20}, T), p = M.instantaneousPower(run, 3);
  near(p.logicRailW, 4.75 * 0.020);
  near(p.D7dissipationW, 0.25 * 0.020);
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'U1W'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'U4W'), false);
  assert.match(p.electronics.allocation, /individual MCU\/INA consumption is not modeled/);
});

test('instantaneous ledger flags unsupported USB/dropout decomposition and follows a stuck heater', () => {
  for (const config of [{fault: 'usb-only'}, {batteryV: 6}, {fault: 'chain-short'}]) {
    const run = M.simulate(config, T), p = M.instantaneousPower(run, run.stages[2].startS + 1);
    assert.equal(p.valid, false);
    assert.equal(p.logicRailW, null);
    assert.equal(p.electronics.currentA, null);
  }
  const run = M.simulate({fault: 'Q1-stuck'}, T), p = M.instantaneousPower(run, run.stages[3].startS + 1);
  assert.equal(p.valid, true);
  assert.ok(p.heaterW > 1);
  near(p.heaterW, run.electrical.heaterPowerW);
});

test('ideal no-loss result agrees with V squared / R', () => {
  // R5 cannot be zero in validation; retain the actual 0.1R explicitly.
  const e = M.electrical({dutyPct: 100, cableM: 0, connectorOhm: 0, diodeV: 0, mosfetOhm: 0, copperOhm: 0, logicMa: 0});
  near(e.currentA, 12 / 56.2);
  near(e.parts[0].powerW, (12 / 56.2) ** 2 * 3.3);
});

test('temperature derating does not award extra wattage below 70 C', () => {
  near(M.ratingAt(-20), 0.33); near(M.ratingAt(40), 0.33); near(M.ratingAt(70), 0.33);
  near(M.ratingAt(112.5), 0.165); near(M.ratingAt(155), 0);
  assert.ok(M.electrical({ambientC: 100}).parts[0].utilization > M.electrical().parts[0].utilization);
  for (const dutyPct of [0, 50, 100]) {
    const hot = M.simulate({ambientC: 130, dutyPct}, T);
    assert.ok(hot.electrical.parts[0].onPowerW > hot.electrical.ratingW);
    assert.ok(hot.warnings.some(w => w.code === 'PART_RATING'));
  }
});

test('charging voltage and one-high/16-low tolerance corner screen full ON power independently of duty', () => {
  const low = M.electrical({batteryV: 11.5}), normal = M.electrical({batteryV: 12}), high = M.electrical({batteryV: 14.4});
  assert.ok(low.heaterPowerW < normal.heaterPowerW && normal.heaterPowerW < high.heaterPowerW);
  assert.ok(high.parts[0].onPowerW < high.toleranceWorst.powerW);
  assert.ok(high.toleranceWorst.powerW < 0.33);
  const nominal = M.electrical({batteryV: 14.4, dutyPct: 100, cableM: 0});
  const rating = (nominal.parts[0].onPowerW + nominal.toleranceWorst.powerW) / 2;
  for (const dutyPct of [0, 50, 100]) {
    const nearLimit = M.simulate({batteryV: 14.4, dutyPct, cableM: 0, heaterRatingW: rating}, T);
    assert.ok(nearLimit.electrical.parts[0].onPowerW < rating);
    assert.ok(nearLimit.electrical.toleranceWorst.powerW > rating);
    assert.ok(nearLimit.warnings.some(w => w.code === 'TOLERANCE_RATING'));
  }
});

test('open heater produces no electrical energy and no modeled heat', () => {
  const run = M.simulate({fault: 'heater-open'}, T);
  near(run.electrical.currentA, 0); near(run.deliveredHeaterEnergyJ, 0);
  assert.ok(run.series.every(p => p.tempL === run.config.ambientC && p.tempTip === run.config.ambientC));
  const s = M.stateAt(run, run.stages[2].startS + 1);
  assert.equal(s.d9, true); assert.equal(s.heaterOn, false);
});

test('single short has zero local heating and hotter remaining series parts', () => {
  const normal = M.electrical(), short = M.electrical({fault: 'heater-short'});
  near(short.chainOhm, 16 * 3.3, 1e-9);
  near(short.parts[10].powerW, 0);
  assert.ok(short.currentA > normal.currentA);
  assert.ok(short.parts[9].powerW > normal.parts[9].powerW);
  assert.ok(short.parts[11].powerW > normal.parts[11].powerW);
});

test('full-chain short exposes saturation and does not pretend the resistors still dissipate heat', () => {
  const run = M.simulate({fault: 'chain-short'}, T);
  assert.ok(run.electrical.currentA > 1);
  near(run.electrical.heaterPowerW, 0);
  assert.ok(run.electrical.losses.copperW > 1);
  assert.ok(run.warnings.some(w => w.code === 'INA_SATURATION'));
  const during = M.stateAt(run, run.stages[2].startS + 1);
  assert.equal(during.logicValid, false);
  assert.equal(during.readings.length, 0);
});

test('infeasible supply loads and unsupported capacitor-recharge timing are rejected', () => {
  for (const c of [{batteryV: 12, cableM: 1000, awg: 26, logicMa: 10},
    {batteryV: 7, cableM: 1000, awg: 26, logicMa: 150},
    {sampleS: 0.05, settlingMs: 49.98, acquisitionMs: 0.01}]) {
    assert.equal(M.validate(c).valid, false);
    assert.throws(() => M.simulate(c, T), RangeError);
  }
});

test('USB and proposed battery limits inhibit commanded heating and delivered energy', () => {
  for (const c of [{fault: 'usb-only'}, {batteryV: 14.401}, {batteryV: 18}, {batteryV: 6}]) {
    const run = M.simulate(c, T);
    assert.equal(M.stateAt(run, run.stages[2].startS + 0.5).d9, false);
    near(run.deliveredHeaterEnergyJ, 0);
    assert.ok(run.series.every(p => p.tempL === run.config.ambientC));
  }
});

test('Q1 short persists despite D9 LOW, including idle, cooldown and report', () => {
  const run = M.simulate({fault: 'Q1-stuck'}, T);
  for (const t of [1, run.stages[3].startS + 1, run.stages[4].startS + 1]) {
    const s = M.stateAt(run, t);
    assert.equal(s.d9, false); assert.equal(s.heaterOn, true);
    near(s.heaterEnergyJ, run.electrical.heaterPowerW * t);
  }
  assert.ok(run.deliveredHeaterEnergyJ > run.electrical.heaterEnergyJ);
});

test('sampling microcycle actually settles, reads, switches off and holds the last sample', () => {
  const run = M.simulate({}, T);
  assert.equal(M.stateAt(run, 1).readings.length, 0);
  const settle = M.stateAt(run, 2.005), reading = M.stateAt(run, 2.015), held = M.stateAt(run, 2.021);
  assert.equal(settle.measurementPhase, 'settling'); assert.equal(settle.d4, true);
  assert.equal(reading.measurementPhase, 'reading'); assert.equal(reading.d4, true);
  assert.equal(held.measurementPhase, 'off'); assert.equal(held.d4, false);
  assert.equal(held.readings.length, 4);
  assert.deepEqual(held.readings, M.stateAt(run, 2.8).readings);
  assert.equal(M.stateAt(run, 3.005).measurementPhase, 'settling');
  assert.ok(settle.activeRefs.includes('R11') && held.activeRefs.includes('R11'));
  assert.ok(!held.activeRefs.includes('Q2'));
});

test('default ADC reference has a bias; an open NTC is a fault rather than a temperature', () => {
  const ext = M.sampleReadings(M.simulate({}, T), 3), def = M.sampleReadings(M.simulate({adcReference: 'default'}, T), 3);
  assert.ok(Math.abs(ext[0].tempC - 22) < 0.01);
  assert.ok(def[0].tempC - ext[0].tempC > 0.1);
  const open = M.sampleReadings(M.simulate({fault: 'NTC-open'}, T), 3);
  assert.equal(open[0].fault, 'open'); assert.equal(open[0].tempC, null);
  assert.ok(Number.isFinite(open[1].tempC));
});

test('thermal response is causal, symmetric at side needles, and changes with soil properties', () => {
  const run = M.simulate({}, T);
  assert.ok(run.series.filter(p => p.t <= run.stages[2].startS).every(p => p.tempL === 22));
  assert.ok(run.series.some(p => p.tempL > 22.05));
  assert.ok(run.series.every(p => p.tempL === p.tempR && p.tempBody === 22));
  const b = M.simulate({soilC: 3e6}, T);
  assert.ok(Math.max(...run.series.map(p => p.tempL)) > Math.max(...b.series.map(p => p.tempL)));
  const longer = M.simulate({pulseS: 15}, T), shorter = M.simulate({pulseS: 8}, T);
  assert.ok(Math.max(...longer.series.map(p => p.tempL)) > Math.max(...shorter.series.map(p => p.tempL)));
});

test('spatial temperatures share the exact finite-source field used by curves and thermistors', () => {
  const run = M.simulate({}, T), start = run.stages[2].startS, at = start + 8;
  const sources = run.electrical.parts.map((part, i) => ({z: (run.config.heaterStartMm + run.config.heaterPitchMm*i)/1000, p: part.powerW}));
  const soil = {lambda: 1.5, C: 2e6, alpha: 1.5/2e6};
  near(M.temperatureAtPosition(run, at, 1.385, 29.8),
    22 + T.dTpoint(sources, .001385, .0298, 8, run.config.pulseS, soil));
  for (const point of run.series.filter((_, i) => i % 23 === 0)) {
    near(point.tempL, M.temperatureAtPosition(run, point.t, 8, 29.8));
    near(point.tempTip, M.temperatureAtPosition(run, point.t, .85, 54.08));
    near(point.tempHeatedZoneSoil, M.temperatureAtPosition(run, point.t, 1.385, 29.8));
    near(M.stateAt(run, point.t).heatedZoneSoilC, point.tempHeatedZoneSoil);
  }
  const tip = M.temperatureAtPosition(run, run.stages[2].endS, .85, 54.08);
  const heated = M.temperatureAtPosition(run, run.stages[2].endS, 1.385, 29.8);
  const side = M.temperatureAtPosition(run, run.stages[2].endS, 8, 29.8);
  assert.ok(heated > tip && tip > side && side > 22,
    'The unheated tip is distinct from the heated section, and side needles still receive heat.');
  near(heated - 22, T.dTpoint(sources, .001385, .0298, run.config.pulseS, run.config.pulseS, soil));
});

test('spatial field is causal, cools after turn-off, and follows disabled/open/short/stuck faults', () => {
  const run = M.simulate({}, T), start = run.stages[2].startS, end = run.stages[2].endS;
  for (const t of [-1, 0, start]) near(M.temperatureAtPosition(run, t, 1.385, 29.8), 22);
  assert.ok(M.temperatureAtPosition(run, end + 1, 1.385, 29.8) > 22,
    'Turning electrical power off does not erase stored heat in the ideal medium.');
  assert.ok(M.temperatureAtPosition(run, end + 20, 1.385, 29.8) < M.temperatureAtPosition(run, end + 1, 1.385, 29.8));
  for (const config of [{fault: 'usb-only'}, {fault: 'heater-open'}, {fault: 'chain-short'}, {batteryV: 6}, {batteryV: 18}]) {
    const blocked = M.simulate(config, T);
    for (const t of [0, start+5, end+5]) near(M.temperatureAtPosition(blocked, t, 1.385, 29.8), 22);
  }
  const stuck = M.simulate({fault: 'Q1-stuck'}, T);
  assert.ok(M.temperatureAtPosition(stuck, 1, 1.385, 29.8) > 22);
  assert.ok(M.temperatureAtPosition(stuck, stuck.totalS+5, 1.385, 29.8) >
    M.temperatureAtPosition(stuck, stuck.totalS, 1.385, 29.8), 'Physical stuck heating has no fictional cutoff at timeline end.');
});

test('spatial field scales with actual heater power and uses the selected pulse duration', () => {
  const a = M.simulate({pulseS: 8}, T), b = M.simulate({batteryV: 14.4, pulseS: 8}, T), longer = M.simulate({pulseS: 15}, T);
  for (const [r, z] of [[1.385, 29.8], [8, 29.8], [.85, 54.08]]) {
    const t = a.stages[2].startS+16;
    near((M.temperatureAtPosition(b, t, r, z)-22)/(M.temperatureAtPosition(a, t, r, z)-22),
      b.electrical.heaterPowerW/a.electrical.heaterPowerW, 1e-10);
    assert.ok(M.temperatureAtPosition(longer, t, r, z) > M.temperatureAtPosition(a, t, r, z));
    near(M.temperatureAtPosition(longer, a.stages[2].startS+4, r, z),
      M.temperatureAtPosition(a, a.stages[2].startS+4, r, z));
  }
});

test('spatial API rejects singular or non-finite coordinates and exports in the browser', () => {
  const run = M.simulate({}, T);
  for (const args of [[3, 0, 29.8], [3, -1, 29.8], [NaN, 1, 29.8], [3, Infinity, 29.8], [3, 1, NaN]])
    assert.throws(() => M.temperatureAtPosition(run, ...args), RangeError);
  assert.throws(() => M.temperatureAtPosition(null, 3, 1, 29.8), TypeError);
  const context = {HPTwin: T};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sensor-model.js'), 'utf8'), context);
  const browser = context.SensorModel, browserRun = browser.simulate();
  near(browser.temperatureAtPosition(browserRun, 24, 1.385, 29.8), M.temperatureAtPosition(run, 24, 1.385, 29.8));
});

test('invalid configurations fail explicitly; repeated calculations and browser export are deterministic', () => {
  for (const c of [{batteryV: NaN}, {pulseS: -1}, {soilC: 0}, {awg: 10}, {fault: 'imaginary'}, {sampleS: 0.05, settlingMs: 100},
    {dutyPct: NaN}, {dutyPct: -1}, {dutyPct: 101}, {pwmHz: 490}, {heaterCount: 17.5}, {heaterRatingW: 0},
    {heaterDeratingStartC: 120, heaterMaxC: 100}, {heaterPartNumber: ''}]) {
    assert.equal(M.validate(c).valid, false); assert.throws(() => M.simulate(c, T), RangeError);
  }
  assert.deepEqual(M.simulate({}, T).series, M.simulate({}, T).series);
  const context = {HPTwin: T};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/sensor-model.js'), 'utf8'), context);
  near(context.SensorModel.electrical().heaterPowerW, M.electrical().heaterPowerW);
  assert.equal(typeof context.SensorModel.instantaneousPower, 'function');
  assert.ok(context.SensorModel.simulate().series.some(p => p.tempL > 22));
});

test('sensor estimate recovers the simulated soil within the finite-heater bias', () => {
  for (const soil of [{soilLambda: 1.283, soilC: 2.345e6}, {soilLambda: 0.43, soilC: 1.31e6}]) {
    const e = M.soilEstimate(M.simulate(soil, T));
    assert.ok(e.samples === 105, 'one sample per second through heating and cooling');
    assert.ok(e.CErrPct > 1 && e.CErrPct < 5, 'C bias ' + e.CErrPct);
    assert.ok(e.lambdaErrPct > 1 && e.lambdaErrPct < 6, 'lambda bias ' + e.lambdaErrPct);
  }
  assert.equal(M.soilEstimate(M.simulate({dutyPct: 0}, T)), null, 'no heat, no estimate');
  assert.equal(M.soilEstimate(M.simulate({fault: 'NTC-open'}, T)), null, 'a failed thermistor gives no estimate');
});
