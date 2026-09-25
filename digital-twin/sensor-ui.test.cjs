/* Browser checks for the minimal, offline sensor dashboard.
 * Set PLAYWRIGHT_MODULE to an installed Playwright package if needed.
 * Set CHROMIUM_EXECUTABLE to use an existing Chrome/Chromium installation.
 * Optional TWIN_SCREENSHOT_DIR receives desktop images; otherwise no
 * screenshots or application output files are saved. No hardware is accessed. */
'use strict';
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath: process.env.CHROMIUM_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 1512, height: 1100}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(__dirname, '../docs/index.html')).href);
    await page.waitForFunction(() => window.SensorTwin && SensorTwin.run && SensorTwin.state);
    let checks = 0;
    const check = (value, label) => { assert.ok(value, label); checks++; };
    const near = (actual, expected, tolerance, label) => check(Math.abs(actual - expected) <= tolerance,
      `${label}: ${actual} versus ${expected}`);
    const snapshot = () => page.evaluate(() => ({state: SensorTwin.state, config: SensorTwin.config,
      time: SensorTwin.time, duration: SensorTwin.duration, power: SensorTwin.power}));
    const phase = () => page.locator('#phase').innerText();
    const seek = async time => page.locator('#time').evaluate((element, value) => {
      element.value = value; element.dispatchEvent(new Event('input', {bubbles: true}));
    }, time);
    const setTiming = async (id, value) => {
      await page.locator('#' + id).fill(String(value));
      await page.locator('#' + id).dispatchEvent('change');
    };
    const dialogOpen = () => page.locator('#componentDialog').evaluate(element => element.open);
    const displayNumber = async id => parseFloat(await page.locator('#' + id).innerText());
    const displayWatts = async id => {
      const text = await page.locator('#' + id).innerText();
      return parseFloat(text) / (text.includes('mW') ? 1000 : 1);
    };
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    const viewBox = () => page.locator('#board').evaluate(element => {
      const value = element.viewBox.baseVal;
      return [value.x, value.y, value.width, value.height];
    });
    const fitView = [-29, -24, 76, 140];
    const checkFit = async label => {
      const actual = await viewBox();
      actual.forEach((value, index) => near(value, fitView[index], .0001, label + ' coordinate ' + index));
    };
    const checkFlows = async label => {
      const result = await page.evaluate(() => {
        const state = SensorTwin.state;
        const visible = state.stage !== 'idle';
        const expected = {heat: state.heaterOn, return: state.heaterOn, logic: state.logicValid,
          gate: state.d9, excitation: state.d4, thermistors: state.d4,
          heaterTracks: state.heaterOn, supply: state.logicValid, ground: state.logicValid,
          i2c: ['baseline', 'pulse', 'cooldown'].includes(state.stage)};
        return Object.entries(expected).filter(([id, active]) =>
          document.getElementById('flow-' + id).classList.contains('on') !== (visible && !!active)).map(([id]) => id);
      });
      check(result.length === 0, label + ' activity overlays follow hardware state: ' + result.join(', '));
    };
    const chooseView = async view => page.locator(`[data-board-view="${view}"]`).click();
    const checkLayer = async view => {
      const result = await page.evaluate(expected => {
        function visible(element) {
          for (let item = element; item instanceof Element; item = item.parentElement) {
            const style = getComputedStyle(item);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
          }
          return true;
        }
        const board = document.getElementById('board'), tabs = [...document.querySelectorAll('[data-board-view]')];
        const selected = tabs.filter(tab => tab.getAttribute('aria-selected') === 'true');
        const tracks = [...board.querySelectorAll('.copper [data-track-index]')];
        const wrongTracks = tracks.filter(element => visible(element) !==
          (expected === 'components' ? element.dataset.copperLayers.split(' ').some(layer=>['top','bottom'].includes(layer)) : element.dataset.copperLayers.split(' ').includes(expected)));
        const visibleRoutes = [...board.querySelectorAll('.flow [data-copper-layers]')].filter(visible);
        const leakedRoutes = expected === 'components' ? [] : visibleRoutes.filter(element =>
          !element.dataset.copperLayers.split(' ').includes(expected));
        return {view: board.dataset.view, tabsOK: selected.length === 1 && selected[0].dataset.boardView === expected &&
            tabs.every(tab => tab.tabIndex === (tab.dataset.boardView === expected ? 0 : -1)),
          panelLabel: document.getElementById('sensor-view').getAttribute('aria-labelledby'),
          selectedId: selected[0]?.id, wrongTracks: wrongTracks.length, leakedRoutes: leakedRoutes.length,
          visibleRoutes: visibleRoutes.length,
          visibleVias: tracks.filter(element => SensorBoard.tracks[Number(element.dataset.trackIndex)].via && visible(element)).length,
          expectedVias: SensorBoard.tracks.filter(track => track.via && (expected==='components' || track.layers.includes(expected))).length,
          visibleParts: [...board.querySelectorAll('.part')].filter(visible).length,
          visibleZones: [...board.querySelectorAll('.copper-zone')].filter(visible).length,
          expectedZones: expected === 'components' ? 0 : SensorBoard.zones.filter(zone => zone.layer === expected).length,
          visiblePads: [...board.querySelectorAll('.copper-pad-shape')].filter(visible).length,
          expectedPads: expected === 'components' ? 0 : SensorBoard.footprints.reduce((total, part) =>
            total + part.pads.reduce((count, pad) => count + pad.copperPolygons.filter(polygon => polygon.layer === expected).length, 0), 0),
          symbolicHeaterVisible: visible(document.getElementById('flow-heat')),
          copperHeaterVisible: visible(document.getElementById('flow-heaterTracks'))};
      }, view);
      check(result.view === view && result.tabsOK && result.panelLabel === result.selectedId,
        view + ' tab selection and accessible panel label agree');
      check(result.wrongTracks === 0 && result.leakedRoutes === 0,
        view + ' exposes only the selected copper layer and its activity');
      check(result.visibleVias === result.expectedVias, view + ' preserves all through-vias');
      check(result.visibleParts === (view === 'components' ? 72 : 0), view + ' shows the appropriate component bodies');
      check(result.visibleZones === result.expectedZones && result.visiblePads === result.expectedPads,
        view + ' shows exactly its native filled regions and pad polygons');
      return result;
    };

    check(await page.locator('.part').count() === 72, 'all actual components are drawn');
    check(await page.evaluate(() => SensorBoard.footprints.filter(part => /^RH\d+$/.test(part.ref)).length) === 17,
      'latest r2 board has exactly 17 heater resistors');
    check(/rotate\(\s*90(?:\s|,|\))/.test(await page.locator('#rotatedBoard').getAttribute('transform')),
      'actual PCB geometry is rotated into the vertical view');
    check(await page.locator('select').count() === 0, 'dashboard has no dropdowns');
    check(await page.locator('input[type=number]').count() === 4, 'three timings and one heater duty are editable');
    check(await page.locator('#scenario,#fault,#exportScenario,a[href="thermal-lab.html"]').count() === 0,
      'removed scenario, fault, export, and legacy controls stay absent');
    check(await page.locator('[role=tab][data-board-view]').count() === 5, 'parts and four copper tabs are available');
    check((await phase()).trim() === 'Ready', 'initial phase is ready');
    check(await noOverflow(), 'no desktop horizontal overflow');
    let initial = await snapshot();
    check(initial.config.baselineS === 10 && initial.config.pulseS === 15 && initial.config.dutyPct === 85 && initial.config.cooldownS === 90,
      'default timings');
    near(initial.duration, 115, 1e-10, 'visible duration excludes synthetic model idle/report');
    near(initial.power.heaterW, 0, 1e-12, 'heater is initially off');
    check(await page.locator('#thermalField').getAttribute('opacity') === '0', 'soil colormap is neutral at reset');
    near(await displayNumber('tempHeatedZone'), 22, .001, 'heated-zone soil estimate starts at ambient');
    check(initial.power.logicRailW > 0 && initial.power.batteryW > 0, 'electronics remain powered while ready');
    await checkFlows('ready');
    check(await page.locator('#board .flow.on,#board .part.active,#board .energized').count() === 0,
      'Ready has no automatic flow or component highlights');
    const palette = await page.evaluate(() => {
      const stroke = selector => getComputedStyle(document.querySelector(selector)).stroke;
      const neutral = [...document.querySelectorAll('.copper line,.copper circle,.ntc-part .part-body')];
      const cyan = neutral.filter(element => {
        const style = getComputedStyle(element), color = element.tagName.toLowerCase() === 'line' ? style.stroke : style.fill;
        const rgb = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
        return rgb && rgb[2] - rgb[0] > 12 && rgb[1] - rgb[0] > 12;
      });
      return {heater: stroke('#flow-heat'), logic: stroke('#flow-logic .route-segment'),
        signal: stroke('#flow-gate .route-segment'), sense: stroke('#flow-thermistors .route-segment'),
        neutralCount: neutral.length, cyanCount: cyan.length};
    });
    check(palette.heater === 'rgb(255, 157, 0)', 'heater route uses vivid orange');
    check(palette.logic === 'rgb(255, 230, 0)', 'logic route uses vivid yellow');
    check(palette.signal === 'rgb(255, 77, 227)' && palette.sense === 'rgb(255, 77, 227)',
      'control and sensing routes use vivid pink');
    check(palette.neutralCount > 4 && palette.cyanCount === 0,
      'base copper and thermistor bodies stay neutral without cyan activity coloring');

    // Every logic/signal highlight must reproduce an exported copper segment or
    // via, including the layer and net. This catches invented connecting chords.
    const copper = await page.evaluate(() => {
      const groups = {logic: ['5V_LDO', '+5V', 'VREF'], gate: ['D9_HEAT', 'HEAT_GATE'],
        excitation: ['D4_EXC', 'EXC_GATE'], i2c: ['A4_SDA', 'A5_SCL'],
        thermistors: ['TH_RTN', 'A0_TH1', 'A1_TH2', 'A2_TH3', 'A3_TH4'],
        heaterTracks: ['HEAT_P', ...Array.from({length: 16}, (_, index) => 'H_' + (index + 1)), 'HEAT_RTN'],
        supply: ['VIN', 'VIN_P'], ground: ['GND']};
      const failures = [], counts = {}, logicLayers = new Set();
      const equal = (a, b) => a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) < 1e-8);
      for (const [id, nets] of Object.entries(groups)) {
        const group = document.getElementById('flow-' + id);
        const shapes = [...group.querySelectorAll('.route-segment,.route-via')];
        const expected = SensorBoard.tracks.map((track, index) => ({track, index})).filter(({track}) => nets.includes(track.net));
        const indices = shapes.map(shape => Number(shape.dataset.trackIndex));
        counts[id] = shapes.length;
        if (group.tagName.toLowerCase() !== 'g' || !shapes.length || shapes.length !== expected.length ||
            new Set(indices).size !== indices.length || expected.some(({index}) => !indices.includes(index)))
          failures.push(id + ': incomplete or duplicated copper');
        for (const shape of shapes) {
          const track = SensorBoard.tracks[Number(shape.dataset.trackIndex)];
          if (!track || !nets.includes(track.net) || shape.dataset.net !== track.net || shape.dataset.layer !== track.layer) {
            failures.push(id + ': wrong track identity'); continue;
          }
          const layers = track.layers || (track.via ? ['top', 'inner1', 'inner2', 'bottom'] : [track.layer]);
          if (shape.dataset.copperLayers !== layers.join(' ')) failures.push(id + ': wrong copper-layer membership');
          if (id === 'logic' && !track.via) logicLayers.add(track.layer);
          if (track.via) {
            if (shape.tagName.toLowerCase() !== 'circle' || !equal(
              ['cx', 'cy', 'r'].map(name => Number(shape.getAttribute(name))), [...track.a, track.width / 2]))
              failures.push(id + ': displaced via');
          } else {
            const points = (shape.getAttribute('d') || '').match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
            if (shape.tagName.toLowerCase() !== 'path' ||
                !(equal(points, [...track.a, ...track.b]) || equal(points, [...track.b, ...track.a])))
              failures.push(id + ': geometry differs from copper');
          }
        }
        if (group.children.length !== shapes.length) failures.push(id + ': extra non-copper overlay');
      }
      return {failures, counts, logicLayers: [...logicLayers]};
    });
    check(copper.failures.length === 0, 'routed overlays preserve actual copper: ' + copper.failures.join('; '));
    check(copper.logicLayers.includes('top') && copper.logicLayers.includes('bottom'),
      'logic highlight follows both copper layers');
    const polygonGeometry = await page.evaluate(() => {
      const failures = [];
      function matches(element, polygons) {
        const actual = (element.getAttribute('d') || '').match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
        const rings = polygons.flatMap(polygon => [polygon.outer, ...(polygon.holes || [])]);
        const expected = rings.flat(2);
        return getComputedStyle(element).fillRule === 'evenodd' && actual.length === expected.length &&
          actual.every((value, index) => Math.abs(value - expected[index]) < 1e-8) &&
          (element.getAttribute('d').match(/M/g) || []).length === rings.length;
      }
      const zones = [...document.querySelectorAll('.copper-zone')];
      if (zones.length !== SensorBoard.zones.length || !zones.length) failures.push('filled-zone count');
      for (const element of zones) {
        const source = SensorBoard.zones[Number(element.dataset.zoneIndex)];
        if (element.dataset.net !== source.net || element.dataset.copperLayers !== source.layer || !matches(element, source.polygons))
          failures.push('filled region or clearance differs from export');
      }
      const pads = [...document.querySelectorAll('.copper-pad')];
      if (pads.length !== SensorBoard.footprints.reduce((total, part) => total + part.pads.length, 0)) failures.push('pad count');
      for (const element of pads) {
        const part = SensorBoard.footprints.find(item => item.ref === element.dataset.ref);
        const source = part.pads[Number(element.dataset.padIndex)], shapes = [...element.querySelectorAll('.copper-pad-shape')];
        if (element.dataset.pin !== source.pin || element.dataset.net !== source.net ||
            element.dataset.copperLayers !== source.layers.join(' ') || shapes.length !== source.copperPolygons.length ||
            shapes.some((shape, index) => shape.dataset.copperLayers !== source.copperPolygons[index].layer ||
              !matches(shape, [source.copperPolygons[index]]))) failures.push(part.ref + ': pad contour differs from export');
      }
      const drills = document.querySelectorAll('.copper-drill').length;
      const expectedDrills = SensorBoard.tracks.filter(track => track.via && track.drill > 0).length +
        SensorBoard.footprints.reduce((total, part) => total + part.pads.filter(pad => pad.holePolygons.length).length, 0);
      if (drills !== expectedDrills) failures.push('physical drill cutout count');
      return failures;
    });
    check(polygonGeometry.length === 0, 'copper polygons preserve native shapes, holes, and islands: ' + polygonGeometry.join('; '));

    for (const view of ['components', 'top', 'inner1', 'inner2', 'bottom']) {
      await chooseView(view);
      await checkLayer(view);
      check(await page.locator('#board .flow.on,#board .part.active,#board .energized').count() === 0,
        view + ' remains neutral before a measurement');
    }
    check((await page.locator('#layerNote').innerText()).includes('viewed from above'),
      'bottom copper explicitly states its viewing orientation');
    await chooseView('components');
    await page.locator('[data-board-view="components"]').focus();
    for (const [key, expected] of [['ArrowRight', 'top'], ['End', 'bottom'], ['ArrowLeft', 'inner2'], ['Home', 'components']]) {
      await page.keyboard.press(key);
      check(await page.locator(`[data-board-view="${expected}"]`).evaluate(element =>
        element === document.activeElement && element.getAttribute('aria-selected') === 'true' && element.tabIndex === 0),
        key + ' moves focus and selection together in the PCB tabs');
    }

    const connectorContext = await page.evaluate(() => {
      const connector = SensorBoard.footprints.find(part => part.ref === 'J1');
      const expected = {1: 'VIN', 2: 'SDI_LINE', 3: 'GND'}, failures = [];
      for (const [pin, net] of Object.entries(expected)) {
        const wire = document.querySelector(`.external-wire[data-pin="${pin}"]`);
        const pad = connector.pads.find(item => item.pin === pin);
        const end = wire.getPointAtLength(wire.getTotalLength());
        const endpoint = new DOMPoint(end.x, end.y).matrixTransform(wire.getScreenCTM());
        if (pad.net !== net || Math.abs(end.x - (18 - pad.xy[1])) > .001 ||
            Math.abs(end.y-pad.xy[0]) > .001)
          failures.push(pin + ': wire does not meet the correct connector entry');
      }
      const context = document.querySelector('.sensor-context').getBBox();
      return {failures, housing: document.querySelectorAll('#part-J1 .wago-housing, #part-J1 .part-body').length,
        wires: document.querySelectorAll('.external-wire').length,
        dimensions: [...document.querySelectorAll('.pcb-dimensions text')].map(element => element.textContent),
        context: [context.x, context.y, context.x + context.width, context.y + context.height]};
    });
    check(connectorContext.housing === 0 && connectorContext.wires === 3, 'three soldered wires without connector housing');
    check(connectorContext.failures.length === 0, 'external wires meet correct power/signal/ground ports: ' +
      connectorContext.failures.join('; '));
    check(connectorContext.dimensions.includes('99.86 mm') && connectorContext.dimensions.includes('17.78 mm'),
      'outline dimensions reflect the actual PCB rather than the incoming wires');
    check(connectorContext.context[0] >= fitView[0] && connectorContext.context[1] >= fitView[1] &&
      connectorContext.context[2] <= fitView[0] + fitView[2] && connectorContext.context[3] <= fitView[1] + fitView[3],
      'whole-board fit includes connector wiring and dimension annotations');

    check(await page.locator('#zoomIn,#zoomOut,#zoomFit,#zoomLevel').count() === 4, 'zoom controls are present');
    await checkFit('initial fit');
    check(await page.locator('#zoomOut').isDisabled(), 'zoom cannot go below whole-board fit');
    await page.locator('#zoomIn').click();
    near((await viewBox())[2], fitView[2] / 1.5, .0001, 'zoom-in changes viewport scale');
    check((await page.locator('#zoomLevel').innerText()).trim() === '150%', 'zoom readout follows buttons');
    await page.locator('#zoomOut').click();
    await checkFit('zoom-out returns to fit');
    for (let i = 0; i < 12 && !(await page.locator('#zoomIn').isDisabled()); i++)
      await page.locator('#zoomIn').click();
    near((await viewBox())[2], fitView[2] / 6, .0001, 'button zoom is capped at six times');
    check(await page.locator('#zoomIn').isDisabled(), 'maximum zoom disables zoom-in button');
    await page.locator('#zoomFit').click();
    await checkFit('Fit resets button zoom');

    const anchor = await page.locator('#board').evaluate(element => {
      const value = element.viewBox.baseVal, x = value.x + value.width * .43, y = value.y + value.height * .47;
      const screen = new DOMPoint(x, y).matrixTransform(element.getScreenCTM());
      // Browser wheel events report integer client coordinates.
      const screenX = Math.round(screen.x), screenY = Math.round(screen.y);
      const local = new DOMPoint(screenX, screenY).matrixTransform(element.getScreenCTM().inverse());
      return {x: local.x, y: local.y, screenX, screenY, scrollY};
    });
    await page.mouse.move(anchor.screenX, anchor.screenY);
    await page.mouse.wheel(0, -240);
    await page.waitForFunction(width => document.querySelector('#board').viewBox.baseVal.width < width, fitView[2]);
    const anchored = await page.locator('#board').evaluate((element, point) => {
      const local = new DOMPoint(point.screenX, point.screenY).matrixTransform(element.getScreenCTM().inverse());
      return {x: local.x, y: local.y, scrollY};
    }, anchor);
    near(anchored.x, anchor.x, .001, 'wheel zoom holds the pointer anchor horizontally');
    near(anchored.y, anchor.y, .001, 'wheel zoom holds the pointer anchor vertically');
    near(anchored.scrollY, anchor.scrollY, 1, 'wheel zoom does not scroll the document');
    const beforePan = await viewBox();
    const controller = await page.locator('#part-U1').boundingBox();
    const dragX = controller.x + controller.width / 2, dragY = controller.y + controller.height / 2;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX + 24, dragY + 35, {steps: 8});
    await page.mouse.up();
    const afterPan = await viewBox();
    check(Math.hypot(afterPan[0] - beforePan[0], afterPan[1] - beforePan[1]) > .1,
      'dragging a component pans the zoomed viewport');
    near(afterPan[2], beforePan[2], .0001, 'panning preserves scale');
    check(!(await dialogOpen()), 'a drag gesture does not open component details');
    check(!(await page.locator('#board').evaluate(element => element.classList.contains('is-panning'))),
      'pointer release ends the pan gesture');
    await page.locator('#zoomFit').click();
    await checkFit('Fit resets pan and wheel zoom');
    await page.mouse.move(anchor.screenX, anchor.screenY);
    await page.mouse.wheel(0, -10000);
    await page.waitForFunction(() => document.querySelector('#zoomIn').disabled);
    near((await viewBox())[2], fitView[2] / 6, .0001, 'wheel zoom respects maximum scale');
    await page.mouse.wheel(0, 10000);
    await page.waitForFunction(() => document.querySelector('#zoomOut').disabled);
    await checkFit('wheel zoom respects minimum scale');
    check(!(await dialogOpen()) && (await phase()).trim() === 'Ready', 'viewport gestures do not change measurement state');

    await page.locator('#start').click();
    await page.waitForTimeout(240);
    check((await snapshot()).time > 0, 'playback advances');
    await chooseView('bottom');
    const runningAfterViewChange = (await snapshot()).time;
    check(!(await page.locator('#board').evaluate(element => element.classList.contains('paused'))),
      'switching copper view preserves playing state');
    await page.waitForTimeout(120);
    check((await snapshot()).time > runningAfterViewChange, 'playback keeps advancing after a view change');
    await chooseView('components');
    await page.locator('#start').click();
    const paused = (await snapshot()).time;
    const pausedHighlights = await page.locator('#board .flow.on,#board .part.active').evaluateAll(elements =>
      elements.map(element => element.id));
    await page.waitForTimeout(180);
    near((await snapshot()).time, paused, 1e-10, 'playback pauses');
    check(pausedHighlights.length > 0 && JSON.stringify(pausedHighlights) ===
      JSON.stringify(await page.locator('#board .flow.on,#board .part.active').evaluateAll(elements =>
        elements.map(element => element.id))), 'pause retains the same visible activity highlights');
    check(await page.locator('#board .flow.on').evaluateAll(elements => elements.length > 0 && elements.every(element => {
      const style = getComputedStyle(element);
      return Number(style.opacity) > 0 && style.animationPlayState === 'paused';
    })), 'pause freezes route animation without hiding it');
    await seek(0);
    check((await phase()).includes('Background sensing'), 'time zero begins background sensing after start');
    check((await snapshot()).state.stage === 'baseline', 'visible zero maps to model baseline');
    await checkFlows('background sampling');
    check(await page.locator('#flow-logic.on').count() === 1,
      'displayed time zero shows powered rails once a measurement has begun');
    await seek(.3);
    check(!(await snapshot()).state.d4, 'thermistor excitation switches off between samples');
    await checkFlows('between samples');
    await seek(9.99);
    check((await phase()).includes('Background sensing') && !(await snapshot()).state.heaterOn,
      'heater remains off before the background interval ends');
    await seek(10);
    let heating = await snapshot();
    check((await phase()).trim() === 'Heating' && heating.state.heaterOn, 'heater starts exactly at the boundary');
    await checkFlows('heater on');
    check(heating.power.heaterW > 1 && heating.power.currentA > 0.1, 'heating displays actual current and power');
    near(heating.state.currentA, heating.state.onCurrentA * .85, 1e-12, 'current readout is a PWM cycle average');
    near(heating.power.heaterW, heating.state.onHeaterPowerW * .85, 1e-12, 'heater power uses ON power times duty');
    check((await page.locator('#boardStatus').innerText()).includes('85% duty'), 'board status identifies average PWM activity');
    check(await displayWatts('heaterPower') > 1 && await displayWatts('power-heaters') > 1,
      'live power cards reflect the on state');
    await seek(15);
    heating = await snapshot();
    near(heating.state.energyJ, heating.power.heaterW * 5, 1e-9, 'accumulated energy follows average power times elapsed heating time');
    check(await page.locator('#thermalField').getAttribute('opacity') === '1', 'heating produces a spatial soil colormap');
    check(Number(await page.locator('#thermalField').getAttribute('data-maximum-rise')) > 1, 'colormap samples the hot section, not the cool TH2 tip');
    near(await displayNumber('tempHeatedZone'), heating.state.heatedZoneSoilC, .006, 'separate heated-zone display matches model');
    check(heating.state.heatedZoneSoilC > heating.state.temperaturesC[1], 'hot-section soil and TH2 beyond heaters remain distinct');
    const fieldDuringPulse=await page.locator('#thermalField').getAttribute('href');
    await page.locator('#zoomIn').click();
    const preservedView = await viewBox(), preservedRun = await snapshot();
    for (const view of ['top', 'inner1', 'inner2', 'bottom', 'components']) {
      await chooseView(view);
      check(await page.locator('#thermalField').getAttribute('href') === fieldDuringPulse, 'changing copper views preserves the temperature field');
      const layer = await checkLayer(view), current = await snapshot();
      near(current.time, preservedRun.time, 1e-10, view + ' preserves paused measurement time');
      near(current.state.energyJ, preservedRun.state.energyJ, 1e-10, view + ' preserves accumulated energy');
      check(JSON.stringify(await viewBox()) === JSON.stringify(preservedView), view + ' preserves zoom and viewport');
      check(await page.locator('#board').evaluate(element => element.classList.contains('paused')),
        view + ' preserves paused playback state');
      check(layer.symbolicHeaterVisible === (view === 'components') && layer.copperHeaterVisible === (view !== 'components'),
        view + ' uses only the intended simplified or actual-copper heater overlay');
      check(layer.visibleRoutes > 0, view + ' retains visible powered routes during a paused pulse');
      if (view === 'inner1' || view === 'inner2') {
        check(await page.locator(`.copper-zone[data-copper-layers="${view}"]`).evaluate(element =>
          element.classList.contains('energized') && getComputedStyle(element).display !== 'none'),
          view + ' highlights its active supply or ground plane');
        if (process.env.TWIN_SCREENSHOT_DIR)
          await page.screenshot({path: path.join(process.env.TWIN_SCREENSHOT_DIR, `nano-twin-${view}.png`)});
      }
      await checkFlows('paused pulse in ' + view);
    }
    await page.locator('#zoomFit').click();
    for (const ref of ['TH1', 'TH2', 'TH3', 'TH4'])
      check(Number.isFinite(await displayNumber('temp-' + ref)), ref + ' temperature is visible');
    near(await displayNumber('temp-TH4'), 22, 0.0001, 'board thermistor stays at unmodeled ambient');
    await seek(24.99);
    check((await snapshot()).state.heaterOn, 'heater stays on until pulse end');
    await seek(25);
    const cooling = await snapshot();
    check((await phase()).includes('Cooling sensing') && !cooling.state.heaterOn, 'pulse ends exactly at the boundary');
    await checkFlows('heater off during cooling');
    near(cooling.power.heaterW, 0, 1e-12, 'cooling heater power is zero');
    check(await page.locator('#thermalField').getAttribute('opacity') === '1', 'warm soil remains visible after power switches off');
    near(await displayNumber('heaterPower'), 0, 1e-12, 'cooling card is instantaneous rather than on-state potential');
    near(await displayNumber('power-shunt'), 0, 1e-12, 'cooling shunt dissipation is zero');
    check(cooling.power.logicRailW > 0 && cooling.power.U3dissipationW > 0,
      'logic and regulator power remain positive while sensing the cooling curve');
    await seek(37);
    check((await snapshot()).state.temperaturesC[0] > cooling.state.temperaturesC[0],
      'heat continues arriving at the side needle after heater cutoff');
    near((await snapshot()).state.energyJ, cooling.state.energyJ, 1e-9, 'heater energy is held through cooling');
    await seek(115);
    check((await phase()).trim() === 'Complete', 'total duration completes the measurement');
    check(!(await snapshot()).state.heaterOn, 'heater remains off at completion');
    await checkFlows('complete');
    await page.locator('#start').click();
    await page.waitForTimeout(100);
    check((await snapshot()).time < 10 && (await phase()).includes('Background sensing'),
      'run button starts a fresh measurement after completion');
    await page.locator('#restart').click();
    check((await phase()).trim() === 'Ready' && (await snapshot()).time === 0, 'reset returns to ready');
    near((await snapshot()).state.energyJ, 0, 1e-12, 'reset clears accumulated energy');
    await checkFlows('reset');
    check(await page.locator('#board .flow.on,#board .part.active,#board .energized').count() === 0,
      'reset clears automatic route and component highlights');
    check((await snapshot()).power.logicRailW > 0, 'reset does not falsely turn off modeled electronics power');
    check(await page.locator('#thermalField').getAttribute('opacity') === '0', 'reset clears stored heat from the colormap');

    const speeds = [];
    for (let i = 0; i < 4; i++) {
      speeds.push((await page.locator('#speed').innerText()).trim());
      if (i < 3) await page.locator('#speed').click();
    }
    check(speeds.join(',') === '4×,10×,1×,4×', 'speed cycles 4×, 10×, 1×');

    await page.locator('#part-Q2').click();
    check(await dialogOpen(), 'PCB component opens a native dialog');
    check((await page.locator('#dialogRef').innerText()).includes('Q2'), 'component identity in dialog');
    check((await page.locator('#dialogDescription').innerText()).includes('VREF'), 'correct ground-switch explanation');
    check((await page.locator('#dialogReadings').innerText()).trim().length > 0, 'component details include live readings');
    await page.keyboard.press('Escape');
    check(!(await dialogOpen()), 'Escape closes details');
    await page.locator('[data-component="TH1"]').first().click();
    check(await dialogOpen() && (await page.locator('#dialogTitle').innerText()).toLowerCase().includes('thermistor'),
      'thermistor readout opens its explanation');
    await page.locator('#closeDialog').click();
    check(!(await dialogOpen()), 'close button closes details');
    await seek(15);
    await page.locator('#part-RH1').focus();
    const focusStyle = await page.locator('#part-RH1').evaluate(element => {
      const outline = element.querySelector('.part-outline'), style = getComputedStyle(outline);
      return {tag: outline.tagName.toLowerCase(), fill: style.fill, width: parseFloat(style.strokeWidth),
        vectorEffect: style.vectorEffect, rx: parseFloat(style.rx), outlineStyle: getComputedStyle(element).outlineStyle};
    });
    check(focusStyle.tag === 'rect' && focusStyle.fill === 'none' && focusStyle.rx === 0,
      'component focus uses an unfilled rectangle without a rounded oval');
    near(focusStyle.width, 1.6, .01, 'focused component border stays thin');
    check(focusStyle.vectorEffect === 'non-scaling-stroke' && focusStyle.outlineStyle === 'none',
      'focus border uses screen pixels and suppresses the native SVG outline');
    await page.keyboard.press('Enter');
    check(await dialogOpen() && (await page.locator('#dialogRef').innerText()).includes('RH1'),
      'keyboard activates a board component');
    const heaterReadings = await page.locator('#dialogReadings').innerText();
    check(heaterReadings.includes('Average heat') && heaterReadings.includes('Heat during ON') && heaterReadings.includes('85%'),
      'resistor detail separates average heating, full ON heating, and duty');
    check((await page.locator('#dialogExtra').innerText()).includes('Squaring the average current would give the wrong result'),
      'resistor formula uses ON current rather than squaring average current');
    await page.mouse.click(3, 3);
    check(!(await dialogOpen()), 'backdrop closes details');
    for (const id of ['modelInfo', 'modelNotes']) {
      await page.locator('#' + id).click();
      check(await dialogOpen() && (await page.locator('#componentDialog').innerText()).length > 100,
        id + ' opens model assumptions');
      await page.keyboard.press('Escape');
    }
    for (const selector of ['.heated-zone-reading', '.thermal-legend']) {
      await page.locator(selector).click();
      check(await dialogOpen() && (await page.locator('#dialogTitle').innerText()).includes('Heated section'),
        selector + ' opens heat-transfer details');
      check((await page.locator('#componentDialog').innerText()).includes('not a prediction of the steel'),
        selector + ' clearly distinguishes ideal soil from steel temperature');
      await page.keyboard.press('Escape');
      check(!(await dialogOpen()), 'Escape closes heat-transfer details from ' + selector);
    }

    await setTiming('pulseS', 8);
    const e8 = await page.evaluate(() => SensorTwin.run.deliveredHeaterEnergyJ);
    check((await phase()).trim() === 'Ready' && (await snapshot()).time === 0, 'valid change resets playback');
    near((await snapshot()).duration, 108, 1e-10, '8-second duration');
    await setTiming('pulseS', 15);
    const e15 = await page.evaluate(() => SensorTwin.run.deliveredHeaterEnergyJ);
    near(e15 / e8, 15 / 8, 1e-10, '15 versus 8 seconds scales delivered heater energy');
    await setTiming('dutyPct', 100);
    await seek(20);
    const fullDuty = await snapshot();
    const fullEnergy = await page.evaluate(() => SensorTwin.run.deliveredHeaterEnergyJ);
    await setTiming('dutyPct', 50);
    await seek(20);
    const halfDuty = await snapshot();
    near(halfDuty.power.heaterW, fullDuty.power.heaterW / 2, 1e-12, 'half duty halves average heater power');
    near(halfDuty.state.onCurrentA, fullDuty.state.onCurrentA, 1e-12, 'duty does not reduce ON current');
    near(halfDuty.power.perHeaterW[0].onPowerW, fullDuty.power.perHeaterW[0].onPowerW, 1e-12,
      'resistor ON power and rating exposure are independent of duty');
    near(halfDuty.state.energyJ, fullDuty.state.energyJ / 2, 1e-9, 'half duty halves accumulated energy');
    near(halfDuty.state.heatedZoneSoilC - 22, (fullDuty.state.heatedZoneSoilC - 22) / 2, 1e-9,
      'ideal thermal field responds proportionally to duty');
    near(await page.evaluate(() => SensorTwin.run.deliveredHeaterEnergyJ), fullEnergy / 2, 1e-9,
      'half duty halves full-pulse energy');
    await setTiming('dutyPct', 0);
    await seek(20);
    const zeroDuty = await snapshot();
    check((await phase()).trim() === 'Heating' && !zeroDuty.state.heaterOn && !zeroDuty.state.d9,
      'zero duty keeps the measurement sequence but never commands heating');
    near(zeroDuty.power.heaterW, 0, 1e-12, 'zero duty has no heater power');
    near(zeroDuty.state.energyJ, 0, 1e-12, 'zero duty has no delivered heat energy');
    near(zeroDuty.state.heatedZoneSoilC, 22, 1e-12, 'zero duty leaves modeled soil at ambient');
    check(await page.locator('#thermalField').getAttribute('opacity') === '0', 'zero duty leaves the soil map neutral');
    check(zeroDuty.power.logicRailW > 0, 'zero duty retains electronics power');
    await checkFlows('zero duty');
    for (const value of ['-1', '101', '']) {
      await setTiming('dutyPct', value);
      check(await page.locator('#start').isDisabled(), 'invalid duty disables playback: ' + value);
      check((await page.locator('#inputError').innerText()).includes('percent'), 'duty validation uses percent units');
      check((await snapshot()).config.dutyPct === 0, 'invalid duty preserves last accepted configuration');
    }
    await setTiming('dutyPct', 85);
    check(!(await page.locator('#start').isDisabled()), 'valid duty recovers playback');
    await setTiming('baselineS', 5);
    await setTiming('cooldownS', 45);
    near((await snapshot()).duration, 65, 1e-10, 'all three timing values determine duration');
    await seek(5);
    check((await snapshot()).state.heaterOn, 'changed background duration moves heater start');
    await seek(20);
    check(!(await snapshot()).state.heaterOn && (await phase()).includes('Cooling sensing'),
      'changed pulse duration moves heater cutoff');
    await seek(65);
    check((await phase()).trim() === 'Complete', 'changed total duration completes');

    const accepted = await page.evaluate(() => JSON.stringify(SensorTwin.config));
    for (const value of ['0', '16', '']) {
      await setTiming('pulseS', value);
      check(await page.locator('#start').isDisabled(), 'invalid heating time disables playback: ' + value);
      check(await page.locator('#inputError').isVisible(), 'invalid heating time shows explanation: ' + value);
      check(await page.evaluate(() => JSON.stringify(SensorTwin.config)) === accepted,
        'invalid input preserves accepted configuration: ' + value);
      check(await page.evaluate(() => SensorTwin.config.pulseS === SensorTwin.run.config.pulseS),
        'invalid input cannot mix configuration and results');
    }
    await setTiming('pulseS', 15);
    check(!(await page.locator('#start').isDisabled()) && !(await page.locator('#inputError').isVisible()),
      'valid timing recovers from validation errors');
    await setTiming('baselineS', 10);
    await setTiming('cooldownS', 90);
    await seek(18);
    if (process.env.TWIN_SCREENSHOT_DIR)
      await page.screenshot({path: path.join(process.env.TWIN_SCREENSHOT_DIR, 'flat-twin-pulse.png'), fullPage: true});
    for (const width of [1366, 1440]) {
      await page.setViewportSize({width, height: 900});
      await page.evaluate(() => scrollTo(0, 0));
      check(await noOverflow(), `no horizontal overflow at desktop ${width} × 900`);
      const layout = await page.evaluate(() => {
        const board = document.querySelector('.sensor-panel').getBoundingClientRect();
        const readouts = document.querySelector('.readouts').getBoundingClientRect();
        const ids = ['baselineS', 'pulseS', 'cooldownS', 'dutyPct', 'start', 'phase', 'temp-TH1', 'temp-TH2', 'temp-TH3', 'temp-TH4', 'tempHeatedZone',
          'batteryPower', 'heaterPower', 'heatEnergy', 'power-heaters', 'power-regulator',
          'power-logic', 'power-diodes', 'power-shunt', 'power-switch', 'power-wiring'];
        const outside = ids.filter(id => {
          const box = document.getElementById(id).getBoundingClientRect();
          return box.width <= 0 || box.height <= 0 || box.left < 0 || box.top < 0 ||
            box.right > innerWidth + 1 || box.bottom > innerHeight + 1;
        });
        return {sideBySide: board.right <= readouts.left + 1, outside};
      });
      const tabBoxes=await page.locator('[data-board-view]').evaluateAll(tabs=>tabs.map(t=>({y:t.getBoundingClientRect().top,width:t.clientWidth,scroll:t.scrollWidth})));
      check(tabBoxes.length===5 && tabBoxes.every(t=>Math.abs(t.y-tabBoxes[0].y)<1 && t.scroll<=t.width+1), 'all five short tabs fit one row at '+width);
      const controls=await page.locator('.timing-field').evaluateAll(fields=>fields.map(field=>{
        const box=field.getBoundingClientRect();return {top:box.top,right:box.right,width:field.clientWidth,scroll:field.scrollWidth};
      }));
      check(controls.length===4 && controls.every(field=>Math.abs(field.top-controls[0].top)<1 && field.scroll<=field.width+1),
        'three timings and duty remain on one clear row at '+width);
      check(layout.sideBySide, `PCB and readouts remain side by side at desktop ${width}`);
      check(layout.outside.length === 0,
        `all key indicators visible at desktop ${width} × 900: ${layout.outside.join(', ')}`);
      for (const view of ['top', 'inner1', 'inner2', 'bottom']) {
        await chooseView(view);
        const contained = await page.evaluate(() => ['.sensor-panel', '.board-tabs', '#layerNote'].every(selector => {
          const box = document.querySelector(selector).getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 &&
            box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
        }));
        check(contained && await noOverflow(), `${view} copper and its controls fit desktop ${width} × 900`);
      }
      await chooseView('components');
      await page.locator('[data-component="TH2"]').first().click();
      check(await dialogOpen() && await noOverflow(), `component dialog fits desktop ${width}`);
      await page.keyboard.press('Escape');
      if (process.env.TWIN_SCREENSHOT_DIR)
        await page.screenshot({path: path.join(process.env.TWIN_SCREENSHOT_DIR, `flat-twin-desktop-${width}.png`)});
    }
    check(errors.length === 0, 'no browser errors: ' + errors.join('; '));
    console.log(JSON.stringify({checks, errors, pulseEnergy8s: e8, pulseEnergy15s: e15}));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
