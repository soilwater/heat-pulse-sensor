/* Compact Nano-body hardware teaching model. No firmware is executed and no hardware is driven.
 * Circuit values: flat-nano/kicad/netlist.json and flat-nano/fab/HP-SDI12-NANO_BOM.csv.
 * Heater: Vishay CRCW06033R30FKEAHP, 3.3 ohm +/-1%, 0.33 W at <=70 C,
 * linear ambient derating to zero at 155 C (Vishay D/CRCW-HP data sheet).
 * https://www.vishay.com/doc?20043=
 * Thermal curves use HPTwin's finite point sources in homogeneous soil. They
 * exclude the needle, epoxy, PCB thermal mass, contact resistance and advection.
 * PWM uses weighted ON/OFF states, not a switching-transient simulation.
 * Constant electrical resistance and diode drop are assumptions, not calibration.
 * 5 V supply: U3, TI LMR36503R5 fixed 5 V synchronous buck (TI data sheet SNVSBB4B,
 * https://www.ti.com/lit/ds/symlink/lmr36503.pdf), then D7 (1N5819WS) to the +5V logic rail.
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
  // Left and right as drawn: top face, cable end up, needles pointing down.
  const SENSOR_LABELS = ['Right needle', 'Heater-needle tip', 'Left needle', 'Board diagnostic'];
  // Thermistor ADC inputs (netlist nets A2_TH1, A1_TH2, A0_TH3, A3_TH4; U1 pins 63, 64, 53, 62).
  const ADC_CHANNEL = Object.freeze({TH1: 'A2', TH2: 'A1', TH3: 'A0', TH4: 'A3'});
  // Powered only while pin D4 is HIGH: R11 charges C13 (VREF), which feeds AREF and the four
  // R2x/THx dividers filtered by C21-C24. The thermistors return straight to GND.
  const SIGNAL_REFS = ['R11', 'C13', 'R21', 'R22', 'R23', 'R24', 'C21', 'C22', 'C23', 'C24', ...SENSOR_REFS];
  const LOGIC_REFS = ['U1', 'C7', 'C8', 'C9', 'C10'];
  // Cable holes, D1, input capacitors, the U3 buck stage (C19 BOOT, C20 VCC, L1, C2) and D7/C17.
  const BATTERY_SUPPLY_REFS = ['J1', 'D1', 'C1', 'C18', 'C3', 'U3', 'C19', 'C20', 'L1', 'C2', 'D7', 'C17'];
  // Programming-clip 5 V (J2 hole 1, VUSB) through D5; R15/R16 sense it; C16 holds VCC_USB.
  const CLIP_SUPPLY_REFS = ['J2', 'D5', 'R15', 'R16', 'C16'];
  const HEATER_SUPPLY_REFS = ['J1', 'D1', 'C3', 'R5', 'Q1'];

  // U3 regulates 5V_BUCK to 5.0 V; D7 (assumed 0.25 V) feeds the 4.75 V +5V rail.
  const BUCK_OUT_V = 5.0, D7_DROP_V = 0.25, RAIL_V = BUCK_OUT_V - D7_DROP_V;
  // LMR36503 data sheet: maximum duty = tON-MAX / (tON-MAX + tOFF-MIN) >= 7.6 us / 7.677 us = 99%,
  // so 5.0 V holds down to about 5.05 V at VIN_P under light load. The model adds margin for the
  // high-side switch (0.92 ohm max) and inductor resistance. Below this floor U3 is in dropout
  // and its output follows VIN_P; this model does not simulate that lower logic rail.
  const BUCK_MIN_VIN_P_V = 5.2;
  const BUCK_STOP_V = 3.0; // data sheet falling input threshold: U3 stops switching below it
  // Pin D4 (U1 pin 45, net D4_EXC) excitation network.
  const R11_OHM = 1500, C13_F = 1e-6, DIVIDER_OHM = 10000, NODE_F = 100e-9;
  const AREF_LOAD_A = 150e-6; // conservative ADC reference load assumption, not a typical measurement
  const MIN_OFF_MS = 10; // pin D4 LOW long enough for C13 and C21-C24 to discharge (~8 time constants)
  const ADC_SETTLING_MS = 8; // shorter settling leaves a visible warm bias in the modeled readings
  const SUPPLY = Object.freeze({buckOutputV: BUCK_OUT_V, d7DropV: D7_DROP_V, railV: RAIL_V,
    buckMinVinProtectedV: BUCK_MIN_VIN_P_V, buckStopV: BUCK_STOP_V, r11Ohm: R11_OHM, c13F: C13_F});

  function defaultConfig() {
    // contactOhm: optional added contact resistance at the soldered J1 cable holes; defaults to 0.
    return {...DEFAULT_HEATER, ...(root.SensorBoard && root.SensorBoard.heaterSpec || {}),
      batteryV: 12, pulseS: 15, dutyPct: 85, pwmHz: 100, cableM: 5, awg: 22, contactOhm: 0,
      diodeV: 0.35, shuntOhm: 0.1, mosfetOhm: 0.032, copperOhm: 0.2,
      // buckEfficiency: assumed U3 efficiency at the electronics load. 0.83 matches the
      // ~10 mW loss at 50 mW output quoted for this board; it is not a measurement.
      logicMa: 10, buckEfficiency: 0.83, ambientC: 22,
      soilLambda: 1.5, soilC: 2e6, spacingMm: 8, baselineS: 10, cooldownS: 150,
      sampleS: 1, settlingMs: 10, acquisitionMs: 10, averages: 64,
      // minBatteryV/maxBatteryV: proposed firmware heating policy, not regulator limits.
      adcReference: 'external', minBatteryV: 7, maxBatteryV: 14.4, fault: 'none'};
  }

  function config(input) { return Object.assign(defaultConfig(), input || {}); }
  function validate(input) {
    const c = config(input), errors = [], warnings = [];
    const bounds = {batteryV: [0, 40], pulseS: [0.01, 120], cableM: [0, 1000], contactOhm: [0, 100],
      diodeV: [0, 2], shuntOhm: [0.001, 10], mosfetOhm: [0, 10], copperOhm: [0, 100],
      logicMa: [0, 150], buckEfficiency: [0.3, 1], rEachOhm: [0.1, 100], tolerancePct: [0, 50], ambientC: [-40, 155],
      soilLambda: [0.05, 10], soilC: [1e5, 1e7], spacingMm: [1, 30], baselineS: [0.1, 60],
      cooldownS: [1, 600], sampleS: [0.05, 10], settlingMs: [0, 1000], acquisitionMs: [0.01, 1000],
      averages: [1, 4096], minBatteryV: [0, 20], maxBatteryV: [6, 20], dutyPct: [0, 100], pwmHz: [100, 100],
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
    if (c.sampleS - (c.settlingMs + c.acquisitionMs) / 1000 < MIN_OFF_MS / 1000 - 1e-9)
      errors.push('Allow at least ' + MIN_OFF_MS + ' ms with pin D4 LOW so VREF and the divider capacitors discharge; faster repeated sampling needs a capacitor charge/discharge model.');
    // The steady model assumes U3 can regulate the chosen electronics load. Reject loads
    // the cable cannot carry rather than creating a fictitious regulated 4.75 V rail.
    // Uses the same supply solution (and logic input current) as solve().
    if (!errors.length && c.fault !== 'usb-only') {
      const idle = supplyAt(c, Infinity);
      if (c.batteryV - c.diodeV >= BUCK_MIN_VIN_P_V && !idle.regulated)
        errors.push('Cable drop cannot supply the chosen electronics load at a regulated 5 V. This configuration requires a brownout/power-supply model.');
      const partCount = c.fault === 'heater-short' ? c.heaterCount - 1 : c.heaterCount;
      const heating = c.fault === 'heater-open' ? idle : supplyAt(c, partCount * c.rEachOhm + c.shuntOhm + c.mosfetOhm + c.copperOhm);
      if (c.batteryV >= c.minBatteryV && c.batteryV <= c.maxBatteryV && !['chain-short', 'Q1-stuck'].includes(c.fault) && !heating.regulated)
        errors.push('During heating the loaded VIN_P falls below about ' + BUCK_MIN_VIN_P_V + ' V, where U3 can no longer hold 5.0 V. Reduce the cable or load resistance, or use a brownout model.');
    }
    if (c.pulseS < 8 || c.pulseS > 15) warnings.push('Pulse is outside the requested 8-15 s range; this is a what-if experiment.');
    const board = defaultConfig();
    if (['rEachOhm', 'heaterCount', 'heaterRatingW', 'heaterPartNumber', 'tolerancePct', 'heaterDeratingStartC', 'heaterMaxC'].some(key => c[key] !== board[key]))
      warnings.push('Heater configuration differs from the displayed board identity; this is a what-if calculation, not a substitution in the current BOM.');
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

  // Battery-side current of the electronics while U3 regulates. A buck draws input POWER,
  // not the load current: I = 5.0 V x I_logic / (efficiency x VIN_P). validate() and
  // solve() both reach it through supplyAt().
  function logicInputA(c, vinProtectedV) {
    return c.logicMa > 0 && vinProtectedV > 0 ? BUCK_OUT_V * (c.logicMa / 1000) / (c.buckEfficiency * vinProtectedV) : 0;
  }
  // DC operating point of the shared cable, D1 and the loads on VIN_P: the heater branch
  // (heaterOhm from VIN_P to GND, Infinity when off) and U3. While U3 regulates, VIN_P is
  // the upper root of k*V^2 - V0*V + P*R = 0 (V0 = battery - D1, P = 5 V x I_logic / eff,
  // R = cable loop, k = 1 + R/heaterOhm). In dropout U3 passes about the load current;
  // below its stop threshold it draws nothing. Dropout output voltage is not modeled.
  function supplyAt(c, heaterOhm) {
    const cableOhm = 2 * c.cableM * AWG[c.awg] + c.contactOhm;
    const v0 = c.fault === 'usb-only' ? 0 : Math.max(0, c.batteryV - c.diodeV);
    const k = 1 + (Number.isFinite(heaterOhm) ? cableOhm / heaterOhm : 0);
    const loadA = c.logicMa / 1000, powerW = BUCK_OUT_V * loadA / c.buckEfficiency;
    const disc = v0 * v0 - 4 * k * powerW * cableOhm;
    const regulatedV = disc >= 0 ? (v0 + Math.sqrt(disc)) / (2 * k) : -Infinity;
    if (regulatedV >= BUCK_MIN_VIN_P_V)
      return {vinProtectedV: regulatedV, logicA: logicInputA(c, regulatedV), cableOhm, mode: 'regulating', regulated: true};
    const dropoutV = (v0 - loadA * cableOhm) / k;
    if (dropoutV >= BUCK_STOP_V) return {vinProtectedV: dropoutV, logicA: loadA, cableOhm, mode: 'dropout', regulated: false};
    return {vinProtectedV: v0 / k, logicA: 0, cableOhm, mode: 'off', regulated: false};
  }

  function solve(c, resistances, open) {
    const chainOhm = resistances.reduce((a, b) => a + b, 0);
    const loopOhm = chainOhm + c.shuntOhm + c.mosfetOhm + c.copperOhm;
    const supply = supplyAt(c, open ? Infinity : loopOhm), cableOhm = supply.cableOhm;
    const batteryV = c.fault === 'usb-only' ? 0 : c.batteryV;
    const vinProtectedV = Math.max(0, supply.vinProtectedV), logicA = supply.logicA;
    const currentA = open ? 0 : vinProtectedV / loopOhm;
    const totalA = currentA + logicA;
    const inputV = Math.max(0, batteryV - totalA * cableOhm);
    const inaBusV = Math.max(0, vinProtectedV - currentA * c.shuntOhm);
    const heaterPowerW = currentA * currentA * chainOhm;
    const losses = {cableW: totalA * totalA * cableOhm, diodeW: totalA * Math.min(c.diodeV, inputV),
      shuntW: currentA * currentA * c.shuntOhm, mosfetW: currentA * currentA * c.mosfetOhm,
      copperW: currentA * currentA * c.copperOhm, logicInputW: logicA * vinProtectedV};
    return {currentA, chainOhm, cableOhm, inputV, vinProtectedV, inaBusV,
      heaterVoltageV: currentA * chainOhm, shuntVoltageV: currentA * c.shuntOhm,
      heaterPowerW, inaPowerW: inaBusV * currentA, batteryPowerW: batteryV * totalA,
      losses, totalA, logicInputA: logicA, regulated: supply.regulated};
  }

  function electrical(input) {
    const c = checked(input), resistances = Array(c.heaterCount).fill(c.rEachOhm), refs = heaterRefs(c), bad = faultIndex(c);
    if (c.fault === 'heater-short') resistances[bad] = 0;
    if (c.fault === 'chain-short') resistances.fill(0);
    const on = solve(c, resistances, c.fault === 'heater-open'), off = solve(c, resistances, true);
    const duty = c.fault === 'Q1-stuck' ? 1 : c.dutyPct / 100;
    const mix = (a, b) => duty * a + (1 - duty) * b;
    const s = {};
    for (const key of Object.keys(on)) if (key !== 'losses' && key !== 'regulated') s[key] = mix(on[key], off[key]);
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
      onVinProtectedV: on.vinProtectedV, onRegulated: on.regulated, onInaBusV: on.inaBusV, onBatteryPowerW: on.batteryPowerW,
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
      {id: 'idle', label: 'Idle', startS: 0, endS: 2, command: 'D9 LOW; pin D4 LOW. Wait for a measurement request.'},
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
    if (c.batteryV < c.minBatteryV && c.fault !== 'usb-only') add('error', 'LOW_BATTERY', 'Battery is below the chosen ' + c.minBatteryV +
      ' V software limit, so the proposed firmware refuses to heat. ' + (powered(c)
        ? 'U3 still regulates the 5 V logic supply, so temperature sensing continues.'
        : 'VIN_P is also below about ' + BUCK_MIN_VIN_P_V + ' V, where the U3 buck can no longer hold 5.0 V; logic and readings are not simulated in this range.'));
    else if (!powered(c) && c.fault !== 'usb-only') add('error', 'LOGIC_DROPOUT', 'VIN_P is below about ' + BUCK_MIN_VIN_P_V + ' V, where the U3 buck can no longer hold 5.0 V; logic and readings are not simulated in this range.');
    if (e.parts.some(p => p.utilization > 1)) add('error', 'PART_RATING', 'One or more heater resistors exceeds its continuous power screening limit during ON time. Lower duty or a shorter pulse is not an approved overload allowance.');
    else if (e.toleranceWorst.utilization > 1 && !['heater-open', 'chain-short', 'usb-only'].includes(c.fault)) add('warning', 'TOLERANCE_RATING', 'A healthy-chain tolerance corner can exceed one resistor’s continuous rating even though nominal values pass.');
    if (e.onShuntVoltageV > 0.08192) add('error', 'INA_SATURATION', 'The modeled ON-state shunt voltage exceeds INA226 range. Lower duty does not prevent saturation during conduction.');
    if (e.currentA > 0 && !e.onRegulated && (c.fault === 'Q1-stuck' || !blocked(c))) add('error', 'FAULT_BROWNOUT', 'During conduction VIN_P cannot stay above about ' + BUCK_MIN_VIN_P_V + ' V while supplying the electronics load, so the U3 buck drops out of regulation and the logic supply sags. ADC readings are suppressed during the pulse; PWM ripple and reset/oscillation dynamics are outside this model.');
    if (c.settlingMs < ADC_SETTLING_MS) add('warning', 'ADC_SETTLING', 'Short settling interval: VREF (C13 through R11) and the divider capacitors C21-C24 start discharged and must charge after pin D4 goes HIGH. Early readings are too low, so temperatures read warm.');
    if (c.adcReference === 'default' || c.fault === 'default-reference') add('warning', 'ADC_REFERENCE', 'The default reference (the 4.75 V logic rail) differs from VREF, which pin D4 drives through R11 (1.5 kΩ) against the four dividers: about 3.5 V at 25 °C. Applying the external-reference equation creates a large temperature bias.');
    if (c.fault === 'usb-only') add('warning', 'USB_ONLY', 'Programming-clip 5 V (J2 hole 1) powers logic through D5 only. It cannot power the heater through D1/R5.');
    if (c.fault === 'heater-open') add('error', 'HEATER_OPEN', 'RH' + (faultIndex(c) + 1) + ' is open: commanded heat produces zero heater current and zero delivered energy.');
    if (c.fault === 'heater-short') add('warning', 'HEATER_SHORT', 'RH' + (faultIndex(c) + 1) + ' is bypassed: total resistance falls and the other ' + (c.heaterCount - 1) + ' resistors run hotter. Total resistance alone does not localize this fault.');
    if (c.fault === 'chain-short') add('error', 'CHAIN_SHORT', 'Whole heater chain is bypassed. Current is limited only by modeled series resistance. Large copper/switch losses are excluded from the soil-temperature curves; component survival and battery current limiting are not modeled.');
    if (c.fault === 'Q1-stuck') add('error', 'STUCK_SWITCH', 'Q1 is shorted drain-to-source: heating continues even when D9 is LOW. A firmware watchdog cannot switch off this physical fault; disconnect battery power.');
    if (c.fault === 'NTC-open') add('error', 'NTC_OPEN', 'TH1 is disconnected: its ADC node (A2) approaches VREF and must be reported as a sensor fault, not a valid cold temperature.');
    return w;
  }

  // Logic is modeled while U3 regulates with the heater off (or from the programming clip).
  function powered(c) { return c.fault === 'usb-only' || supplyAt(c, Infinity).regulated; }
  // Proposed firmware heating policy: heat only between minBatteryV and maxBatteryV.
  function blocked(c) { return c.fault === 'usb-only' || c.batteryV < c.minBatteryV || c.batteryV > c.maxBatteryV || !powered(c); }
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
    const side = temperatureAtPosition(run, t, c.spacingMm, 29.8);
    // TH2 is beyond the last heater. Its effective-radius approximation (0.85 mm at 54.08 mm)
    // samples the same ideal field; it is not a steel/epoxy thermistor-body model.
    const tip = temperatureAtPosition(run, t, 0.85, 54.08);
    // TH4 is a board diagnostic; body conduction is explicitly not modeled.
    return [side, tip, side, c.ambientC];
  }

  function resistanceAt(tempC) { return 10000 * Math.exp(3380 * (1 / (tempC + 273.15) - 1 / 298.15)); }
  function temperatureAt(resistance) { return 1 / (Math.log(resistance / 10000) / 3380 + 1 / 298.15) - 273.15; }

  // Step response of a first-order node driven by a first-order ramp (time constants a, b).
  function followRamp(t, a, b) {
    if (Math.abs(a - b) <= 1e-6 * Math.max(a, b)) return 1 - (1 + t / a) * Math.exp(-t / a);
    return 1 - (a * Math.exp(-t / a) - b * Math.exp(-t / b)) / (a - b);
  }

  // Pin D4 (U1 pin 45, net D4_EXC) powers VREF through R11 (1.5 kΩ) into C13 (1 µF). VREF feeds
  // the four 10 kΩ dividers and AREF (U1 pin 59); the thermistors return straight to GND, with
  // no switch in the return. Sequence: pin D4 HIGH, wait settlingMs, average the ADC readings,
  // pin D4 LOW. Between readings everything discharges, so VREF and every node start at 0 V.
  // VREF rises with tau = C13 x (R11 || divider load) (about 1.15 ms); each node follows it
  // through (10 kΩ || NTC) x 100 nF. The ADC ratio uses the momentary VREF because AREF = VREF.
  // Pin D4 is taken as the 4.75 V rail; its own output resistance adds to R11 and is not modeled.
  // Acquisition averages deterministic ADC codes. No fabricated random precision or calibrated
  // self-heating is implied.
  function sampleReadings(run, atS) {
    const c = run.config, truth = thermalAt(run, atS);
    const heating = c.fault === 'Q1-stuck' || (!blocked(c) && atS >= run.stages[2].startS && atS < run.stages[2].endS);
    if (!powered(c) || (heating && run.electrical.currentA > 0 && !run.electrical.onRegulated)) return [];
    const rs = truth.map(resistanceAt);
    if (c.fault === 'NTC-open') rs[0] = Infinity;
    const pinV = RAIL_V; // programming-clip power through D5 gives about the same rail
    const conductance = rs.reduce((s, r) => s + 1 / (DIVIDER_OHM + r), 0);
    const vrefV = (pinV - AREF_LOAD_A * R11_OHM) / (1 + conductance * R11_OHM);
    const tauRef = C13_F / (1 / R11_OHM + conductance);
    const external = !(c.adcReference === 'default' || c.fault === 'default-reference');
    const adcReferenceV = external ? vrefV : RAIL_V;
    const referenceAt = t => external ? vrefV * (1 - Math.exp(-t / tauRef)) : RAIL_V;
    const adcMax = 16383, onFraction = (c.settlingMs + c.acquisitionMs) / 1000 / c.sampleS;
    const ages = Array.from({length: c.averages}, (_, n) => (c.settlingMs + c.acquisitionMs * (n + 0.5) / c.averages) / 1000);
    return rs.map((r, i) => {
      const open = !Number.isFinite(r), gain = open ? 1 : r / (DIVIDER_OHM + r);
      const tauNode = (open ? DIVIDER_OHM : r * DIVIDER_OHM / (r + DIVIDER_OHM)) * NODE_F;
      let codeSum = 0, voltageSum = 0;
      for (const age of ages) {
        const volts = gain * vrefV * followRamp(age, tauRef, tauNode), referenceV = referenceAt(age);
        voltageSum += volts;
        codeSum += referenceV > 0 ? clamp(Math.round(volts / referenceV * adcMax), 0, adcMax) : 0;
      }
      const code = codeSum / c.averages, base = {ref: SENSOR_REFS[i], label: SENSOR_LABELS[i],
        channel: ADC_CHANNEL[SENSOR_REFS[i]], atS, trueC: truth[i], code, voltageV: voltageSum / c.averages, vrefV, adcReferenceV};
      if (open) return {...base, tempC: null, resistanceOhm: null, fault: 'open', selfHeatingW: 0, selfHeatingAvgW: 0};
      const inferredR = code >= adcMax ? Infinity : DIVIDER_OHM * code / (adcMax - code);
      const fault = !Number.isFinite(inferredR) || code <= 0 ? 'out-of-range' : null;
      // Dissipated only while pin D4 is HIGH; selfHeatingAvgW spreads it over the sample interval.
      const selfHeatingW = Math.pow(vrefV / (DIVIDER_OHM + r), 2) * r;
      return {...base, tempC: fault ? null : temperatureAt(inferredR), resistanceOhm: fault ? null : inferredR,
        fault, selfHeatingW, selfHeatingAvgW: selfHeatingW * onFraction};
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
    const logicValid = powered(c) && !(heaterOn && !e.onRegulated);
    const m = logicValid ? measurementAt(run, t) : {phase: 'off', sampleStartS: null, ageMs: null};
    const d4 = m.phase !== 'off';
    const acquired = (c.settlingMs + c.acquisitionMs) / 1000;
    const lastIndex = Math.floor((Math.min(t, run.stages[4].startS - 1e-9) - run.stages[1].startS - acquired + 1e-10) / c.sampleS);
    const readings = logicValid && lastIndex >= 0 ? sampleReadings(run, run.stages[1].startS + lastIndex * c.sampleS + acquired) : [];
    const activeRefs = logicValid ? [...LOGIC_REFS, ...(c.fault === 'usb-only' ? CLIP_SUPPLY_REFS : BATTERY_SUPPLY_REFS)] : [];
    if (logicValid && !['idle', 'report'].includes(stage.id)) activeRefs.push('U4', 'C12', 'R6', 'R7');
    if (heaterOn) activeRefs.push(...HEATER_SUPPLY_REFS, ...heaterRefs(c));
    if (d9) activeRefs.push('R9', 'R10', 'Q1');
    // VREF (R11, C13) and the dividers are powered only while pin D4 is HIGH.
    if (d4) activeRefs.push(...SIGNAL_REFS);
    if (stage.id === 'report' && logicValid) activeRefs.push('J1', 'R3', 'R4', 'C4');
    let command = stage.command;
    if (stage.id === 'pulse' && blocked(c)) command = 'Proposed software guard: refuse heating because battery power is unavailable or outside the chosen limits.';
    if (d4) command += m.phase === 'settling'
      ? ' Pin D4 HIGH powers VREF and the four thermistor dividers through R11 (1.5 kΩ); wait ' + c.settlingMs + ' ms for C13 and C21-C24 to charge.'
      : ' Keep pin D4 HIGH; average ' + c.averages + ' ADC readings on each of A0-A3, then set pin D4 LOW to switch VREF and the dividers off.';
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
   * currentA is HEATER current (as in stateAt); batteryCurrentA includes the electronics.
   * logicMa is the assumed aggregate load on the 5 V side, held constant in every stage,
   * including baseline, cooldown and idle. It is not a measured per-IC budget.
   * U3 is an LMR36503 synchronous buck: 5.0 V out at the assumed buckEfficiency, so the
   * electronics draw constant input POWER and their battery-side current is
   * 5.0 V x I_logic / (efficiency x VIN_P), falling as VIN_P rises. D7 drops 0.25 V.
   * U3dissipationW = 5.0 V x I_logic x (1/efficiency - 1). Switching ripple, charging
   * transients and processor sleep modes are not modeled.
   * copperW is the modeled heater-loop copper loss; shared cable (and optional contact
   * resistance) losses are cableW. INA226 consumes part of the unallocated logicRailW.
   * For a valid battery-powered case the nine leaf W fields sum to batteryW.
   * Programming-clip-only and dropout/brownout cases return valid=false and null
   * regulator/rail power, since neither a clip source model nor U3 dropout dynamics is present.
   */
  function instantaneousPower(run, atS) {
    const state = stateAt(run, atS), c = run.config;
    const resistances = run.electrical.parts.map(p => Number.isFinite(p.ohm) ? p.ohm : 0);
    const dc = state.heaterOn ? run.electrical : solve(c, resistances, true);
    const fromBattery = c.fault !== 'usb-only';
    const loadA = c.logicMa / 1000, inputA = Math.max(0, dc.totalA - dc.currentA);
    const valid = fromBattery && state.logicValid && (state.heaterOn ? run.electrical.onRegulated : dc.regulated);
    const U3dissipationW = valid ? BUCK_OUT_V * loadA * (1 / c.buckEfficiency - 1) : fromBattery ? null : 0;
    const D7dissipationW = valid ? D7_DROP_V * loadA : fromBattery ? null : 0;
    const logicRailW = valid ? RAIL_V * loadA : null;
    const notes = ['Displayed powers average the ON and OFF states over each PWM cycle; they do not show the switching waveform. Full-ON current and resistor power are screened separately.',
      'Electronics power is one fixed logic-current estimate shared by the processor, INA226, thermistor dividers and other logic loads. Individual allocations are unknown.',
      'U3 (LMR36503 synchronous buck) output is 5.0 V at an assumed ' + Math.round(c.buckEfficiency * 100) + '% efficiency; D7 drop is assumed 0.25 V. The battery-side electronics current therefore falls as VIN_P rises. Switching ripple, charging transients and sleep-mode savings are omitted.'];
    if (!valid) notes.push(fromBattery ? 'Regulated-rail power is unavailable while VIN_P is below about ' + BUCK_MIN_VIN_P_V + ' V (U3 dropout) or the supply browns out; displayed circuit current remains only a DC estimate.' : 'Programming-clip 5 V (J2 hole 1, VUSB) powers logic through D5; this helper accounts for battery power only, so clip power is unavailable.');
    return {valid, timeS: state.timeS, stage: state.stage,
      batteryW: dc.batteryPowerW, batteryCurrentA: dc.totalA, currentA: dc.currentA,
      vinProtectedV: dc.vinProtectedV,
      heaterW: dc.heaterPowerW, onCurrentA: state.onCurrentA, onHeaterPowerW: state.onHeaterPowerW,
      dutyPct: state.dutyPct, pwmHz: c.pwmHz,
      perHeaterW: run.electrical.parts.map(p => ({ref: p.ref, powerW: state.heaterOn ? p.powerW : 0,
        onPowerW: state.heaterOn ? p.onPowerW : 0})),
      shuntW: dc.losses.shuntW, mosfetW: dc.losses.mosfetW, copperW: dc.losses.copperW,
      D1W: dc.losses.diodeW, cableW: dc.losses.cableW,
      U3dissipationW, D7dissipationW, logicRailW,
      // currentA: 5 V-side load; inputCurrentA: battery-side current drawn by U3.
      electronics: {inputW: fromBattery ? dc.losses.logicInputW : null, railW: logicRailW,
        currentA: valid ? loadA : null, inputCurrentA: valid ? inputA : null,
        efficiency: c.buckEfficiency,
        allocation: 'Aggregate only; individual processor/INA226 consumption is not modeled.'}, notes};
  }

  /** What the sensor would report: analyze the simulated TH1 ADC readings the way firmware
   * would. Baseline = mean of the background samples; rise = reading - baseline, one sample
   * per interval after the heater turns on; pulsed infinite-line-source fit (engine.fitILS)
   * with q' = average heater power / heated length and the nominal needle spacing.
   * The error against the soil's true lambda and C is the geometry + quantization bias. */
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
    // Effective line length: each resistor stands for one pitch of an evenly heated line (17 x 2.6 mm = 44.2 mm).
    const heatedLengthM = c.heaterCount * c.heaterPitchMm / 1000;
    const qPrime = e.heaterPowerW / heatedLengthM;
    // Fit from heater-on to 1.5 x the measured peak time (or the end of the record). The peak's size and timing
    // carry the information; the tail is where the ideal line agrees least with the finite heater (and with
    // needle, contact and drift effects), so fitting it biases lambda and alpha upward. Samples recorded after
    // the window are kept but not fitted.
    const rel = rise.map(v => v - baseline);
    let ip = 0; rel.forEach((v, i) => { if (v > rel[ip]) ip = i; });
    const WINDOW = 1.5, windowS = Math.min(t[t.length - 1], WINDOW * t[ip]), n = t.filter(x => x <= windowS + 1e-9).length;
    const fit = engine.fitILS(t.slice(0, n), rel.slice(0, n), qPrime, c.spacingMm / 1000, c.pulseS, {lambda: 1, C: 2e6});
    return {lambda: fit.lambda, C: fit.C, alpha: fit.alpha, rmseC: fit.rmse, qPrimeWm: qPrime, samples: n, peakS: t[ip], windowS,
      peakCaptured: ip < t.length - 1, fullWindow: WINDOW * t[ip] <= t[t.length - 1] + 1e-9,
      lambdaErrPct: 100 * (fit.lambda / c.soilLambda - 1), CErrPct: 100 * (fit.C / c.soilC - 1)};
  }

  function simulate(input, thermalEngine) {
    const c = checked(input), e = electrical(c), stages = stagesFor(c);
    const run = {config: c, electrical: e, stages, totalS: stages[4].endS,
      warnings: warningsFor(c, e, validate(c)), series: [], firmwareExists: false,
      assumptions: ['PWM is modeled as weighted ON/OFF states at 100 Hz, with no switching-transient or electrical ripple model. Cable length is one-way and resistance includes both conductors.',
        'Logic load, buck efficiency, copper resistance and diode drops are adjustable assumptions, not board measurements. Heater resistance has no temperature-coefficient feedback in this model.',
        'U3 is an LMR36503 synchronous buck with a fixed 5.0 V output at an assumed ' + Math.round(c.buckEfficiency * 100) + '% efficiency (about ' +
          (BUCK_OUT_V * c.logicMa * (1 / c.buckEfficiency - 1)).toFixed(0) + ' mW loss at ' + c.logicMa + ' mA), so the electronics draw constant input power; it regulates down to about ' + BUCK_MIN_VIN_P_V +
          ' V at VIN_P. D7 drops 0.25 V to a 4.75 V logic rail. Heating outside ' + c.minBatteryV + '-' + c.maxBatteryV + ' V at the battery is refused by the proposed software policy, not by the regulator.',
        'AR_EXTERNAL with VREF from pin D4 through R11 (1.5 kΩ) into C13 (1 µF), powered only while sampling; thermistors return directly to GND. VREF is about 3.5 V at 25 °C with a 150 µA reference-load assumption, and readings stay ratiometric because the dividers and AREF share VREF. Ideal NTC beta = 3380 K; deterministic quantization.',
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
      run.series.push({t, tempTH1: temps[0], tempTip: temps[1], tempTH3: temps[2], tempBody: temps[3],
        tempHeatedZoneSoil: temperatureAtPosition(run, t, 1.385, 29.8),
        heaterPowerW: on ? e.heaterPowerW : 0, energyJ: heatElapsed(run, t) * e.heaterPowerW, stage: stage.id});
    }
    run.deliveredHeaterEnergyJ = heatElapsed(run, run.totalS) * e.heaterPowerW;
    run.measuredInaEnergyJ = heatElapsed(run, run.totalS) * e.inaPowerW;
    return run;
  }

  const api = {defaultConfig, validate, electrical, simulate, soilEstimate, stateAt, instantaneousPower, sampleReadings, ratingAt, temperatureAtPosition,
    resistanceAt, temperatureAt, FAULTS, get HEATER_COUNT() { return defaultConfig().heaterCount; }, AWG_OHM_PER_M: AWG,
    ADC_CHANNEL, SUPPLY};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SensorModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
