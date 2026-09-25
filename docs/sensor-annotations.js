/* Connector illustration and dimensional context for the flat PCB.
 * Connector uses original KiCad-export coordinates inside the rotated board.
 * Context uses portrait coordinates x'=18-y, y'=x. Bodies and wires are
 * illustrative; dimensions are calculated from the exported PCB outline.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  function node(tag, attributes, text) {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes || {})) element.setAttribute(key, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function drawContext(svg, board) {
    if (!board || !Array.isArray(board.outline) || !board.outline.length)
      throw new TypeError('A board with exported outline segments is required.');
    const context = node('g', {'class': 'sensor-context', 'pointer-events': 'none'});
    // Title block, bottom right of the sheet.
    const tb = node('g', {'class': 'title-block'});
    tb.append(node('rect', {x: 27.5, y: 104.5, width: 19, height: 9, fill: '#fbfcfa', stroke: '#9aab9e', 'stroke-width': 0.14}));
    tb.append(node('line', {x1: 27.5, y1: 108.4, x2: 46.5, y2: 108.4, stroke: '#c3cec5', 'stroke-width': 0.1}));
    tb.append(node('text', {x: 28.4, y: 107.3, 'class': 'tb-title'}, 'HP-SDI12-NANO r2'));
    tb.append(node('text', {x: 28.4, y: 110.6, 'class': 'tb-meta'}, 'Top view · 4-layer'));
    tb.append(node('text', {x: 28.4, y: 112.6, 'class': 'tb-meta'}, 'Grid 1 mm · units mm'));
    context.append(tb);
    const wires = node('g', {'class': 'connector-wires', 'aria-label': 'External battery and logger wiring'});
    wires.append(node('text', {x: 9, y: -21, 'text-anchor': 'middle', 'font-size': 1.9,
      'font-family': 'Segoe UI, Arial, sans-serif', fill: '#596f63', 'font-weight': 600, 'class': 'context-title'}, 'External battery / logger'));
    const contacts = [
      {pin: 1, x: 13, start: -8, labelY: -11.7, color: '#b8574c', label: '12 V', role: 'power'},
      {pin: 2, x: 9, start: -13, labelY: -16.7, color: '#477dba', label: 'SDI-12', role: 'signal'},
      {pin: 3, x: 5, start: -8, labelY: -11.7, color: '#66716d', label: 'GND', role: 'ground'}
    ];
    const connector = (board.footprints || []).find(part => part.ref === 'J1');
    if (!connector) throw new Error('J1 cable solder pads are required.');
    for (const wire of contacts) {
      const pad = connector.pads.find(p=>p.pin===String(wire.pin));
      wire.x=18-pad.xy[1];
      const portDepth=pad.xy[0];
      // Wires terminate at the actual cable solder holes; no onboard connector housing.
      wires.append(node('path', {d: `M${wire.x},${wire.start} V${portDepth}`,
        fill: 'none', stroke: wire.color, 'stroke-width': 0.64, 'stroke-linecap': 'round',
        'data-pin': wire.pin, 'class': 'external-wire wire-' + wire.role}));
      wires.append(node('line', {x1: wire.x, y1: portDepth - 0.55, x2: wire.x, y2: portDepth,
        stroke: '#c5b37e', 'stroke-width': 0.38, 'stroke-linecap': 'round'}));
      wires.append(node('text', {x: wire.x, y: wire.labelY, 'text-anchor': 'middle', 'font-size': 1.85,
        'font-family': 'Segoe UI, Arial, sans-serif', fill: wire.color, 'font-weight': 650, 'class': 'wire-label wire-' + wire.role}, wire.label));
      wires.append(node('text', {x: wire.x, y: wire.labelY + 1.75, 'text-anchor': 'middle', 'font-size': 1.3,
        'font-family': 'Segoe UI, Arial, sans-serif', fill: '#75847b', 'class': 'wire-role'}, wire.role));
    }
    context.append(wires);

    const points = board.outline.flat();
    const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const left = 18 - maxY, right = 18 - minY, lengthX = -24, widthY = maxX + 6.3;
    const dimensions = node('g', {'class': 'pcb-dimensions', fill: 'none', stroke: '#93a396',
      'stroke-width': 0.16, 'aria-label': 'PCB outline dimensions, excluding wires'});
    function line(x1, y1, x2, y2, extra) {
      dimensions.append(node('line', {x1, y1, x2, y2, ...(extra || {})}));
    }
    // Overall length, well outside the component callouts on the left.
    line(lengthX, minX, lengthX, maxX);
    line(lengthX - 1.2, minX, left - 0.7, minX, {'stroke-dasharray': '0.5 0.7', opacity: 0.7});
    line(lengthX - 1.2, maxX, left - 0.7, maxX, {'stroke-dasharray': '0.5 0.7', opacity: 0.7});
    for (const end of [minX, maxX]) line(lengthX - 0.8, end + 0.8, lengthX + 0.8, end - 0.8);
    dimensions.append(node('text', {x: lengthX - 1.5, y: (minX + maxX) / 2,
      transform: `rotate(-90 ${lengthX - 1.5} ${(minX + maxX) / 2})`,
      'text-anchor': 'middle', 'font-size': 1.9, 'class': 'dim-text',
      fill: '#5f7466', stroke: 'none'}, (maxX - minX).toFixed(2) + ' mm'));
    // Overall width, below the longest needle and outside the PCB outline.
    line(left, widthY, right, widthY);
    for (const edge of [left, right]) {
      line(edge, maxX + 0.7, edge, widthY + 1.2, {'stroke-dasharray': '0.5 0.7', opacity: 0.7});
      line(edge - 0.8, widthY + 0.8, edge + 0.8, widthY - 0.8);
    }
    dimensions.append(node('text', {x: (left + right) / 2, y: widthY + 3.1, 'text-anchor': 'middle',
      'font-size': 1.9, 'class': 'dim-text', fill: '#5f7466', stroke: 'none'},
    (maxY - minY).toFixed(2) + ' mm'));
    dimensions.append(node('text', {x: (left + right) / 2, y: widthY + 6.2, 'text-anchor': 'middle',
      'font-size': 1.35, 'font-family': 'Segoe UI, Arial, sans-serif', fill: '#839286', stroke: 'none', 'class': 'dim-note'},
    'PCB outline · wires excluded'));
    context.append(dimensions);
    svg.append(context);
    return context;
  }

  const api = {drawContext};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SensorAnnotations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
