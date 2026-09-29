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
  assert.ok(run.series.every(p => p.tempTH1 === 22 && p.tempTip === 22 && p.tempHeatedZoneSoil === 22));
  const power = M.instantaneousPower(run, t), c = run.config;
  near(power.heaterW, 0); near(power.batteryW, c.batteryV * power.batteryCurrentA);
  // U3 is a buck: battery current x VIN_P equals the constant input power 5 V x 10 mA / efficiency.
  near(power.batteryCurrentA * (c.batteryV - c.diodeV - power.batteryCurrentA * run.electrical.cableOhm),
    5 * c.logicMa / 1000 / c.buckEfficiency);
  assert.ok(power.batteryW > 0.06 && power.batteryW < 0.065, 'about 62 mW from 12 V for a 50 mW electronics load');
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

const netlist = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../flat-nano/kicad/netlist.json'), 'utf8')).parts;

test('circuit values and modeled component refs match the current netlist', () => {
  const n = netlist();
  assert.equal(Object.keys(n).filter(r => /^RH\d+$/.test(r)).length, M.HEATER_COUNT);
  const e = M.electrical();
  for (const p of e.parts) assert.equal(Number(n[p.ref].value), p.ohm);
  assert.equal(n.Q1.pins['3'], 'HEAT_RTN');
  assert.equal(n.U4.pins['8'], 'HEAT_P');
  // Pin D4 (U1 pin 45) drives VREF through R11; VREF feeds C13, AREF (U1 pin 59) and the dividers.
  assert.equal(n.U1.pins['45'], 'D4_EXC');
  assert.equal(n.R11.pins['1'], 'D4_EXC');
  assert.equal(n.R11.pins['2'], 'VREF');
  assert.equal(n.R11.value, '1.5k');
  assert.equal(M.SUPPLY.r11Ohm, 1500);
  assert.ok(5 / M.SUPPLY.r11Ohm < 0.004, 'R11 keeps pin D4 inside the 4 mA RA4M1 pin limit while C13 charges');
  assert.equal(n.U1.pins['59'], 'VREF');
  assert.deepEqual([n.C13.value, n.C13.pins['1'], n.C13.pins['2']], ['1u', 'VREF', 'GND']);
  // The thermistors return straight to GND: there is no return switch or crystal.
  for (const ref of ['Q2', 'R12', 'R17', 'Y1', 'C5', 'C6', 'J5']) assert.equal(n[ref], undefined, ref + ' is not on the board');
  for (const [i, ref] of ['TH1', 'TH2', 'TH3', 'TH4'].entries()) {
    const net = M.ADC_CHANNEL[ref] + '_' + ref;
    assert.equal(n[ref].pins['1'], net);
    assert.equal(n[ref].pins['2'], 'GND');
    assert.deepEqual([n['R2' + (i + 1)].pins['1'], n['R2' + (i + 1)].pins['2']], ['VREF', net]);
    assert.deepEqual([n['C2' + (i + 1)].pins['1'], n['C2' + (i + 1)].pins['2']], [net, 'GND']);
    assert.ok(Object.values(n.U1.pins).includes(net), net + ' reaches U1');
  }
  // Buck supply (U3, L1, C2, D7) and the heater bulk capacitor C3.
  assert.equal(n.U3.value, 'LMR36503R5RPER');
  assert.equal(n.U3.pins['8'], '5V_BUCK');
  assert.deepEqual(n.L1.pins, {1: 'SW', 2: '5V_BUCK'});
  assert.deepEqual(n.D7.pins, {1: '+5V', 2: '5V_BUCK'});
  assert.deepEqual([n.C3.value, n.C3.pins['1'], n.C3.pins['2']], ['22u 25V', 'VIN_P', 'GND']);
  for (const config of [{}, {fault: 'usb-only'}, {fault: 'Q1-stuck'}]) {
    const run = M.simulate(config, T);
    for (const stage of run.stages) for (const at of [stage.startS + 0.005, stage.startS + 0.5])
      for (const ref of M.stateAt(run, at).activeRefs) assert.ok(n[ref], `${ref} is absent from current netlist`);
  }
});

