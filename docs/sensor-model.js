/* Compact Nano-body hardware teaching model. No firmware is executed and no hardware is driven.
 * Circuit values: flat-nano/kicad/netlist.json and flat-nano/fab/HP-SDI12-NANO_BOM.csv.
 * Heater: Vishay CRCW06033R30FKEAHP, 3.3 ohm +/-1%, 0.33 W at <=70 C,
 * linear ambient derating to zero at 155 C (Vishay D/CRCW-HP data sheet).
 * https://www.vishay.com/doc?20043=
 * Thermal curves use HPTwin's finite point sources in homogeneous soil. They
 * exclude the needle, epoxy, PCB thermal mass, contact resistance and advection.
 * PWM uses weighted ON/OFF states, not a switching-transient simulation.
 * Constant electrical resistance and diode drop are assumptions, not calibration.
 */
(function (root) {
  'use strict';

  // A board export can carry heaterSpec using these same config field names.
  const DEFAULT_HEATER = Object.freeze({heaterCount: 17, rEachOhm: 3.3,
    heaterRatingW: 0.33, heaterDeratingStartC: 70, heaterMaxC: 155,
    heaterPartNumber: 'CRCW06033R30FKEAHP', tolerancePct: 1, heaterStartMm: 8.8, heaterPitchMm: 2.6});
  const AWG = {18: 0.0210, 20: 0.0333, 22: 0.0530, 24: 0.0842, 26: 0.1339};
  const FAULTS = ['none', 'usb-only', 'heater-open', 'heater-short', 'chain-short', 'Q1-stuck', 'NTC-open', 'default-reference'];
  const heaterRefs = c => Array.from({length: c.heaterCount}, (_, i) => 'RH' + (i + 1));
  const faultIndex = c => Math.min(10, c.heaterCount - 1);
  const SENSOR_REFS = ['TH1', 'TH2', 'TH3', 'TH4'];
  const SENSOR_LABELS = ['Left needle', 'Heater-needle tip', 'Right needle', 'Board diagnostic'];
  const SIGNAL_REFS = ['Q2', 'R12', 'R17', 'R11', 'C13', 'R21', 'R22', 'R23', 'R24', 'C21', 'C22', 'C23', 'C24', ...SENSOR_REFS];

  function defaultConfig() {
    return {...DEFAULT_HEATER, ...(root.SensorBoard && root.SensorBoard.heaterSpec || {}),
      batteryV: 12, pulseS: 15, dutyPct: 85, pwmHz: 100, cableM: 5, awg: 22, connectorOhm: 0,
      diodeV: 0.35, shuntOhm: 0.1, mosfetOhm: 0.032, copperOhm: 0.2,
      logicMa: 10, ambientC: 22,
      soilLambda: 1.5, soilC: 2e6, spacingMm: 8, baselineS: 10, cooldownS: 90,
      sampleS: 1, settlingMs: 10, acquisitionMs: 10, averages: 64,
      adcReference: 'external', maxBatteryV: 14.4, fault: 'none'};
  }

  function config(input) { return Object.assign(defaultConfig(), input || {}); }
  function validate(input) {
    const c = config(input), errors = [], warnings = [];
    const bounds = {batteryV: [0, 40], pulseS: [0.01, 120], cableM: [0, 1000], connectorOhm: [0, 100],
      diodeV: [0, 2], shuntOhm: [0.001, 10], mosfetOhm: [0, 10], copperOhm: [0, 100],
      logicMa: [0, 150], rEachOhm: [0.1, 100], tolerancePct: [0, 50], ambientC: [-40, 155],
      soilLambda: [0.05, 10], soilC: [1e5, 1e7], spacingMm: [1, 30], baselineS: [0.1, 60],
      cooldownS: [1, 600], sampleS: [0.05, 10], settlingMs: [0, 1000], acquisitionMs: [0.01, 1000],
      averages: [1, 4096], maxBatteryV: [6, 20], dutyPct: [0, 100], pwmHz: [100, 100],
      heaterCount: [3, 200], heaterRatingW: [0.001, 10], heaterDeratingStartC: [-40, 150],
      heaterMaxC: [1, 250], heaterStartMm: [0, 1000], heaterPitchMm: [0.01, 100]};
    for (const [key, range] of Object.entries(bounds)) {
      if (typeof c[key] !== 'number' || !Number.isFinite(c[key]) || c[key] < range[0] || c[key] > range[1])
        errors.push(key + ' must be a finite number in [' + range.join(', ') + '].');
    }
    if (!Object.prototype.hasOwnProperty.call(AWG, c.awg)) errors.push('Unsupported wire gauge. Choose 18, 20, 22, 24 or 26 AWG.');
    if (!Number.isInteger(c.averages)) errors.push('averages must be an integer.');
    if (!Number.isInteger(c.heaterCount)) errors.push('heaterCount must be an integer.');
    if (typeof c.heaterPartNumber !== 'string' || !c.heaterPartNumber.trim()) errors.push('heaterPartNumber must identify the modeled resistor.');
    if (c.heaterMaxC <= c.heaterDeratingStartC) errors.push('Heater maximum temperature must exceed its derating start temperature.');
    if (!FAULTS.includes(c.fault)) errors.push('Unknown fault scenario.');
    if (!['external', 'default'].includes(c.adcReference)) errors.push('adcReference must be external or default.');
    if ((c.settlingMs + c.acquisitionMs) / 1000 >= c.sampleS) errors.push('Settling and acquisition must fit inside one sample interval.');
    if (c.sampleS - (c.settlingMs + c.acquisitionMs) / 1000 < 0.005 - 1e-9)
      errors.push('Allow at least 5 ms with Q2 off; faster repeated sampling needs a capacitor-recharge model.');
    // The steady model assumes the chosen logic current can be supplied. Reject
    // impossible loads rather than creating a fictitious regulated 4.75 V rail.
    const loop = 2 * c.cableM * AWG[c.awg] + c.connectorOhm;
    const availableV = c.batteryV - c.diodeV - c.logicMa / 1000 * loop;
    if (c.fault !== 'usb-only' && c.batteryV > c.diodeV && availableV < 0)
      errors.push('Cable drop cannot supply the chosen logic load. This configuration requires a brownout/power-supply model.');
    const partCount = c.fault === 'heater-short' ? c.heaterCount - 1 : c.heaterCount;
    const estimatedI = c.fault === 'heater-open' ? 0 : Math.max(0, availableV / (partCount * c.rEachOhm + loop + c.shuntOhm + c.mosfetOhm + c.copperOhm));
    const protectedV = c.batteryV - c.diodeV - (estimatedI + c.logicMa / 1000) * loop;
    if (c.batteryV >= 7 && !['usb-only', 'chain-short', 'Q1-stuck'].includes(c.fault) && protectedV < 6)
      errors.push('Loaded protected input falls below the modeled 6 V regulator headroom floor. Reduce cable/load or use a brownout model.');
    if (c.pulseS < 8 || c.pulseS > 15) warnings.push('Pulse is outside the requested 8-15 s range; this is a what-if experiment.');
    const released = defaultConfig();
    if (['rEachOhm', 'heaterCount', 'heaterRatingW', 'heaterPartNumber', 'tolerancePct', 'heaterDeratingStartC', 'heaterMaxC'].some(key => c[key] !== released[key]))
      warnings.push('Heater configuration differs from the displayed board identity; this is a what-if calculation, not a released BOM substitution.');
    if (c.ambientC > c.heaterDeratingStartC) warnings.push('Heater rating is derated above ' + c.heaterDeratingStartC + ' C ambient; this is not an estimate of resistor body temperature.');
    return {valid: errors.length === 0, errors, warnings};
  }
  function checked(input) {
    const c = config(input), v = validate(c);
    if (!v.valid) throw new RangeError(v.errors.join(' '));
    return c;
  }
  function ratingAt(ambientC, input) {
    const c = config(input);
    return c.heaterRatingW * Math.max(0, Math.min(1,
      (c.heaterMaxC - ambientC) / (c.heaterMaxC - c.heaterDeratingStartC)));
  }
  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }

  function solve(c, resistances, open) {
    const cableOhm = 2 * c.cableM * AWG[c.awg] + c.connectorOhm;
    const chainOhm = resistances.reduce((a, b) => a + b, 0);
    const logicA = c.fault === 'usb-only' || c.batteryV <= c.diodeV ? 0 : c.logicMa / 1000;
    const batteryV = c.fault === 'usb-only' ? 0 : c.batteryV;
    const denominator = chainOhm + cableOhm + c.shuntOhm + c.mosfetOhm + c.copperOhm;
    const currentA = open ? 0 : Math.max(0, (batteryV - logicA * cableOhm - c.diodeV) / denominator);
    const totalA = currentA + logicA;
    const inputV = Math.max(0, batteryV - totalA * cableOhm);
    const vinProtectedV = Math.max(0, inputV - c.diodeV);
    const inaBusV = Math.max(0, vinProtectedV - currentA * c.shuntOhm);
    const heaterPowerW = currentA * currentA * chainOhm;
    const losses = {cableW: totalA * totalA * cableOhm, diodeW: totalA * Math.min(c.diodeV, inputV),
      shuntW: currentA * currentA * c.shuntOhm, mosfetW: currentA * currentA * c.mosfetOhm,
      copperW: currentA * currentA * c.copperOhm, logicInputW: logicA * vinProtectedV};
    return {currentA, chainOhm, cableOhm, inputV, vinProtectedV, inaBusV,
      heaterVoltageV: currentA * chainOhm, shuntVoltageV: currentA * c.shuntOhm,
      heaterPowerW, inaPowerW: inaBusV * currentA, batteryPowerW: batteryV * totalA,
      losses, totalA};
  }

  function electrical(input) {
    const c = checked(input), resistances = Array(c.heaterCount).fill(c.rEachOhm), refs = heaterRefs(c), bad = faultIndex(c);
    if (c.fault === 'heater-short') resistances[bad] = 0;
    if (c.fault === 'chain-short') resistances.fill(0);
    const on = solve(c, resistances, c.fault === 'heater-open'), off = solve(c, resistances, true);
    const duty = c.fault === 'Q1-stuck' ? 1 : c.dutyPct / 100;
    const mix = (a, b) => duty * a + (1 - duty) * b;
    const s = {};
    for (const key of Object.keys(on)) if (key !== 'losses') s[key] = mix(on[key], off[key]);
    s.losses = Object.fromEntries(Object.keys(on.losses).map(key => [key, mix(on.losses[key], off.losses[key])]));
    s.chainOhm = c.fault === 'heater-open' ? Infinity : on.chainOhm;
    const ratingW = ratingAt(c.ambientC, c);
    const parts = resistances.map((ohm, i) => {
      const onPowerW = on.currentA * on.currentA * ohm;
      return {ref: refs[i], ohm: c.fault === 'heater-open' && i === bad ? Infinity : ohm,
        powerW: duty * onPowerW, onPowerW, ratingW,
        utilization: ratingW > 0 ? onPowerW / ratingW : onPowerW > 0 ? Infinity : 0,
        open: c.fault === 'heater-open' && i === bad, short: ohm === 0};
    });
    const low = c.rEachOhm * (1 - c.tolerancePct / 100), high = c.rEachOhm * (1 + c.tolerancePct / 100);
    // For one local hot spot: that resistor high, the remaining parts low. For chain
    // current: every resistor low. These are different tolerance corners.
    const corner = Array(c.heaterCount).fill(low); corner[bad] = high;
    const highSpot = solve(c, corner, false), allLow = solve(c, Array(c.heaterCount).fill(low), false);
    const worstPowerW = highSpot.currentA * highSpot.currentA * high;
    return Object.assign(s, {parts, dutyPct: duty * 100, commandedDutyPct: c.dutyPct, pwmHz: c.pwmHz,
      onCurrentA: on.currentA, onHeaterPowerW: on.heaterPowerW, onInaPowerW: on.inaPowerW,
      onHeaterVoltageV: on.heaterVoltageV, onShuntVoltageV: on.shuntVoltageV,
      onVinProtectedV: on.vinProtectedV, onInaBusV: on.inaBusV, onBatteryPowerW: on.batteryPowerW,
      heaterEnergyJ: s.heaterPowerW * c.pulseS, inaEnergyJ: s.inaPowerW * c.pulseS,
      energyOverestimatePct: s.heaterPowerW > 0 ? 100 * (s.inaPowerW / s.heaterPowerW - 1) : null,
      ratingW, toleranceWorst: {powerW: worstPowerW, onPowerW: worstPowerW, averagePowerW: duty * worstPowerW,
        utilization: ratingW > 0 ? worstPowerW / ratingW : worstPowerW > 0 ? Infinity : 0,
        currentA: highSpot.currentA, allLowCurrentA: allLow.currentA, allLowChainOhm: c.heaterCount * low,
        highPartOhm: high, otherPartsOhm: low, note: 'Healthy ' + c.heaterCount + '-part chain; one +tolerance part, remaining parts -tolerance. Full-ON stress; fault cases need separate checks.'}});
  }

  function stagesFor(c) {
    const pulseStart = 2 + c.baselineS, pulseEnd = pulseStart + c.pulseS, reportStart = pulseEnd + c.cooldownS;
    return [
      {id: 'idle', label: 'Idle', startS: 0, endS: 2, command: 'D9 LOW; D4 LOW. Wait for a measurement request.'},
      {id: 'baseline', label: 'Baseline', startS: 2, endS: pulseStart, command: 'Select AR_EXTERNAL and 14-bit ADC. Take repeated baseline temperatures; configure INA226 calibration and conversions.'},
      {id: 'pulse', label: 'Heat pulse', startS: pulseStart, endS: pulseEnd,
        command: c.dutyPct === 0 ? 'Keep D9 LOW: 0% duty delivers no heat. Continue temperature sampling.' :
          'Drive D9/Q1 at ' + c.dutyPct + '% duty' + (c.dutyPct < 100 ? ' and ' + c.pwmHz + ' Hz' : ' (continuously ON)') +
          '. Sample INA226 during a settled ON interval and integrate ON power over ON time; continue temperature sampling.'},
      {id: 'cooldown', label: 'Cooling', startS: pulseEnd, endS: reportStart, command: 'D9 LOW turns Q1 off. Continue temperature sampling while heat spreads through the soil.'},
      {id: 'report', label: 'Report', startS: reportStart, endS: reportStart + 2, command: 'Keep D9 LOW; check faults and return buffered temperatures and measured energy over SDI-12.'}
    ];
  }

  function warningsFor(c, e, validation) {
    const w = validation.warnings.map(message => ({severity: 'info', code: 'WHAT_IF', message}));
    const add = (severity, code, message) => w.push({severity, code, message});
    add('info', 'MODEL_SCOPE', 'Proposed measurement sequence, not tested firmware. PWM uses weighted constant-resistance ON/OFF states and ideal soil heating. Switching transients, INA sampling errors, resistor body temperature and long-term reliability are not predicted.');
    if (c.batteryV > c.maxBatteryV && c.fault !== 'usb-only') add('error', 'HIGH_BATTERY', 'Battery exceeds the chosen software limit. This simulation refuses the commanded pulse; no independent overvoltage cutoff is modeled.');
    if (c.batteryV < 7 && c.fault !== 'usb-only') add('error', 'LOW_BATTERY', 'Insufficient input for reliable 5 V logic operation; commanded heating is inhibited by the proposed software policy.');
    if (e.parts.some(p => p.utilization > 1)) add('error', 'PART_RATING', 'One or more heater resistors exceeds its continuous power screening limit during ON time. Lower duty or a shorter pulse is not an approved overload allowance.');
    else if (e.toleranceWorst.utilization > 1 && !['heater-open', 'chain-short', 'usb-only'].includes(c.fault)) add('warning', 'TOLERANCE_RATING', 'A healthy-chain tolerance corner can exceed one resistor’s continuous rating even though nominal values pass.');
    if (e.onShuntVoltageV > 0.08192) add('error', 'INA_SATURATION', 'The modeled ON-state shunt voltage exceeds INA226 range. Lower duty does not prevent saturation during conduction.');
    if (e.currentA > 0 && e.onVinProtectedV < 6) add('error', 'FAULT_BROWNOUT', 'During conduction the input cannot sustain the assumed logic supply. ADC readings are suppressed during the pulse; PWM ripple and reset/oscillation dynamics are outside this model.');
    if (c.settlingMs < 5) add('warning', 'ADC_SETTLING', 'Short settling interval: divider capacitors start near VREF and must settle after Q2 turns on.');
    if (c.adcReference === 'default' || c.fault === 'default-reference') add('warning', 'ADC_REFERENCE', 'Default supply reference differs from VREF after R11; applying the external-reference equation creates a temperature bias.');
    if (c.fault === 'usb-only') add('warning', 'USB_ONLY', 'USB powers logic through D5 only. It cannot power the heater through D1/R5.');
    if (c.fault === 'heater-open') add('error', 'HEATER_OPEN', 'RH' + (faultIndex(c) + 1) + ' is open: commanded heat produces zero heater current and zero delivered energy.');
    if (c.fault === 'heater-short') add('warning', 'HEATER_SHORT', 'RH' + (faultIndex(c) + 1) + ' is bypassed: total resistance falls and the other ' + (c.heaterCount - 1) + ' resistors run hotter. Total resistance alone does not localize this fault.');
    if (c.fault === 'chain-short') add('error', 'CHAIN_SHORT', 'Whole heater chain is bypassed. Current is limited only by modeled series resistance. Large copper/switch losses are excluded from the soil-temperature curves; component survival and battery current limiting are not modeled.');
    if (c.fault === 'Q1-stuck') add('error', 'STUCK_SWITCH', 'Q1 is shorted drain-to-source: heating continues even when D9 is LOW. A firmware watchdog cannot switch off this physical fault; disconnect battery power.');
    if (c.fault === 'NTC-open') add('error', 'NTC_OPEN', 'TH1 is disconnected: its ADC node approaches VREF and must be reported as a sensor fault, not a valid cold temperature.');
    return w;
  }

  function powered(c) { return c.fault === 'usb-only' || c.batteryV >= 7; }
  function blocked(c) { return c.fault === 'usb-only' || c.batteryV < 7 || c.batteryV > c.maxBatteryV; }
  function heatElapsed(run, t) {
    if (run.config.fault === 'Q1-stuck') return Math.max(0, t);
    if (blocked(run.config)) return 0;
    return clamp(t - run.stages[2].startS, 0, run.config.pulseS);
  }
  // Ideal homogeneous-medium temperature, in degrees C. Positions are mm from
  // the heater axis and prong root. Even at the nominal steel radius this is a
  // soil-field proxy, not a prediction of steel, epoxy or resistor temperature.
  function temperatureAtPosition(run, timeS, radialMm, axialMm) {
    if (!run || !run.config || !run.stages || !run.electrical)
      throw new TypeError('temperatureAtPosition needs a simulation.');
    if (![timeS, radialMm, axialMm].every(Number.isFinite) || radialMm <= 0)
      throw new RangeError('Time and positions must be finite; radial distance must be greater than zero.');
    const c = run.config, e = run.electrical, engine = run._thermalEngine;
    const start = c.fault === 'Q1-stuck' ? 0 : run.stages[2].startS;
    const duration = c.fault === 'Q1-stuck' ? Infinity : c.pulseS;
    if (!engine || !engine.dTpoint || !heatElapsed(run, timeS) || e.heaterPowerW === 0) return c.ambientC;
    return c.ambientC + engine.dTpoint(run._thermalSources, radialMm / 1000, axialMm / 1000,
      timeS - start, duration, run._thermalSoil);
  }
  function thermalAt(run, t) {
    const c = run.config;
    const left = temperatureAtPosition(run, t, c.spacingMm, 29.8);
    // TH2 is beyond the last heater. Its existing effective-radius approximation
    // samples the same ideal field; it is not a steel/epoxy thermistor-body model.
    const tip = temperatureAtPosition(run, t, 0.85, 54.08);
    // TH4 is a board diagnostic; body conduction is explicitly not modeled.
    return [left, tip, left, c.ambientC];
  }

  function resistanceAt(tempC) { return 10000 * Math.exp(3380 * (1 / (tempC + 273.15) - 1 / 298.15)); }
  function temperatureAt(resistance) { return 1 / (Math.log(resistance / 10000) / 3380 + 1 / 298.15) - 273.15; }

  // Ideal four-divider network; VREF is continuously powered through R11=10R.
  // Q2 switches their common ground, NOT the reference. Include shared Q2 drop.
  // Nodes start charged near VREF; acquisition averages 64 deterministic ADC codes.
  // No fabricated random precision or calibrated self-heating is implied.
  function sampleReadings(run, atS) {
    const c = run.config, truth = thermalAt(run, atS);
    const heating = c.fault === 'Q1-stuck' || (!blocked(c) && atS >= run.stages[2].startS && atS < run.stages[2].endS);
    if (!powered(c) || (heating && run.electrical.currentA > 0 && run.electrical.onVinProtectedV < 6)) return [];
    const rs = truth.map(resistanceAt);
    if (c.fault === 'NTC-open') rs[0] = Infinity;
    const railV = 4.75; // chosen 5.0 V LDO minus D7 drop; actual diode drop is load dependent
    const conductance = rs.reduce((s, r) => s + 1 / (10000 + r), 0);
    const referenceA = 150e-6; // conservative ADC reference load assumption, not typical measurement
    const effectiveG = conductance / (1 + conductance * c.mosfetOhm);
    const vrefV = (railV - referenceA * 10) / (1 + effectiveG * 10);
    const returnV = vrefV * effectiveG * c.mosfetOhm;
    const adcReferenceV = c.adcReference === 'default' || c.fault === 'default-reference' ? railV : vrefV;
    const adcMax = 16383;
    return rs.map((r, i) => {
      if (!Number.isFinite(r)) return {ref: SENSOR_REFS[i], label: SENSOR_LABELS[i], channel: 'A' + i,
        atS, trueC: truth[i], tempC: null, resistanceOhm: null, code: clamp(Math.round(vrefV / adcReferenceV * adcMax), 0, adcMax), voltageV: vrefV, vrefV,
        adcReferenceV, fault: 'open', selfHeatingW: 0};
      const steadyV = (vrefV * r + returnV * 10000) / (10000 + r);
      const tau = (r * 10000 / (r + 10000)) * 100e-9;
      let codeSum = 0, voltageSum = 0;
      for (let n = 0; n < c.averages; n++) {
        const age = (c.settlingMs + c.acquisitionMs * (n + 0.5) / c.averages) / 1000;
        const volts = steadyV + (railV - steadyV) * Math.exp(-age / tau);
        voltageSum += volts;
        codeSum += clamp(Math.round(volts / adcReferenceV * adcMax), 0, adcMax);
      }
      const code = codeSum / c.averages, inferredR = code >= adcMax ? Infinity : 10000 * code / (adcMax - code);
      const fault = !Number.isFinite(inferredR) || code <= 0 ? 'out-of-range' : null;
      return {ref: SENSOR_REFS[i], label: SENSOR_LABELS[i], channel: 'A' + i, atS, trueC: truth[i],
        tempC: fault ? null : temperatureAt(inferredR), resistanceOhm: fault ? null : inferredR,
        code, voltageV: voltageSum / c.averages, vrefV, adcReferenceV, fault,
        selfHeatingW: Math.pow((vrefV - returnV) / (10000 + r), 2) * r};
    });
  }

  function measurementAt(run, timeS) {
    const c = run.config, start = run.stages[1].startS, end = run.stages[4].startS;
    if (!powered(c) || timeS < start || timeS >= end) return {phase: 'off', sampleStartS: null, ageMs: null};
    const index = Math.floor((timeS - start + 1e-10) / c.sampleS);
    const sampleStartS = start + index * c.sampleS, ageMs = (timeS - sampleStartS) * 1000;
    return {phase: ageMs < c.settlingMs - 1e-7 ? 'settling' : ageMs < c.settlingMs + c.acquisitionMs - 1e-7 ? 'reading' : 'off', sampleStartS, ageMs};
  }

  function stateAt(run, atS) {
    if (!run || !run.stages || !Number.isFinite(atS)) throw new TypeError('stateAt needs a simulation and finite time in seconds.');
    const c = run.config, e = run.electrical, t = clamp(atS, 0, run.totalS);
    const stage = run.stages.find(s => t >= s.startS && t < s.endS) || run.stages[4];
    // d9 denotes an enabled heater command, not the 100 Hz pin waveform.
    const d9 = stage.id === 'pulse' && !blocked(c) && c.dutyPct > 0;
    const heaterOn = (d9 || c.fault === 'Q1-stuck') && c.fault !== 'usb-only' && e.currentA > 0;
    const logicValid = powered(c) && !(heaterOn && e.onVinProtectedV < 6);
    const m = logicValid ? measurementAt(run, t) : {phase: 'off', sampleStartS: null, ageMs: null};
    const d4 = m.phase !== 'off';
    const acquired = (c.settlingMs + c.acquisitionMs) / 1000;
    const lastIndex = Math.floor((Math.min(t, run.stages[4].startS - 1e-9) - run.stages[1].startS - acquired + 1e-10) / c.sampleS);
    const readings = logicValid && lastIndex >= 0 ? sampleReadings(run, run.stages[1].startS + lastIndex * c.sampleS + acquired) : [];
    const activeRefs = logicValid ? ['U1', 'C7', 'C8', 'C9', 'R11', 'C13'] : [];
    if (logicValid) activeRefs.push(...(c.fault === 'usb-only' ? ['J2', 'D5'] : ['J1', 'D1', 'U3', 'D7', 'C1', 'C2', 'C17']));
    if (logicValid && !['idle', 'report'].includes(stage.id)) activeRefs.push('U4', 'C12', 'R6', 'R7');
    if (heaterOn) activeRefs.push('J1', 'D1', 'R5', 'Q1', ...heaterRefs(c));
    if (d9) activeRefs.push('R9', 'R10', 'Q1');
    if (d4) activeRefs.push(...SIGNAL_REFS);
    if (stage.id === 'report' && logicValid) activeRefs.push('J1', 'R3', 'R4', 'C4');
    let command = stage.command;
    if (stage.id === 'pulse' && blocked(c)) command = 'Proposed software guard: refuse heating because battery power is unavailable or outside the chosen limits.';
    if (d4) command += m.phase === 'settling' ? ' D4 HIGH: Q2 closes the divider ground; wait for C21-C24 to settle.' : ' Keep D4 HIGH; average ' + c.averages + ' ADC readings on A0-A3, then set D4 LOW.';
    if (c.fault === 'Q1-stuck') command += ' FAULT: D9 cannot stop the physical Q1 short. Disconnect battery power.';
    if (heaterOn && !logicValid) command += ' FAULT: severe supply sag invalidates the ADC and logic state. Displayed current is only a DC fault estimate; brownout/reset dynamics are not modeled.';
    const elapsed = heatElapsed(run, t);
    return {timeS: t, stage: stage.id, stageLabel: stage.label, command, activeRefs: [...new Set(activeRefs)],
      d9, d4, heaterOn, logicValid, measurementPhase: m.phase, measurementAgeMs: m.ageMs, sampleStartS: m.sampleStartS,
      currentA: heaterOn ? e.currentA : 0, powerW: heaterOn ? e.heaterPowerW : 0,
      heaterPowerW: heaterOn ? e.heaterPowerW : 0, inaPowerW: heaterOn ? e.inaPowerW : 0,
      onCurrentA: heaterOn ? e.onCurrentA : 0, onHeaterPowerW: heaterOn ? e.onHeaterPowerW : 0,
      dutyPct: heaterOn ? e.dutyPct : 0, commandedDutyPct: c.dutyPct, pwmHz: c.pwmHz,
      heaterEnergyJ: elapsed * e.heaterPowerW, energyJ: elapsed * e.heaterPowerW, inaEnergyJ: elapsed * e.inaPowerW,
      readings, temperaturesC: thermalAt(run, t),
      heatedZoneSoilC: temperatureAtPosition(run, t, 1.385, 29.8), firmwareExists: false};
  }

  /** Cycle-average power ledger at a stage of the proposed measurement sequence.
   * Every loss is duty*ON_loss + (1-duty)*OFF_loss, never (average current)^2*R.
   * currentA is HEATER current (as in stateAt); batteryCurrentA includes logic.
   * logicMa is held constant in every stage, including baseline, cooldown and
   * idle. It is an assumed aggregate output load, not a measured per-IC budget.
   * U3 is assumed to regulate to 5.0 V and D7 to drop 0.25 V. Separate regulator
   * quiescent current, transient charging and MCU sleep modes are not modeled.
   * CopperW is the modeled heater-loop copper loss; shared cable/connector
   * losses are cableW. INA226 consumes part of the unallocated logicRailW.
   * For a valid battery-powered case the nine leaf W fields sum to batteryW.
   * USB-only / brownout cases return valid=false and null regulator/rail power,
   * since neither a USB source model nor regulator dropout dynamics is present.
   */
  function instantaneousPower(run, atS) {
    const state = stateAt(run, atS), c = run.config;
    const resistances = run.electrical.parts.map(p => Number.isFinite(p.ohm) ? p.ohm : 0);
    const dc = state.heaterOn ? run.electrical : solve(c, resistances, true);
    const fromBattery = c.fault !== 'usb-only';
    const logicCurrentA = Math.max(0, dc.totalA - dc.currentA);
    const valid = fromBattery && state.logicValid && dc.vinProtectedV >= 6;
    const U3dissipationW = valid ? (dc.vinProtectedV - 5) * logicCurrentA : fromBattery ? null : 0;
    const D7dissipationW = valid ? 0.25 * logicCurrentA : fromBattery ? null : 0;
    const logicRailW = valid ? 4.75 * logicCurrentA : null;
    const notes = ['Displayed powers average the ON and OFF states over each PWM cycle; they do not show the switching waveform. Full-ON current and resistor power are screened separately.',
      'Electronics power is one fixed logic-current estimate shared by the MCU, INA226, thermistor dividers and other logic loads. Individual allocations are unknown.',
      'U3 output is assumed 5.0 V; D7 drop is assumed 0.25 V. Regulator quiescent current, charging transients and sleep-mode savings are omitted.'];
    if (!valid) notes.push(fromBattery ? 'Regulated-rail power is unavailable outside the supported input/headroom range; displayed circuit current remains only a DC estimate.' : 'USB powers logic through D5; this helper accounts for battery power only, so USB logic power is unavailable.');
    return {valid, timeS: state.timeS, stage: state.stage,
      batteryW: dc.batteryPowerW, batteryCurrentA: dc.totalA, currentA: dc.currentA,
      heaterW: dc.heaterPowerW, onCurrentA: state.onCurrentA, onHeaterPowerW: state.onHeaterPowerW,
      dutyPct: state.dutyPct, pwmHz: c.pwmHz,
      perHeaterW: run.electrical.parts.map(p => ({ref: p.ref, powerW: state.heaterOn ? p.powerW : 0,
        onPowerW: state.heaterOn ? p.onPowerW : 0})),
      shuntW: dc.losses.shuntW, mosfetW: dc.losses.mosfetW, copperW: dc.losses.copperW,
      D1W: dc.losses.diodeW, cableW: dc.losses.cableW,
      U3dissipationW, D7dissipationW, logicRailW,
      electronics: {inputW: fromBattery ? dc.losses.logicInputW : null, railW: logicRailW,
        currentA: valid ? logicCurrentA : null,
        allocation: 'Aggregate only; individual MCU/INA consumption is not modeled.'}, notes};
  }

  /** What the sensor would report: analyze the simulated TH1 ADC readings the way firmware
   * would. Baseline = mean of the background samples; rise = reading - baseline, one sample
   * per interval after the heater turns on; pulsed infinite-line-source fit (engine.fitILS)
   * with q' = average heater power / heated length and the nominal needle spacing.
   * The error against the soil's true lambda and C is the geometry + quantization bias. */
  const RESISTOR_LENGTH_MM = 1.6; // 0603 body; heated length = first to last resistor end
  function soilEstimate(run) {
    const c = run.config, e = run.electrical, engine = run._thermalEngine;
    if (!engine || !engine.fitILS || blocked(c) || !(e.heaterPowerW > 0) || c.fault !== 'none') return null;
    const th1 = at => { const r = sampleReadings(run, at).find(x => x.ref === 'TH1'); return r && Number.isFinite(r.tempC) ? r.tempC : NaN; };
    const acquired = (c.settlingMs + c.acquisitionMs) / 1000, start = run.stages[2].startS;
    const base = [];
    for (let at = run.stages[1].startS + acquired; at < start; at += c.sampleS) base.push(th1(at));
    const t = [], rise = [];
    for (let s = c.sampleS; s <= c.pulseS + c.cooldownS + 1e-9; s += c.sampleS) { t.push(s); rise.push(th1(start + s)); }
    const baseline = base.reduce((a, b) => a + b, 0) / base.length;
    if (!base.length || !Number.isFinite(baseline) || rise.some(v => !Number.isFinite(v))) return null;
    const heatedLengthM = ((c.heaterCount - 1) * c.heaterPitchMm + RESISTOR_LENGTH_MM) / 1000;
    const qPrime = e.heaterPowerW / heatedLengthM;
    const fit = engine.fitILS(t, rise.map(v => v - baseline), qPrime, c.spacingMm / 1000, c.pulseS, {lambda: 1, C: 2e6});
    return {lambda: fit.lambda, C: fit.C, alpha: fit.alpha, rmseC: fit.rmse, qPrimeWm: qPrime, samples: t.length,
      lambdaErrPct: 100 * (fit.lambda / c.soilLambda - 1), CErrPct: 100 * (fit.C / c.soilC - 1)};
  }

  function simulate(input, thermalEngine) {
    const c = checked(input), e = electrical(c), stages = stagesFor(c);
    const run = {config: c, electrical: e, stages, totalS: stages[4].endS,
      warnings: warningsFor(c, e, validate(c)), series: [], firmwareExists: false,
      assumptions: ['PWM is modeled as weighted ON/OFF states at 100 Hz, with no switching-transient or electrical ripple model. Cable length is one-way and resistance includes both conductors.',
        'Logic load, copper resistance and diode drops are adjustable assumptions, not board measurements. Heater resistance has no temperature-coefficient feedback in this model.',
        'AR_EXTERNAL; 4.75 V logic rail; 150 uA reference load assumption; ideal NTC beta=3380 K model; deterministic quantization.',
        'Finite heater points in uniform soil, no steel/epoxy/contact/PCB thermal model. TH4 is held at ambient.',
        'Heated-zone soil proxy is evaluated at radius 1.385 mm and axial position 29.8 mm; it is not steel, epoxy, or resistor-chip temperature.',
        'Resistor rating screens full-ON power regardless of duty; it is not proof of reliable operation inside an epoxy-filled needle.',
        'INA power includes modeled copper and Q1 loss downstream of R5. Real PWM measurement requires synchronized ON-state sampling and integration over ON time; ADC/INA offsets and timing errors are not included.']};
    Object.defineProperty(run, '_thermalEngine', {value: thermalEngine || root.HPTwin || null});
    Object.defineProperty(run, '_thermalSources', {value: e.parts.map((p, i) => ({z: (c.heaterStartMm + c.heaterPitchMm * i) / 1000, p: p.powerW}))});
    Object.defineProperty(run, '_thermalSoil', {value: {lambda: c.soilLambda, C: c.soilC, alpha: c.soilLambda / c.soilC}});
    if (!run._thermalEngine) run.warnings.push({severity: 'warning', code: 'NO_THERMAL_ENGINE', message: 'Load engine.js or supply HPTwin to simulate temperature rise. Electrical calculations are available.'});
    const count = Math.ceil(run.totalS / 0.25);
    for (let n = 0; n <= count; n++) {
      const t = Math.min(run.totalS, n * 0.25), temps = thermalAt(run, t);
      const inPulse = t >= stages[2].startS && t < stages[2].endS && !blocked(c);
      const on = (inPulse || c.fault === 'Q1-stuck') && e.currentA > 0;
      const stage = stages.find(s => t >= s.startS && t < s.endS) || stages[4];
      run.series.push({t, tempL: temps[0], tempTip: temps[1], tempR: temps[2], tempBody: temps[3],
        tempHeatedZoneSoil: temperatureAtPosition(run, t, 1.385, 29.8),
        heaterPowerW: on ? e.heaterPowerW : 0, energyJ: heatElapsed(run, t) * e.heaterPowerW, stage: stage.id});
    }
    run.deliveredHeaterEnergyJ = heatElapsed(run, run.totalS) * e.heaterPowerW;
    run.measuredInaEnergyJ = heatElapsed(run, run.totalS) * e.inaPowerW;
    return run;
  }

  const api = {defaultConfig, validate, electrical, simulate, soilEstimate, stateAt, instantaneousPower, sampleReadings, ratingAt, temperatureAtPosition,
    resistanceAt, temperatureAt, FAULTS, get HEATER_COUNT() { return defaultConfig().heaterCount; }, AWG_OHM_PER_M: AWG};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SensorModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
