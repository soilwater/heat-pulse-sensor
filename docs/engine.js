/* Heat-pulse sensor digital twin - shared ideal-soil thermal calculations.
   Pure functions, no DOM. Works in the browser (global HPTwin) and in Node (require).
   Units: SI throughout (m, s, W, K, J/m3/K). */
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

  // ---------- soil ----------
  // Texture-based estimate of thermal properties (de Vries heat capacity, Lu et al. 2007 conductivity),
  // or the values given directly when mode is 'manual'.
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

  // ---------- heat flow ----------
  // Sum of pulsed point sources {z (m), p (W)} in an infinite homogeneous medium (probe body itself is neglected).
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

  // ---------- inversion (what the analysis code would conclude from the sensor output) ----------
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

  const api = { soilProps, dTils, dTpoint, fitILS, E1, erfc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HPTwin = api;
})(typeof self !== 'undefined' ? self : this);