test('thermistor ADC channels follow the netlist pin map', () => {
  const n = netlist();
  assert.deepEqual({...M.ADC_CHANNEL}, {TH1: 'A2', TH2: 'A1', TH3: 'A0', TH4: 'A3'});
  assert.ok(Object.isFrozen(M.ADC_CHANNEL));
  assert.deepEqual([n.U1.pins['63'], n.U1.pins['64'], n.U1.pins['53'], n.U1.pins['62']], ['A2_TH1', 'A1_TH2', 'A0_TH3', 'A3_TH4']);
  const readings = M.sampleReadings(M.simulate({}, T), 3);
  assert.deepEqual(readings.map(r => [r.ref, r.channel]), [['TH1', 'A2'], ['TH2', 'A1'], ['TH3', 'A0'], ['TH4', 'A3']]);
});

test('highlighted parts follow the battery, programming-clip and heater current paths', () => {
  const run = M.simulate({}, T), idle = M.stateAt(run, 1), pulse = M.stateAt(run, run.stages[2].startS + 0.5);
  for (const ref of ['J1', 'D1', 'C1', 'C18', 'C3', 'U3', 'C19', 'C20', 'L1', 'C2', 'D7', 'C17', 'U1'])
    assert.ok(idle.activeRefs.includes(ref), ref + ' carries battery power to the logic');
  for (const ref of ['R5', 'Q1', 'RH1', 'J2', 'D5', 'R11']) assert.ok(!idle.activeRefs.includes(ref), ref + ' is idle');
  for (const ref of ['J1', 'D1', 'C3', 'R5', 'Q1', 'R9', 'R10', 'RH1', 'RH17']) assert.ok(pulse.activeRefs.includes(ref), ref + ' is in the heater path');
  const clip = M.stateAt(M.simulate({fault: 'usb-only'}, T), 1);
  for (const ref of ['J2', 'D5', 'R15', 'R16', 'U1']) assert.ok(clip.activeRefs.includes(ref), ref + ' carries clip power');
  for (const ref of ['J1', 'D1', 'U3', 'L1', 'C3']) assert.ok(!clip.activeRefs.includes(ref), ref + ' is unpowered without the battery');
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
    // Buck: constant input power; battery-side electronics current = that power / VIN_P.
    near(p.electronics.inputW, 5 * run.config.logicMa / 1000 / run.config.buckEfficiency);
    if (dutyPct !== 50 || p.currentA === 0) near(p.batteryCurrentA - p.currentA, p.electronics.inputW / p.vinProtectedV);
    near(p.electronics.inputCurrentA, p.batteryCurrentA - p.currentA);
    near(p.electronics.inputW, p.U3dissipationW + p.D7dissipationW + p.logicRailW);
    near(p.perHeaterW.reduce((s, r) => s + r.powerW, 0), p.heaterW);
    assert.ok(p.U3dissipationW > 0 && p.D7dissipationW > 0 && p.logicRailW > 0);
  }
  }
});

test('heater power goes to zero at turn-off while the electronics remain powered', () => {
  const run = M.simulate({}, T), end = run.stages[2].endS, eff = run.config.buckEfficiency;
  const before = M.instantaneousPower(run, end - 1e-6), after = M.instantaneousPower(run, end);
  assert.ok(before.heaterW > 1 && before.currentA > 0.1);
  for (const key of ['heaterW', 'currentA', 'shuntW', 'mosfetW', 'copperW']) near(after[key], 0);
  assert.ok(after.perHeaterW.every(p => p.powerW === 0));
  near(after.batteryW, 12 * after.batteryCurrentA);
  near(after.electronics.inputW, 5 * 0.010 / eff);
  near(after.batteryCurrentA, 5 * 0.010 / (eff * after.vinProtectedV));
  near(after.logicRailW, 4.75 * 0.010);
  near(after.D7dissipationW, 0.25 * 0.010);
  near(before.logicRailW, after.logicRailW);
  near(after.U3dissipationW, before.U3dissipationW);
  assert.ok(after.electronics.inputCurrentA < before.electronics.inputCurrentA,
    'Less cable drop raises VIN_P, so the buck draws less battery current for the same electronics load.');
  near(after.cableW, after.batteryCurrentA ** 2 * run.electrical.cableOhm);
  near(after.D1W, after.batteryCurrentA * run.config.diodeV);
});

