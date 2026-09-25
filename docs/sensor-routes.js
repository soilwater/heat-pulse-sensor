/* Select real exported copper for activity overlays; never create connecting
 * chords, cross components, or fill ground zones. Browser: SensorRoutes.buildRoute.
 * direction is a display hint away from explicit source pads, not measured
 * current or a propagation model: +1 follows a->b, -1 reverses, 0 is unresolved.
 * Geometry always retains the original orientation and original track index.
 */
(function (root) {
  'use strict';

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

    // Only equal exported endpoints on the same net and layer connect. A via
    // joins the exported copper layers on which its annulus is present. Coincident traces on different layers do
    // not join, nor do different nets at the same coordinate.
    const graph = new Map();
    const id = (net, layer, xy) => JSON.stringify([net, layer, xy[0], xy[1]]);
    function vertex(net, layer, xy) {
      const key = id(net, layer, xy);
      if (!graph.has(key)) graph.set(key, {net, layer, xy, adjacent: new Set()});
      return key;
    }
    function connect(a, b) { graph.get(a).adjacent.add(b); graph.get(b).adjacent.add(a); }
    for (const segment of segments) {
      if (segment.via) {
        const layers=segment.layers||['top','bottom'];
        for(let i=1;i<layers.length;i++)connect(vertex(segment.net,layers[0],segment.a),vertex(segment.net,layers[i],segment.a));
      }
      else connect(vertex(segment.net, segment.layer, segment.a), vertex(segment.net, segment.layer, segment.b));
    }

    const distance = new Map(), queue = [];
    const footprints = board.footprints || [];
    for (const source of settings.sourcePads) {
      if (!source || typeof source.ref !== 'string' || source.pin === undefined)
        throw new TypeError('Each source pad needs ref and pin.');
      const footprint = footprints.find(part => part.ref === source.ref);
      const pad = footprint && footprint.pads.find(item => item.pin === String(source.pin));
      if (!pad) throw new RangeError('Unknown source pad: ' + source.ref + '.' + source.pin);
      if (!nets.has(pad.net)) continue;
      // This flat-board export has top-side SMD parts. Drilled pads span both
      // layers; use explicit layers if a future export supplies them. Pad sizes
      // are axis-aligned bounding boxes in the same coordinates as the tracks.
      const layers = Array.isArray(pad.layers) ? pad.layers : pad.drill && pad.drill.some(value => value > 0)
        ? ['top', 'bottom'] : [footprint.layer === 'bottom' ? 'bottom' : 'top'];
      const size = pad.size || [0, 0];
      for (const [key, node] of graph) {
        if (node.net === pad.net && layers.includes(node.layer) &&
            Math.abs(node.xy[0] - pad.xy[0]) <= size[0] / 2 + 1e-8 &&
            Math.abs(node.xy[1] - pad.xy[1]) <= size[1] / 2 + 1e-8 && !distance.has(key)) {
          distance.set(key, 0); queue.push(key);
        }
      }
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
