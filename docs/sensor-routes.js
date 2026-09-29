/* Select real exported copper for activity overlays; never create connecting
 * chords, cross components, or fill ground zones. Browser: SensorRoutes.buildRoute.
 * direction is a display hint away from explicit source pads, not measured
 * current or a propagation model: +1 follows a->b, -1 reverses, 0 is unresolved.
 * Same-net copper on one layer connects at shared endpoints, at T-junctions and
 * inside a shared pad; vias connect the layers where they have an annulus.
 * Geometry always retains the original orientation and original track index.
 */
(function (root) {
  'use strict';
  // Exported coordinates are rounded to 0.0001 mm; 0.001 mm absorbs that
  // rounding on diagonal segments without joining copper that is visibly apart.
  const JOIN_TOLERANCE_MM = 1e-3;

  // Points (other endpoints or vias) lying on a segment, other than its own
  // endpoints, ordered from a to b.
  function pointsAlong(segment, points) {
    const [ax, ay] = segment.a, dx = segment.b[0] - ax, dy = segment.b[1] - ay;
    const length2 = dx * dx + dy * dy, same = (p, q) => p[0] === q[0] && p[1] === q[1], found = [];
    for (const point of points) {
      if (same(point, segment.a) || same(point, segment.b)) continue;
      const t = length2 ? Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / length2)) : 0;
      if (Math.hypot(ax + t * dx - point[0], ay + t * dy - point[1]) <= JOIN_TOLERANCE_MM) found.push({point, t});
    }
    return found.sort((p, q) => p.t - q.t).map(item => item.point);
  }

  function buildRoute(board, options) {
    if (!board || !Array.isArray(board.tracks)) throw new TypeError('board.tracks must be an array.');
    const settings = options || {};
    if (!Array.isArray(settings.nets) || settings.nets.some(net => typeof net !== 'string'))
      throw new TypeError('nets must be an explicit array of net names.');
    if (settings.sourcePads !== undefined && !Array.isArray(settings.sourcePads))
      throw new TypeError('sourcePads must be an array of {ref, pin} objects.');
    const nets = new Set(settings.nets);
    const segments = [];
    board.tracks.forEach((track, index) => {
      if (nets.has(track.net)) segments.push({...track, a: track.a.slice(), b: track.b.slice(), index, direction: 0});
    });
    if (!segments.length || !settings.sourcePads || !settings.sourcePads.length) return segments;

    // Copper on the same net and layer joins at equal exported endpoints and
    // wherever an endpoint or via lands part-way along another segment (a
    // T-junction, within JOIN_TOLERANCE_MM of the centerline); such a segment is
    // split there for the graph only, never in the returned geometry. A via
    // joins the exported copper layers on which its annulus is present.
    // Coincident traces on different layers do not join, nor do different nets
    // at the same coordinate.
    const graph = new Map();
    const id = (net, layer, xy) => JSON.stringify([net, layer, xy[0], xy[1]]);
    function vertex(net, layer, xy) {
      const key = id(net, layer, xy);
      if (!graph.has(key)) graph.set(key, {net, layer, xy, adjacent: new Set()});
      return key;
    }
    function connect(a, b) { if (a !== b) { graph.get(a).adjacent.add(b); graph.get(b).adjacent.add(a); } }
    const viaLayers = segment => segment.layers || ['top', 'bottom'];
    const junctions = new Map();
    function junction(net, layer, xy) {
      const key = JSON.stringify([net, layer]);
      if (!junctions.has(key)) junctions.set(key, new Map());
      junctions.get(key).set(JSON.stringify(xy), xy);
    }
    for (const segment of segments) {
      if (segment.via) viaLayers(segment).forEach(layer => junction(segment.net, layer, segment.a));
      else { junction(segment.net, segment.layer, segment.a); junction(segment.net, segment.layer, segment.b); }
    }
    for (const segment of segments) {
      if (segment.via) {
        const layers = viaLayers(segment);
        for (let i = 1; i < layers.length; i++)
          connect(vertex(segment.net, layers[0], segment.a), vertex(segment.net, layers[i], segment.a));
        continue;
      }
      const points = junctions.get(JSON.stringify([segment.net, segment.layer]));
      const chain = [segment.a, ...pointsAlong(segment, points ? points.values() : []), segment.b];
      for (let i = 1; i < chain.length; i++)
        connect(vertex(segment.net, segment.layer, chain[i - 1]), vertex(segment.net, segment.layer, chain[i]));
    }

    // This flat-board export has top-side SMD parts. Drilled pads span both
    // layers; use explicit layers if a future export supplies them. Pad sizes
    // are axis-aligned bounding boxes in the same coordinates as the tracks.
    const footprints = board.footprints || [];
    const padLayers = (footprint, pad) => Array.isArray(pad.layers) ? pad.layers
      : pad.drill && pad.drill.some(value => value > 0) ? ['top', 'bottom'] : [footprint.layer === 'bottom' ? 'bottom' : 'top'];
    function padMembers(footprint, pad) {
      const layers = padLayers(footprint, pad), size = pad.size || [0, 0], members = [];
      for (const [key, node] of graph) {
        if (node.net === pad.net && layers.includes(node.layer) &&
            Math.abs(node.xy[0] - pad.xy[0]) <= size[0] / 2 + 1e-8 &&
            Math.abs(node.xy[1] - pad.xy[1]) <= size[1] / 2 + 1e-8) members.push(key);
      }
      return members;
    }
    // A pad is one piece of copper: segment ends that land anywhere inside the
    // same pad (on its copper layers and net) join through it.
    for (const footprint of footprints) for (const pad of footprint.pads || []) {
      if (!nets.has(pad.net)) continue;
      const members = padMembers(footprint, pad);
      if (members.length < 2) continue;
      const hub = JSON.stringify(['pad', footprint.ref, pad.pin]);
      graph.set(hub, {net: pad.net, layer: null, xy: pad.xy, adjacent: new Set()});
      members.forEach(key => connect(hub, key));
    }

    const distance = new Map(), queue = [];
    for (const source of settings.sourcePads) {
      if (!source || typeof source.ref !== 'string' || source.pin === undefined)
        throw new TypeError('Each source pad needs ref and pin.');
      const footprint = footprints.find(part => part.ref === source.ref);
      const pad = footprint && footprint.pads.find(item => item.pin === String(source.pin));
      if (!pad) throw new RangeError('Unknown source pad: ' + source.ref + '.' + source.pin);
      if (!nets.has(pad.net)) continue;
      for (const key of padMembers(footprint, pad)) if (!distance.has(key)) { distance.set(key, 0); queue.push(key); }
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const key = queue[cursor];
      for (const neighbor of graph.get(key).adjacent) if (!distance.has(neighbor)) {
        distance.set(neighbor, distance.get(key) + 1); queue.push(neighbor);
      }
    }
    for (const segment of segments) {
      if (segment.via) continue;
      const a = distance.get(id(segment.net, segment.layer, segment.a));
      const b = distance.get(id(segment.net, segment.layer, segment.b));
      if (a !== undefined && b !== undefined && a !== b) segment.direction = a < b ? 1 : -1;
    }
    return segments;
  }

  const api = {buildRoute};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SensorRoutes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