test('the U3 buck draws constant input power, so its battery current falls as VIN_P rises', () => {
  const eff = M.defaultConfig().buckEfficiency;
  assert.ok(eff > 0.8 && eff < 0.86);
  const at = input => M.instantaneousPower(M.simulate(input, T), 1);
  const low = at({batteryV: 11.5}), mid = at({batteryV: 12}), high = at({batteryV: 14.4});
  for (const p of [low, mid, high]) {
    assert.equal(p.valid, true);
    near(p.U3dissipationW, 5 * 0.010 * (1 / eff - 1));
    near(p.electronics.inputW, 5 * 0.010 / eff);
    near(p.electronics.currentA, 0.010);
    near(p.electronics.inputCurrentA, 5 * 0.010 / (eff * p.vinProtectedV));
  }
  assert.ok(mid.U3dissipationW > 0.009 && mid.U3dissipationW < 0.011, 'about 10 mW at 10 mA');
  assert.ok(low.electronics.inputCurrentA > mid.electronics.inputCurrentA && mid.electronics.inputCurrentA > high.electronics.inputCurrentA);
  assert.ok(mid.electronics.inputCurrentA < 0.006, 'from 12 V the buck draws about half the 10 mA load current');
  const lossy = at({buckEfficiency: 0.7});
  assert.ok(lossy.U3dissipationW > mid.U3dissipationW && lossy.batteryW > mid.batteryW);
  assert.ok(M.simulate({}, T).assumptions.some(a => /LMR36503/.test(a) && /83% efficiency/.test(a)));
  assert.ok(M.instantaneousPower(M.simulate({}, T), 1).notes.some(n => /83% efficiency/.test(n)));
});

test('validate() and solve() share the buck input-current expression', () => {
  const c0 = M.defaultConfig(), floor = M.SUPPLY.buckMinVinProtectedV;
  // Battery below the heating policy, so only the electronics load the cable. The largest
  // load keeps VIN_P at the buck floor: 5 V x I / (eff x floor) = (V0 - floor) / R.
  for (const eff of [c0.buckEfficiency, 0.6]) {
    const c = {batteryV: 6.5, cableM: 100, awg: 26, buckEfficiency: eff};
    const R = 2 * c.cableM * M.AWG_OHM_PER_M[26], v0 = c.batteryV - c0.diodeV;
    const limitMa = 1000 * (v0 - floor) * floor * eff / (M.SUPPLY.buckOutputV * R);
    assert.equal(M.validate({...c, logicMa: limitMa * 0.99}).valid, true);
    assert.equal(M.validate({...c, logicMa: limitMa * 1.01}).valid, false);
    const e = M.electrical({...c, logicMa: limitMa * 0.99, dutyPct: 0});
    assert.ok(e.vinProtectedV >= floor);
    near(e.totalA - e.currentA, 5 * limitMa * 0.99 / 1000 / (eff * e.vinProtectedV), 1e-12);
    near(e.vinProtectedV, v0 - e.totalA * R, 1e-9);
  }
  // Input current equal to the load current would still accept 33 mA here; the buck does not.
  assert.ok(6.15 - 0.033 * 2 * 100 * M.AWG_OHM_PER_M[26] > floor);
  assert.equal(M.validate({batteryV: 6.5, cableM: 100, awg: 26, logicMa: 33}).valid, false);
  // Full-ON heating uses the same expression at the loaded VIN_P.
  const heat = M.electrical({dutyPct: 100});
  near(heat.totalA - heat.currentA, 5 * c0.logicMa / 1000 / (c0.buckEfficiency * heat.onVinProtectedV));
});

test('instantaneous electronics scale with the chosen aggregate current without invented chip allocations', () => {
  const zero = M.instantaneousPower(M.simulate({logicMa: 0}, T), 3);
  for (const key of ['batteryW', 'U3dissipationW', 'D7dissipationW', 'logicRailW']) near(zero[key], 0);
  const run = M.simulate({logicMa: 20}, T), p = M.instantaneousPower(run, 3);
  near(p.logicRailW, 4.75 * 0.020);
  near(p.D7dissipationW, 0.25 * 0.020);
  near(p.U3dissipationW, 5 * 0.020 * (1 / run.config.buckEfficiency - 1));
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'U1W'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'U4W'), false);
  assert.match(p.electronics.allocation, /individual processor\/INA226 consumption is not modeled/);
});

