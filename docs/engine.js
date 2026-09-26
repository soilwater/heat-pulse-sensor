/* Heat-pulse PCB sensor digital twin - simulation engine.
   Pure functions, no DOM. Works in the browser (global HPTwin) and in Node (require).
   Units: SI inside the physics (m, s, W, K); config uses mm / mA where that is what you read off a board. */
(function (root) {
  'use strict';

  // ---------- special functions ----------
  function erfc(x) { // Numerical Recipes erfcc, |err| < 1.2e-7
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
      t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  function E1(x) { // exponential integral E1(x) = -Ei(-x), x > 0
    if (x <= 0) return Infinity;
    if (x > 700) return 0;
    if (x < 1) {
      let sum = 0, term = 1;
      for (let k = 1; k < 60; k++) { term *= -x / k; sum -= term / k; if (Math.abs(term / k) < 1e-16) break; }
      return -0.5772156649015329 - Math.log(x) + sum;
    }
    let b = x + 1, c = 1e300, d = 1 / b, h = d; // modified Lentz continued fraction
    for (let i = 1; i < 200; i++) {
      const an = -i * i; b += 2; d = 1 / (an * d + b); c = b + an / c;
      const del = c * d; h *= del; if (Math.abs(del - 1) < 1e-14) break;
    }
    return h * Math.exp(-x);
  }
  function rng(seed) { // mulberry32 -> gaussian
    let a = seed >>> 0;
    const u = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  }

  // ---------- part libraries (edit / extend freely) ----------
  const PACKAGES = { // chip resistor: body length, width (mm), rated power at 70 C (W)
    '0201': { len: 0.6, wid: 0.3, watts: 0.05 }, '0402': { len: 1.0, wid: 0.5, watts: 0.063 },
    '0603': { len: 1.6, wid: 0.8, watts: 0.10 }, '0805': { len: 2.0, wid: 1.25, watts: 0.125 },
    '1206': { len: 3.2, wid: 1.6, watts: 0.25 }
  };
  const AWG_OHM_PER_M = { 18: 0.0210, 20: 0.0333, 22: 0.0530, 24: 0.0842, 26: 0.1339 };
  const ADCS = {
    atmega10: { label: 'ATmega328P internal ADC (10-bit)', bits: 10, bipolar: false, noiseLsb: 0.5, channels: 8 },
    avr12os: { label: 'Modern AVR built-in ADC (12-bit, 1024x oversampled = 17-bit) - noise UNPROVEN', bits: 17, bipolar: false, noiseLsb: 1.5, channels: 8 },
    ra14: { label: 'RA4M1 built-in ADC (14-bit, ratiometric via AREF)', bits: 14, bipolar: false, noiseLsb: 1.0, channels: 4 },
    ads1220: { label: 'ADS1220 (24-bit delta-sigma, ratiometric)', bits: 24, bipolar: true, channels: 4,
      // approx. input-referred rms noise (uV), gain 1, normal mode - check datasheet table before relying on it
      noiseUv: { 20: 3.7, 45: 5.5, 90: 7.6, 175: 10.6, 330: 15, 600: 22, 1000: 30 } }
  };
  // Assumed Nano-footprint pin usage per module (no schematic available - edit to match the real board)
  const PIN_MAP = {
    sdi12: { label: 'SDI-12 data', pins: ['D2'] },
    heaterSwitch: { label: 'Heater MOSFET gate (PWM)', pins: ['D9'] },
    ads1220: { label: 'ADS1220 (SPI + DRDY)', pins: ['D10', 'D11', 'D12', 'D13', 'D3'] },
    currentSense: { label: 'INA226 V/I monitor (I2C)', pins: ['A4', 'A5'] },
    usb: { label: 'USB-serial', pins: ['D0', 'D1'] },
    led: { label: 'Status LED', pins: ['D8'] }
  };
  const ANALOG_PINS = ['A0', 'A1', 'A2', 'A3', 'A6', 'A7', 'A4', 'A5'];

  // ---------- default configuration = Rev 1 board as inferred from photos + Feb-2026 test data ----------
  function defaultConfig() {
    return {
      name: 'Rev 1 as-built (inferred)',
      geometry: { bodyW: 18, bodyL: 45, heaterProngL: 37, sideProngL: 20, prongW: 1.3, boardT: 1.6,
        spacingL: 7.3, spacingR: 7.3, spacingTol: 0.2 },
      heater: { enabled: true, nPerSide: 18, sides: 2, sideConn: 'parallel', rEach: 1.62, tolPct: 1, pkg: '0603',
        pitch: 2.0, z0: 1.0, efficiency: 1.0, faults: {} /* key "side:index" -> 'open' | 'short' */ },
      drive: { duty: 0.4, pulseS: 8, rdsOn: 0.05, watchdog: false, gatePulldown: false },
      supply: { volts: 12.1, limitA: 1.0, cableM: 2, awg: 22, extraOhm: 0.1, logicMa: 25, cyclesPerDay: 24 },
      currentSense: { enabled: true, shuntOhm: 0.05, fullScaleMv: 81.92, syncToPwm: false },
      thermistors: [
        { name: 'T1 (left)', prong: 'left', z: 18.8, enabled: true },
        { name: 'T3 (right)', prong: 'right', z: 18.8, enabled: true },
        { name: 'TH (heater tip)', prong: 'heater', z: 36.6, enabled: true }
      ],
      thermistorPart: { r25: 10000, beta: 3950, dissMwPerK: 2.0, heaterREffMm: 1.0 },
      readout: { adc: 'atmega10', rSeries: 10000, vExc: 5.0, sps: 20, averages: 1, switchedExc: false,
        sampleS: 1.0, preSamples: 12, totalS: 100, fitS: 100 },
      modules: { sdi12: true, usb: true, ads1220: true, led: true, regulator: true, tvs: false, reversePol: true },
      soil: { mode: 'model', bulkDensity: 1.6, theta: 0.10, sandFrac: 0.9, lambda: 1.5, C: 2.0e6, ambientC: 22 },
      seed: 7
    };
  }

  // ---------- soil ----------
  function soilProps(s) {
    if (s.mode === 'manual') return { lambda: s.lambda, C: s.C, alpha: s.lambda / s.C };
    const n = 1 - s.bulkDensity / 2.65, Sr = Math.min(1, Math.max(0, s.theta / n));
    const C = s.bulkDensity * 1000 * 730 + 4.18e6 * s.theta;          // de Vries, mineral soil
    const q = s.sandFrac, lo = q > 0.2 ? 2.0 : 3.0;                    // Lu et al. (2007)
    const ls = Math.pow(7.7, q) * Math.pow(lo, 1 - q);
    const lsat = Math.pow(ls, 1 - n) * Math.pow(0.594, n), ldry = -0.56 * n + 0.51;
    const a = s.sandFrac > 0.4 ? 0.96 : 0.27;
    const Ke = Sr > 0 ? Math.exp(a * (1 - Math.pow(Sr, a - 1.33))) : 0;
    const lambda = (lsat - ldry) * Ke + ldry;
    return { lambda, C, alpha: lambda / C, porosity: n, Sr };
  }

  // ---------- heater electrical network ----------
  function heaterNetwork(cfg) {
    const h = cfg.heater, pkg = PACKAGES[h.pkg], sides = [];
    for (let s = 0; s < h.sides; s++) {
      let R = 0, open = false; const el = [];
      for (let i = 0; i < h.nPerSide; i++) {
        const f = h.faults[s + ':' + i]; const r = f === 'short' ? 0 : h.rEach;
        if (f === 'open') open = true; R += r; el.push({ i, z: h.z0 + pkg.len / 2 + i * h.pitch, r, fault: f || null });
      }
      sides.push({ R, open, el });
    }
    let Rtot;
    if (!h.enabled || !sides.length) Rtot = Infinity;
    else if (h.sideConn === 'series') Rtot = sides.some(s => s.open) ? Infinity : sides.reduce((a, s) => a + s.R, 0);
    else { const g = sides.reduce((a, s) => a + (s.open || s.R === 0 ? 0 : 1 / s.R), 0); Rtot = g > 0 ? 1 / g : Infinity; }

    const sup = cfg.supply, cs = cfg.currentSense;
    const rCable = 2 * sup.cableM * (AWG_OHM_PER_M[sup.awg] || 0.053) + sup.extraOhm;
    const rPath = rCable + cfg.drive.rdsOn + (cs.enabled ? cs.shuntOhm : 0);
    const iOn = isFinite(Rtot) ? sup.volts / (Rtot + rPath) : 0;
    const vHeater = iOn * (isFinite(Rtot) ? Rtot : 0), vBoard = sup.volts - iOn * rCable;
    const duty = cfg.drive.duty;
    // per-resistor dissipation (W, averaged over the PWM period)
    const sources = []; let worst = 0;
    sides.forEach((s, si) => {
      const iSide = !isFinite(Rtot) || s.open ? 0 : (h.sideConn === 'series' ? iOn : vHeater / s.R);
      s.iOn = iSide;
      s.el.forEach(e => { e.pOn = iSide * iSide * e.r; e.pAvg = e.pOn * duty; worst = Math.max(worst, e.pAvg); sources.push({ z: e.z / 1000, p: e.pAvg, side: si, i: e.i }); });
    });
    const pAvg = sources.reduce((a, s) => a + s.p, 0);
    const heatedLen = ((h.nPerSide - 1) * h.pitch + pkg.len) / 1000;
    return { sides, Rtot, rCable, rPath, iOn, vHeater, vBoard, pOn: vHeater * iOn, pAvg, heatedLen,
      qPrime: pAvg / heatedLen, qPulse: pAvg / heatedLen * cfg.drive.pulseS, worstResW: worst, pkg, sources,
      zMid: h.z0 + ((h.nPerSide - 1) * h.pitch + pkg.len) / 2, zEnd: h.z0 + (h.nPerSide - 1) * h.pitch + pkg.len };
  }

  // ---------- heat flow ----------
  // Sum of pulsed point sources in an infinite homogeneous medium (probe body itself is neglected).
  function mergeSources(sources) { const m = new Map(); sources.forEach(s => m.set(s.z, (m.get(s.z) || 0) + s.p)); return [...m].map(([z, p]) => ({ z, p })).filter(s => s.p > 0); }
  function dTpoint(src, r, z, t, t0, soil) {
    if (t <= 0) return 0; let sum = 0; const k = 4 * Math.PI * soil.lambda, a = soil.alpha;
    for (const s of src) {
      const d = Math.hypot(r, z - s.z); let v = erfc(d / (2 * Math.sqrt(a * t)));
      if (t > t0) v -= erfc(d / (2 * Math.sqrt(a * (t - t0))));
      sum += s.p * v / (k * d);
    }
    return sum;
  }
  function dTils(qPrime, r, t, t0, lambda, C) { // infinite line source, pulsed
    if (t <= 0) return 0; const a = lambda / C, x = r * r / (4 * a);
    let v = E1(x / t); if (t > t0) v -= E1(x / (t - t0));
    return qPrime / (4 * Math.PI * lambda) * v;
  }

  // ---------- thermistor + ADC chain ----------
  const K0 = 273.15;
  function rTherm(Tc, p) { return p.r25 * Math.exp(p.beta * (1 / (Tc + K0) - 1 / 298.15)); }
  function tFromR(R, p) { return 1 / (Math.log(R / p.r25) / p.beta + 1 / 298.15) - K0; }
  function readoutSpec(cfg) {
    const ro = cfg.readout, p = cfg.thermistorPart, adc = ADCS[ro.adc], T = cfg.soil.ambientC;
    const Rt = rTherm(T, p), v = ro.vExc * Rt / (Rt + ro.rSeries);
    const dRdT = -p.beta * Rt / Math.pow(T + K0, 2);
    const sens = Math.abs(ro.vExc * ro.rSeries * dRdT / Math.pow(Rt + ro.rSeries, 2));   // V/K
    const lsbV = adc.bipolar ? 2 * ro.vExc / Math.pow(2, adc.bits) : ro.vExc / Math.pow(2, adc.bits); // ratiometric: ref = excitation
    let noiseV;
    if (adc.noiseUv) { const ks = Object.keys(adc.noiseUv).map(Number); const k = ks.reduce((a, b) => Math.abs(b - ro.sps) < Math.abs(a - ro.sps) ? b : a); noiseV = adc.noiseUv[k] * 1e-6; }
    else noiseV = adc.noiseLsb * lsbV;
    const selfHeat = (v * v / Rt) * 1000 / p.dissMwPerK * (ro.switchedExc ? 0.05 : 1);
    return { adc, Rt, v, sens, lsbV, noiseV, lsbC: lsbV / sens,
      rmsC: Math.sqrt(noiseV * noiseV + lsbV * lsbV / 12) / Math.sqrt(ro.averages) / sens, selfHeatC: selfHeat };
  }
  function measure(Tc, cfg, spec, gauss) { // what the firmware would report for a true temperature Tc
    const ro = cfg.readout, p = cfg.thermistorPart; let acc = 0;
    for (let k = 0; k < ro.averages; k++) {
      const Rt = rTherm(Tc, p); let v = ro.vExc * Rt / (Rt + ro.rSeries) + spec.noiseV * gauss();
      v = Math.round(v / spec.lsbV) * spec.lsbV; acc += v;
    }
    const v = Math.min(ro.vExc * 0.999999, Math.max(1e-9, acc / ro.averages));
    return tFromR(ro.rSeries * v / (ro.vExc - v), p);
  }

  // ---------- inversion (what your analysis code would conclude from the sensor output) ----------
  function singlePoint(t, dT, qPrime, r, t0) {
    let im = 0; for (let i = 1; i < dT.length; i++) if (dT[i] > dT[im]) im = i;
    const tm = t[im], dTm = dT[im]; if (!(tm > t0) || !(dTm > 0)) return null;
    const alpha = r * r / 4 * (1 / (tm - t0) - 1 / tm) / Math.log(tm / (tm - t0));
    const C = qPrime / (4 * Math.PI * alpha * dTm) * (E1(r * r / (4 * alpha * tm)) - E1(r * r / (4 * alpha * (tm - t0))));
    return { tm, dTm, alpha, C, lambda: alpha * C };
  }
  function fitILS(t, dT, qPrime, r, t0, guess) { // Levenberg-Marquardt on ln(lambda), ln(C)
    let p = [Math.log(guess.lambda), Math.log(guess.C)], mu = 1e-2;
    const res = q => t.map((ti, i) => dTils(qPrime, r, ti, t0, Math.exp(q[0]), Math.exp(q[1])) - dT[i]);
    const sse = e => e.reduce((a, b) => a + b * b, 0);
    let e = res(p), s = sse(e);
    for (let it = 0; it < 60; it++) {
      const J = [0, 1].map(j => { const q = p.slice(); q[j] += 1e-5; const e2 = res(q); return e2.map((v, i) => (v - e[i]) / 1e-5); });
      const a = sse(J[0]), b = J[0].reduce((x, v, i) => x + v * J[1][i], 0), d = sse(J[1]);
      const g0 = J[0].reduce((x, v, i) => x + v * e[i], 0), g1 = J[1].reduce((x, v, i) => x + v * e[i], 0);
      const A = a * (1 + mu), D = d * (1 + mu), det = A * D - b * b; if (!isFinite(det) || det === 0) break;
      const step = [-(D * g0 - b * g1) / det, -(A * g1 - b * g0) / det];
      const pn = [p[0] + step[0], p[1] + step[1]], en = res(pn), sn = sse(en);
      if (isFinite(sn) && sn < s) { const done = Math.abs(s - sn) < 1e-14 * (1 + s); p = pn; e = en; s = sn; mu = Math.max(mu / 3, 1e-9); if (done) break; }
      else { mu *= 4; if (mu > 1e8) break; }
    }
    const lambda = Math.exp(p[0]), C = Math.exp(p[1]);
    return { lambda, C, alpha: lambda / C, rmse: Math.sqrt(s / t.length) };
  }

  // ---------- full simulation ----------
  function simulate(cfg) {
    const soil = soilProps(cfg.soil), net = heaterNetwork(cfg), spec = readoutSpec(cfg), g = cfg.geometry;
    const eff = cfg.heater.efficiency == null ? 1 : cfg.heater.efficiency;
    const ro = cfg.readout, t0 = cfg.drive.pulseS, src = mergeSources(net.sources).map(s => ({ z: s.z, p: s.p * eff })), gauss = rng(cfg.seed);
    const tFine = []; for (let t = 0; t <= ro.totalS + 1e-9; t += 0.25) tFine.push(t);
    const tSamp = []; for (let t = ro.sampleS; t <= ro.totalS + 1e-9; t += ro.sampleS) tSamp.push(+t.toFixed(6));

    const therm = cfg.thermistors.map((th, idx) => {
      const onHeater = th.prong === 'heater';
      const rmm = onHeater ? cfg.thermistorPart.heaterREffMm : (th.prong === 'left' ? g.spacingL : g.spacingR);
      const r = rmm / 1000, z = th.z / 1000, out = { idx, name: th.name, prong: th.prong, enabled: th.enabled, rmm, z: th.z, onHeater };
      if (!th.enabled) return out;
      out.trueCurve = tFine.map(t => dTpoint(src, r, z, t, t0, soil));
      out.ilsCurve = onHeater ? null : tFine.map(t => dTils(net.qPrime, r, t, t0, soil.lambda, soil.C));
      const amb = cfg.soil.ambientC + spec.selfHeatC;
      let base = 0; for (let k = 0; k < ro.preSamples; k++) base += measure(amb, cfg, spec, gauss); base /= Math.max(1, ro.preSamples);
      if (!ro.preSamples) base = amb;
      out.measured = tSamp.map(t => measure(amb + dTpoint(src, r, z, t, t0, soil), cfg, spec, gauss) - base);
      out.dTmax = Math.max(...out.trueCurve); out.tmax = tFine[out.trueCurve.indexOf(out.dTmax)];
      if (!onHeater && net.qPrime > 0) {
        // the analysis assumes the NOMINAL spacing and the q' the firmware believes
        const qBelieved = cfg.currentSense.enabled ? net.qPrime : nominalQ(cfg, net);
        out.qBelieved = qBelieved;
        const nFit = Math.max(5, tSamp.filter(t => t <= (ro.fitS || ro.totalS)).length), nFine = Math.max(5, tFine.filter(t => t <= (ro.fitS || ro.totalS)).length);
        out.fit = fitILS(tSamp.slice(0, nFit), out.measured.slice(0, nFit), qBelieved, r, t0, { lambda: 1, C: 2e6 });
        out.sp = singlePoint(tSamp, out.measured, qBelieved, r, t0);
        out.fitIdeal = fitILS(tFine.slice(1, nFine), out.trueCurve.slice(1, nFine), net.qPrime, r, t0, { lambda: 1, C: 2e6 }); // geometry-only error
        const pe = (a, b) => (a / b - 1) * 100;
        out.err = { lambda: pe(out.fit.lambda, soil.lambda), C: pe(out.fit.C, soil.C),
          lambdaGeom: pe(out.fitIdeal.lambda, soil.lambda), CGeom: pe(out.fitIdeal.C, soil.C),
          spC: out.sp ? pe(out.sp.C, soil.C) : NaN, spLambda: out.sp ? pe(out.sp.lambda, soil.lambda) : NaN };
        out.thetaEst = (out.fit.C - cfg.soil.bulkDensity * 1000 * 730) / 4.18e6;
      }
      return out;
    });

    // axial profile of peak temperature rise at the (mean) sensing radius
    const rProf = (g.spacingL + g.spacingR) / 2000, prof = [];
    for (let zmm = 0; zmm <= g.heaterProngL + 4; zmm += 1) {
      let m = 0; for (let t = 2; t <= ro.totalS; t += 2) m = Math.max(m, dTpoint(src, rProf, zmm / 1000, t, t0, soil));
      prof.push({ z: zmm, dT: m });
    }
    const sup = cfg.supply;
    const energy = { pulseJ: sup.volts * net.iOn * cfg.drive.duty * t0,
      mAhDay: (net.iOn * cfg.drive.duty * t0 * sup.cyclesPerDay / 3600 + sup.logicMa / 1000 * 24) * 1000 };
    const res = { cfg, soil, net, spec, therm, tFine, tSamp, prof, energy, pins: pinBudget(cfg) };
    res.checks = runChecks(res);
    return res;
  }
  function nominalQ(cfg, net) { // firmware without V/I sensing assumes nominal supply and nominal resistors
    const h = cfg.heater, Rside = h.nPerSide * h.rEach;
    const R = h.sideConn === 'series' ? Rside * h.sides : Rside / h.sides;
    return cfg.supply.volts * cfg.supply.volts / R * cfg.drive.duty / net.heatedLen;
  }

  function pinBudget(cfg) {
    const use = {}, claim = (pin, who) => { (use[pin] = use[pin] || []).push(who); };
    const on = { sdi12: cfg.modules.sdi12, heaterSwitch: cfg.heater.enabled, ads1220: cfg.modules.ads1220,
      currentSense: cfg.currentSense.enabled, usb: cfg.modules.usb, led: cfg.modules.led };
    Object.keys(PIN_MAP).forEach(k => { if (on[k]) PIN_MAP[k].pins.forEach(p => claim(p, PIN_MAP[k].label)); });
    const nTh = cfg.thermistors.filter(t => t.enabled).length; let unplaced = 0;
    if (cfg.readout.adc === 'atmega10') {
      const free = ANALOG_PINS.filter(p => !use[p]);
      cfg.thermistors.filter(t => t.enabled).forEach((t, i) => { if (free[i]) claim(free[i], 'Thermistor ' + t.name); else unplaced++; });
    }
    const conflicts = Object.keys(use).filter(p => use[p].length > 1).map(p => ({ pin: p, users: use[p] }));
    return { use, conflicts, unplaced, nTh };
  }

  // ---------- automatic design-rule checks ----------
  function runChecks(R) {
    const c = R.cfg, n = R.net, eff = c.heater.efficiency == null ? 1 : c.heater.efficiency, out = [], f = (x, d) => (+x).toFixed(d === undefined ? 2 : d);
    const add = (module, level, title, detail) => out.push({ module, level, title, detail });
    const sens = R.therm.filter(t => t.enabled && !t.onHeater);

    // heater
    if (!c.heater.enabled) add('Heater', 'fail', 'Heater disabled', 'No heat pulse - nothing to measure.');
    else if (!isFinite(n.Rtot) || n.iOn === 0) add('Heater', 'fail', 'Heater circuit is open', 'An open resistor breaks a series chain. With sides in series a single bad joint kills the whole heater.');
    else {
      const pct = n.worstResW / n.pkg.watts * 100;
      add('Heater', pct > 100 ? 'fail' : pct > 60 ? 'warn' : 'pass', 'Resistor power: ' + f(pct, 0) + '% of ' + c.heater.pkg + ' rating',
        f(n.worstResW * 1000, 0) + ' mW per resistor averaged over the pulse vs ' + f(n.pkg.watts * 1000, 0) + ' mW rated. At 100% duty it would be ' + f(pct / c.drive.duty, 0) + '%.');
      add('Heater', n.qPrime < 30 || n.qPrime > 200 ? 'warn' : 'pass', "Heat input q' = " + f(n.qPrime, 0) + ' W/m (' + f(n.qPulse, 0) + ' J/m)',
        'R = ' + f(n.Rtot) + ' ohm, I(on) = ' + f(n.iOn * 1000, 0) + ' mA, heater voltage = ' + f(n.vHeater) + ' V, mean power = ' + f(n.pAvg) + ' W over ' + f(n.heatedLen * 1000, 1) + ' mm. Typical heat-pulse probes use 40-150 W/m.');
      const faults = Object.keys(c.heater.faults).length;
      if (eff !== 1) add('Heater', 'info', 'Calibration: ' + f(eff * 100, 0) + '% of electrical heat treated as reaching the soil', 'Empirical factor fitted to lab data. The analysis still uses the electrical q\x27, so the recovered C is biased by the same factor unless you calibrate.');
      if (faults) add('Heater', 'warn', faults + ' resistor fault(s) injected', 'Axial heating is no longer uniform - see the axial profile chart.');
      if (n.zEnd > c.geometry.heaterProngL) add('Heater', 'fail', 'Resistor chain longer than the prong', 'Chain ends at ' + f(n.zEnd, 1) + ' mm but the heater prong is ' + c.geometry.heaterProngL + ' mm.');
      if (c.heater.pitch < n.pkg.len + 0.2) add('Heater', 'fail', 'Resistor pitch too tight', c.heater.pkg + ' body is ' + n.pkg.len + ' mm; pitch ' + c.heater.pitch + ' mm leaves < 0.2 mm between pads.');
      if (n.pkg.wid + 0.4 > c.geometry.prongW) add('Heater', 'warn', 'Package nearly as wide as the prong', c.heater.pkg + ' is ' + n.pkg.wid + ' mm wide on a ' + c.geometry.prongW + ' mm prong - no room for the return trace.');
      const th = R.therm.find(t => t.enabled && t.onHeater);
      if (th) add('Heater', th.dTmax > 30 ? 'warn' : 'info', 'Heater-prong temperature rise ~' + f(th.dTmax, 0) + ' C (rough)',
        'Rough estimate (soil-only model at an effective radius; FR4 and coating ignored). Large rises drive water away from the heater in unsaturated soil.');
    }
    // drive
    if (c.heater.enabled) {
      add('Drive', c.drive.gatePulldown ? 'pass' : 'warn', 'MOSFET gate pull-down ' + (c.drive.gatePulldown ? 'present' : 'not confirmed'),
        'While the MCU is in reset/bootloader the gate floats. Without a pull-down the heater can sit ON at ' + f(n.pOn, 1) + ' W continuously.');
      add('Drive', c.drive.watchdog ? 'pass' : 'warn', 'Firmware heater time-out ' + (c.drive.watchdog ? 'present' : 'not confirmed'),
        'The logger turns the heater off with a second SDI-12 command. If that command is lost the heater stays on. Firmware should enforce a maximum on-time.');
      if (c.drive.duty < 1 && c.currentSense.enabled && !c.currentSense.syncToPwm)
        add('Drive', 'warn', 'Current is sampled while the heater is PWM-chopped', 'Feb-2026 data show 750-880 mA scatter (+/-7%) in the reported current, which goes straight into q\' and therefore into C. Either run the heater at DC (raise R, duty = 1) or average V x I over whole PWM periods.');
    }
    // supply
    add('Supply', n.iOn > c.supply.limitA ? 'fail' : n.iOn > 0.8 * c.supply.limitA ? 'warn' : 'pass', 'Peak supply current ' + f(n.iOn * 1000, 0) + ' mA (limit ' + f(c.supply.limitA * 1000, 0) + ' mA)',
      'Check the switched-12V / SDI-12 power limit of your logger. Several sensors pulsing together add up.');
    add('Supply', n.vBoard < 7 ? 'fail' : 'pass', 'Voltage at the board during the pulse: ' + f(n.vBoard) + ' V',
      'Cable loop + connector resistance ' + f(n.rCable) + ' ohm drops ' + f(n.iOn * n.rCable) + ' V. A 5 V regulator needs roughly 7 V in.');
    add('Supply', 'info', 'Energy: ' + f(R.energy.pulseJ, 1) + ' J per pulse, ' + f(R.energy.mAhDay, 0) + ' mAh/day', c.supply.cyclesPerDay + ' cycles/day plus ' + c.supply.logicMa + ' mA quiescent.');
    // current sense
    if (!c.currentSense.enabled) {
      const e = sens[0] ? (sens[0].qBelieved / n.qPrime - 1) * 100 : 0;
      add('V/I sense', 'fail', 'No heater voltage/current measurement', "Firmware must assume q'. With this cable and switch the assumed value is off by " + f(e, 1) + '% - the same error lands in C and water content.');
    } else {
      const mv = n.iOn * c.currentSense.shuntOhm * 1000;
      add('V/I sense', mv > c.currentSense.fullScaleMv ? 'fail' : mv > 0.85 * c.currentSense.fullScaleMv ? 'warn' : 'pass', 'Shunt signal ' + f(mv, 1) + ' mV of ' + c.currentSense.fullScaleMv + ' mV full scale',
        'Shunt ' + c.currentSense.shuntOhm + ' ohm. Shunt dissipation ' + f(n.iOn * n.iOn * c.currentSense.shuntOhm * 1000, 0) + ' mW while on.');
    }
    // readout
    const s = R.spec, nEn = c.thermistors.filter(t => t.enabled).length;
    if (sens.length) {
      const dT = Math.min(...sens.map(t => t.dTmax)), steps = dT / s.lsbC, snr = dT / s.rmsC;
      add('Readout', steps < 30 ? 'fail' : steps < 200 ? 'warn' : 'pass', 'Temperature resolution ' + (s.lsbC < 0.001 ? f(s.lsbC * 1000, 3) + ' mK' : f(s.lsbC, 3) + ' C') + ' per count -> ' + f(steps, 0) + ' counts on the peak',
        'Peak rise is ' + f(dT, 2) + ' C. ' + s.adc.label + ', ' + c.readout.rSeries + ' ohm series resistor. Aim for > 200 counts (better: > 1000) on the peak.');
      add('Readout', snr < 50 ? 'fail' : snr < 200 ? 'warn' : 'pass', 'Signal / noise = ' + f(snr, 0), 'Effective noise ' + f(s.rmsC * 1000, 2) + ' mK rms per reported value (' + c.readout.averages + ' averaged conversions).');
      const tm = Math.min(...sens.map(t => t.tmax));
      add('Readout', tm / c.readout.sampleS < 10 ? 'fail' : tm / c.readout.sampleS < 20 ? 'warn' : 'pass', 'Sampling: ' + f(tm / c.readout.sampleS, 0) + ' samples before the peak (t_max = ' + f(tm, 0) + ' s)',
        'One SDI-12 M! per ' + c.readout.sampleS + ' s. Wet, conductive soils peak early. Consider buffering a fast curve on-board and returning it afterwards.');
      if (c.drive.pulseS + c.readout.totalS < 3 * Math.max(...sens.map(t => t.tmax))) add('Readout', 'warn', 'Record may be too short', 'Record at least ~3 x t_max so the fit sees the cooling limb.');
    } else add('Readout', 'fail', 'No sensing thermistor enabled', 'Enable at least one thermistor on a side prong.');
    add('Readout', s.selfHeatC > 0.1 ? 'warn' : 'pass', 'Thermistor self-heating ' + f(s.selfHeatC, 3) + ' C',
      f(s.v * s.v / s.Rt * 1000, 2) + ' mW in the bead at ' + c.soil.ambientC + ' C. It shifts with soil wetness, so it is not a fixed offset. Lower the excitation, raise the resistances, or power the divider only while converting.');
    if (c.readout.adc === 'ads1220' && !c.modules.ads1220) add('Readout', 'fail', 'ADS1220 selected for readout but the module is switched off', 'Enable the ADS1220 module or choose the ATmega ADC.');
    if (c.readout.adc === 'atmega10' && c.modules.ads1220) add('Readout', 'warn', 'ADS1220 is on the board but not used for the thermistors', 'The 0.09 C steps in the Feb-2026 data match a 10-bit ADC on a 10k divider. Route the thermistors to the ADS1220.');
    const ch = ADCS[c.readout.adc].channels;
    add('Readout', nEn > ch ? 'fail' : 'pass', nEn + ' thermistor(s) on ' + ch + ' ADC input(s)', nEn > ch ? 'Add a multiplexer or a second ADC.' : 'Channel count is sufficient.');
    // geometry / method
    sens.forEach(t => {
      const off = t.z - n.zMid;
      add('Geometry', Math.abs(off) > 0.15 * n.heatedLen * 1000 ? 'warn' : 'pass', t.name + ': ' + f(Math.abs(off), 1) + ' mm from heater mid-length', 'Thermistor at z = ' + t.z + ' mm, heater center at ' + f(n.zMid, 1) + ' mm. Off-center sensors see more end-effect.');
      if (t.err) {
        const g = Math.max(Math.abs(t.err.CGeom), Math.abs(t.err.lambdaGeom)), m = Math.max(Math.abs(t.err.C), Math.abs(t.err.lambda));
        add('Geometry', g > 5 ? 'fail' : g > 2 ? 'warn' : 'pass', t.name + ': finite-heater error C ' + f(t.err.CGeom, 1) + '%, lambda ' + f(t.err.lambdaGeom, 1) + '%', 'Error from analyzing a short, discrete heater with the infinite-line-source model (no noise). The bias grows late in the record (axial heat loss), so a shorter fit window (about 2-3 x t_max) helps; so do a longer heater and closer spacing.');
        add('Result', m > 10 ? 'fail' : m > 3 ? 'warn' : 'pass', t.name + ': recovered C ' + f(t.err.C, 1) + '%, lambda ' + f(t.err.lambda, 1) + '% vs truth', 'Whole chain (geometry + ADC + noise + sampling). Curve fit gives C = ' + f(t.fit.C / 1e6, 3) + ' MJ/m3/K, lambda = ' + f(t.fit.lambda, 3) + ' W/m/K, water content ' + f(t.thetaEst, 3) + ' (true ' + f(c.soil.theta, 3) + ' in model mode).');
      }
    });
    const rMin = Math.min(c.geometry.spacingL, c.geometry.spacingR), eC = 200 * c.geometry.spacingTol / rMin;
    add('Geometry', eC > 5 ? 'warn' : 'pass', 'Spacing tolerance +/-' + c.geometry.spacingTol + ' mm -> +/-' + f(eC, 1) + '% in C', 'C scales with r squared. Thin FR4 prongs (' + c.geometry.prongW + ' x ' + c.geometry.boardT + ' mm) flex on insertion; calibrate apparent spacing in agar and consider a stiffer/wider prong.');
    if (c.geometry.spacingL !== c.geometry.spacingR) add('Geometry', 'info', 'Asymmetric spacing', 'Left ' + c.geometry.spacingL + ' mm, right ' + c.geometry.spacingR + ' mm.');
    // pins / system
    R.pins.conflicts.forEach(k => add('Pins', 'fail', 'Pin conflict on ' + k.pin, k.users.join('  +  ')));
    if (R.pins.unplaced) add('Pins', 'fail', R.pins.unplaced + ' thermistor(s) without an analog pin', 'All ATmega analog inputs are taken.');
    if (!R.pins.conflicts.length && !R.pins.unplaced) add('Pins', 'pass', 'No pin conflicts (assumed pin map)', 'Pin map is an assumption - edit PIN_MAP in engine.js to match the real schematic.');
    if (!c.modules.sdi12) add('System', 'fail', 'SDI-12 interface disabled', 'No way to talk to the logger.');
    if (!c.modules.regulator) add('System', 'fail', 'No 5 V regulator', '12 V supply would go straight to the logic.');
    if (!c.modules.tvs) add('System', 'warn', 'No TVS / series protection on the SDI-12 data and power lines', 'Buried cables pick up lightning and ESD transients.');
    if (!c.modules.reversePol) add('System', 'warn', 'No reverse-polarity protection', 'Field wiring mistakes happen.');
    return out;
  }

  // ---------- parse a Campbell TOA5 file from the TerraSense program (for overlaying lab data) ----------
  function parseTOA5(text) {
    const lines = text.trim().split(/\r?\n/), head = lines[1].replace(/"/g, '').split(',');
    const ix = k => head.indexOf(k), cycles = {};
    lines.slice(4).forEach(l => { const v = l.replace(/"/g, '').split(','); (cycles[v[ix('CycleNumber')]] = cycles[v[ix('CycleNumber')]] || []).push(v); });
    return Object.keys(cycles).map(k => {
      const rows = cycles[k], heat = rows.filter(v => +v[ix('Current')] > 100); if (!heat.length) return null;
      const s0 = +heat[0][ix('SampleNumber')] - 1, pre = rows.filter(v => +v[ix('SampleNumber')] <= s0 && +v[ix('SampleNumber')] > 0);
      const mean = (a, key) => a.reduce((x, v) => x + +v[ix(key)], 0) / Math.max(1, a.length), series = {};
      ['Temp1', 'Temp3', 'TempHeater'].forEach(key => { const b = mean(pre, key); series[key] = rows.filter(v => +v[ix('SampleNumber')] > s0).map(v => ({ t: +v[ix('SampleNumber')] - s0, dT: +v[ix(key)] - b })); });
      return { cycle: k, volts: mean(heat, 'Voltage'), mA: mean(heat, 'Current'), heatS: heat.length, duty: +heat[0][ix('HeaterState')], series };
    }).filter(Boolean);
  }

  const api = { defaultConfig, simulate, soilProps, heaterNetwork, readoutSpec, parseTOA5, dTils, dTpoint, fitILS, singlePoint, E1, erfc, PACKAGES, ADCS, PIN_MAP, AWG_OHM_PER_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HPTwin = api;
})(typeof self !== 'undefined' ? self : this);