test('instantaneous ledger flags unsupported programming-clip/dropout decomposition and follows a stuck heater', () => {
  for (const config of [{fault: 'usb-only'}, {batteryV: 5}, {fault: 'chain-short'}]) {
    const run = M.simulate(config, T), p = M.instantaneousPower(run, run.stages[2].startS + 1);
    assert.equal(p.valid, false);
    assert.equal(p.logicRailW, null);
    assert.equal(p.electronics.currentA, null);
  }
  // Below the 7 V heating policy U3 still regulates: sensing and the ledger stay valid, heating is refused.
  const six = M.simulate({batteryV: 6}, T), p6 = M.instantaneousPower(six, six.stages[2].startS + 1);
  assert.equal(p6.valid, true); near(p6.heaterW, 0);
  assert.ok(six.warnings.some(w => w.code === 'LOW_BATTERY' && /U3 still regulates/.test(w.message)));
  assert.equal(M.stateAt(six, 3.015).readings.length, 4);
  // Below the buck floor (5 V battery gives 4.65 V at VIN_P) logic is not simulated.
  const five = M.simulate({batteryV: 5}, T);
  assert.ok(five.warnings.some(w => w.code === 'LOW_BATTERY' && /can no longer hold 5\.0 V/.test(w.message)));
  assert.equal(M.stateAt(five, 3.015).readings.length, 0);
  assert.equal(M.stateAt(five, 3.015).logicValid, false);
  const run = M.simulate({fault: 'Q1-stuck'}, T), p = M.instantaneousPower(run, run.stages[3].startS + 1);
  assert.equal(p.valid, true);
  assert.ok(p.heaterW > 1);
  near(p.heaterW, run.electrical.heaterPowerW);
});

test('a ledger marked valid always balances, including fault what-ifs with long cables and heavy logic loads', () => {
  const leafSum = p => p.heaterW + p.shuntW + p.mosfetW + p.copperW + p.D1W + p.cableW +
    p.U3dissipationW + p.D7dissipationW + p.logicRailW;
  // In the first two cases VIN_P stays above the 5.2 V floor while U3 is in dropout or stopped.
  const cases = [{fault: 'Q1-stuck', batteryV: 9, cableM: 50, awg: 26, logicMa: 150},
    {fault: 'Q1-stuck', batteryV: 24, cableM: 1000, logicMa: 150, dutyPct: 0},
    {fault: 'Q1-stuck', batteryV: 12, cableM: 100, awg: 26, logicMa: 100},
    {fault: 'chain-short', batteryV: 12, cableM: 5, logicMa: 150},
    {fault: 'chain-short', batteryV: 14.4, cableM: 200, awg: 26, logicMa: 150},
    {fault: 'heater-short', batteryV: 12, cableM: 50, awg: 26, logicMa: 60},
    {batteryV: 7, cableM: 20, awg: 26, logicMa: 150}, {batteryV: 5.6}];
  let balanced = 0, rejected = 0;
  for (const config of cases) {
    const run = M.simulate(config, T);
    for (const stage of run.stages) for (const atS of [stage.startS + 0.25, (stage.startS + stage.endS) / 2]) {
      const p = M.instantaneousPower(run, atS);
      if (!p.valid) { rejected++; continue; }
      near(leafSum(p), p.batteryW, 1e-9);
      balanced++;
    }
  }
  assert.ok(balanced > 0 && rejected > 0, 'the sweep covers both valid and rejected ledgers');
  // A stuck Q1 that pulls U3 out of regulation is a brownout, not a valid ledger.
  const stuck = M.simulate({fault: 'Q1-stuck', batteryV: 9, cableM: 50, awg: 26, logicMa: 150}, T);
  assert.equal(stuck.electrical.onRegulated, false);
  assert.ok(stuck.electrical.onVinProtectedV >= M.SUPPLY.buckMinVinProtectedV, 'VIN_P alone does not show the dropout');
  assert.equal(M.instantaneousPower(stuck, 1).valid, false);
  assert.equal(M.stateAt(stuck, 1).logicValid, false);
  assert.equal(M.sampleReadings(stuck, 3).length, 0);
  assert.ok(stuck.warnings.some(w => w.code === 'FAULT_BROWNOUT'));
});

test('a refused pulse does not report a heating brownout', () => {
  // 5.6 V with the default 5 m, 22 AWG cable: U3 regulates at idle but would drop out while heating.
  const run = M.simulate({batteryV: 5.6}, T);
  assert.equal(run.electrical.onRegulated, false);
  assert.ok(run.warnings.some(w => w.code === 'LOW_BATTERY'), 'heating is refused below the policy limit');
  assert.ok(!run.warnings.some(w => w.code === 'FAULT_BROWNOUT'));
  const during = M.stateAt(run, run.stages[2].startS + 1);
  assert.equal(during.heaterOn, false); assert.equal(during.logicValid, true);
  assert.equal(M.instantaneousPower(run, run.stages[2].startS + 1).valid, true);
});

test('ideal no-loss result agrees with V squared / R', () => {
  // R5 cannot be zero in validation; retain the actual 0.1R explicitly.
  const e = M.electrical({dutyPct: 100, cableM: 0, contactOhm: 0, diodeV: 0, mosfetOhm: 0, copperOhm: 0, logicMa: 0});
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
  assert.ok(run.series.every(p => p.tempTH1 === run.config.ambientC && p.tempTip === run.config.ambientC));
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

test('programming-clip power and proposed battery limits inhibit commanded heating and delivered energy', () => {
  for (const c of [{fault: 'usb-only'}, {batteryV: 14.401}, {batteryV: 18}, {batteryV: 6}, {batteryV: 5}]) {
    const run = M.simulate(c, T);
    assert.equal(M.stateAt(run, run.stages[2].startS + 0.5).d9, false);
    near(run.deliveredHeaterEnergyJ, 0);
    assert.ok(run.series.every(p => p.tempTH1 === run.config.ambientC));
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
  // VREF (R11, C13) and the dividers are powered only while pin D4 is HIGH.
  for (const s of [settle, reading]) for (const ref of ['R11', 'C13', 'R21', 'C21', 'TH1', 'TH4']) assert.ok(s.activeRefs.includes(ref), ref);
  for (const ref of ['R11', 'C13', 'R21', 'C21', 'TH1', 'TH4']) assert.ok(!held.activeRefs.includes(ref), ref + ' is unpowered while pin D4 is LOW');
  assert.ok(held.activeRefs.includes('U1'));
  assert.match(settle.command, /Pin D4 HIGH powers VREF/);
  assert.match(reading.command, /set pin D4 LOW/);
});

test('VREF and the divider nodes start discharged, so short settling reads warm', () => {
  const settled = M.sampleReadings(M.simulate({}, T), 3), quick = M.sampleReadings(M.simulate({settlingMs: 1}, T), 3);
  assert.ok(settled[0].vrefV > 3.4 && settled[0].vrefV < 3.7, 'VREF ' + settled[0].vrefV);
  assert.ok(quick[0].voltageV < settled[0].voltageV);
  assert.ok(quick[0].tempC - 22 > 1, 'charging nodes read low, which is a warm bias');
  assert.ok(M.simulate({settlingMs: 1}, T).warnings.some(w => w.code === 'ADC_SETTLING'));
  assert.ok(!M.simulate({}, T).warnings.some(w => w.code === 'ADC_SETTLING'));
  // Divider self-heating exists only while pin D4 is HIGH (20 ms of every 1 s sample).
  const r = M.resistanceAt(22);
  near(settled[0].selfHeatingW, (settled[0].vrefV / (10000 + r)) ** 2 * r, 1e-15);
  near(settled[0].selfHeatingAvgW, settled[0].selfHeatingW * 0.02, 1e-15);
});

test('default ADC reference has a bias; an open NTC is a fault rather than a temperature', () => {
  const ext = M.sampleReadings(M.simulate({}, T), 3), def = M.sampleReadings(M.simulate({adcReference: 'default'}, T), 3);
  assert.ok(Math.abs(ext[0].tempC - 22) < 0.01);
  assert.ok(def[0].tempC - ext[0].tempC > 5, 'VREF sits well below the 4.75 V rail');
  const open = M.sampleReadings(M.simulate({fault: 'NTC-open'}, T), 3);
  assert.equal(open[0].fault, 'open'); assert.equal(open[0].tempC, null);
  assert.ok(Number.isFinite(open[1].tempC));
});

test('thermal response is causal, symmetric at side needles, and changes with soil properties', () => {
  const run = M.simulate({}, T);
  assert.ok(run.series.filter(p => p.t <= run.stages[2].startS).every(p => p.tempTH1 === 22));
  assert.ok(run.series.some(p => p.tempTH1 > 22.05));
  assert.ok(run.series.every(p => p.tempTH1 === p.tempTH3 && p.tempBody === 22));
  const b = M.simulate({soilC: 3e6}, T);
  assert.ok(Math.max(...run.series.map(p => p.tempTH1)) > Math.max(...b.series.map(p => p.tempTH1)));
  const longer = M.simulate({pulseS: 15}, T), shorter = M.simulate({pulseS: 8}, T);
  assert.ok(Math.max(...longer.series.map(p => p.tempTH1)) > Math.max(...shorter.series.map(p => p.tempTH1)));
});

test('spatial temperatures share the exact finite-source field used by curves and thermistors', () => {
  const run = M.simulate({}, T), start = run.stages[2].startS, at = start + 8;
  const sources = run.electrical.parts.map((part, i) => ({z: (run.config.heaterStartMm + run.config.heaterPitchMm*i)/1000, p: part.powerW}));
  const soil = {lambda: 1.5, C: 2e6, alpha: 1.5/2e6};
  near(M.temperatureAtPosition(run, at, 1.385, 29.8),
    22 + T.dTpoint(sources, .001385, .0298, 8, run.config.pulseS, soil));
  for (const point of run.series.filter((_, i) => i % 23 === 0)) {
    near(point.tempTH1, M.temperatureAtPosition(run, point.t, 8, 29.8));
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
  assert.ok(context.SensorModel.simulate().series.some(p => p.tempTH1 > 22));
});

test('sensor estimate fits to 1.5 x the peak time with the 17 x 2.6 mm effective heater length', () => {
  for (const soil of [{soilLambda: 1.283, soilC: 2.345e6}, {soilLambda: 0.43, soilC: 1.31e6}, {soilLambda: 0.244, soilC: 1.349e6}, {soilLambda: 2.159, soilC: 1.944e6}]) {
    const e = M.soilEstimate(M.simulate(soil, T));
    near(e.qPrimeWm, M.electrical().heaterPowerW / 0.0442, 1e-9);
    assert.ok(e.peakCaptured && e.fullWindow, 'the default record covers 1.5 x the peak time');
    assert.equal(e.windowS, 1.5 * e.peakS, 'fit window is 1.5 x the peak time');
    assert.equal(e.samples, Math.floor(e.windowS), 'one sample per second up to the window end');
    assert.ok(Math.abs(e.CErrPct) < 0.5, 'C bias ' + e.CErrPct);
    assert.ok(Math.abs(e.lambdaErrPct) < 1, 'lambda bias ' + e.lambdaErrPct);
  }
  const short = M.soilEstimate(M.simulate({soilLambda: 0.244, soilC: 1.349e6, cooldownS: 60}, T));
  assert.ok(!short.peakCaptured && short.windowS === 75, 'a record that ends before the peak is flagged and fitted to its end');
  assert.equal(M.soilEstimate(M.simulate({dutyPct: 0}, T)), null, 'no heat, no estimate');
  assert.equal(M.soilEstimate(M.simulate({fault: 'NTC-open'}, T)), null, 'a failed thermistor gives no estimate');
});

test('model text describes the current circuit without removed parts or version wording', () => {
  const texts = [];
  for (const fault of M.FAULTS) for (const extra of [{}, {batteryV: 5}, {batteryV: 6}, {batteryV: 18}, {adcReference: 'default', settlingMs: 1}, {rEachOhm: 4.7}]) {
    const run = M.simulate({fault, ...extra}, T);
    texts.push(...run.warnings.map(w => w.message), ...run.assumptions, ...run.stages.map(s => s.command));
    for (const t of [1, 2.005, 2.015, run.stages[2].startS + 0.5, run.stages[4].startS + 0.5])
      texts.push(M.stateAt(run, t).command, ...M.instantaneousPower(run, t).notes);
  }
  const all = texts.join('\n');
  for (const pattern of [/\bQ2\b/, /\bR12\b/, /\bR17\b/, /\bLDO\b/, /linear regulator/i, /\breleased?\b/i, /\bconnectors?\b/i,
    /\brevis/i, /\br\d\b/, /\b(now|new|previous|older|updated|replacement)\b/i, /\bUSB (powers|logic)\b/, /(?<![Pp]in )\bD4 (HIGH|LOW)\b/])
    assert.ok(!pattern.test(all), 'model text matches ' + pattern + ': ' + (all.match(pattern) || [])[0]);
});
