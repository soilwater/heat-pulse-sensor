/* Guided-tour script for the HP-SDI12-NANO r2 heat-pulse sensor (data for tour.js).
 * Each step: phase, time(ctx) = displayed simulation time of the event (0 = background sensing
 * starts), focus = parts the camera frames, plain = everyday-language explanation, what happens,
 * why the part is there, and optional live values read from the running twin (ctx.state,
 * ctx.power, ctx.run, ctx.estimate, ...). American English throughout. */
(function (root) {
  'use strict';
  const B = c => c.config.baselineS, heatOn = c => B(c), heatOff = c => B(c) + c.config.pulseS;
  const f = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : '—';
  const rise = (c, i) => c.state.temperaturesC[i] - c.config.ambientC;
  // Displayed time of the side-needle peak, from the simulated series.
  function peakTime(c) {
    const off = c.run.stages[1].startS; let best = c.run.series[0];
    for (const p of c.run.series) if (p.tempL > best.tempL) best = p;
    return best.t - off;
  }
  const RH = Array.from({length: 17}, (_, i) => 'RH' + (i + 1));

  root.TwinTourSteps = [
    // ---------------- Overview ----------------
    {phase: 'overview', phaseLabel: 'Overview', time: 0.5, focus: [],
      title: 'One measurement, part by part',
      plain: 'The sensor warms the soil slightly for a few seconds and watches how much, and how quickly, the nearby needles warm up. That tells us how the soil stores heat and how easily heat moves through it.',
      what: 'This board sits in the soil with three needles. The center needle is a heater; the outer two carry temperature sensors 8 mm away. A logger asks for a measurement, the board heats the soil for a few seconds, and it records how the heat arrives at the side needles.',
      why: 'The size and timing of that temperature rise give the soil’s thermal properties: its volumetric heat capacity (how much heat it stores) and thermal conductivity (how easily heat moves through it). Soil moisture is then estimated from the heat capacity, because water stores far more heat than soil minerals or air.'},
    // ---------------- Power ----------------
    {phase: 'power', phaseLabel: 'Power in', time: 0.5, focus: ['J1'],
      title: 'Cable pads: power, data and ground',
      plain: 'The sensor’s lifeline: one wire brings energy, one carries messages, one completes the circuit.',
      what: 'Three wires from the logger are soldered here: 12 V battery power, the SDI-12 data line, and ground.',
      why: 'Bare solder holes instead of a plug keep the body thin and fully sealed in potting: there is nothing to corrode or work loose in wet soil.'},
    {phase: 'power', phaseLabel: 'Power in', time: 0.5, focus: ['D2', 'C1'],
      title: 'Surge protection',
      plain: 'A pressure-relief valve for electricity: it dumps sudden voltage spikes to ground before they reach the chips.',
      what: 'D2 is a transient-voltage suppressor from the 12 V input to ground; C1 smooths the protected input.',
      why: 'Long field cables pick up spikes from static and nearby lightning. D2 clamps short spikes (it does not regulate voltage), so the electronics survive years outdoors.'},
    {phase: 'power', phaseLabel: 'Power in', time: 0.5, focus: ['D1'],
      title: 'Reverse-polarity diode',
      plain: 'A one-way valve: current can only flow the right way, so swapping the battery wires cannot damage the board.',
      what: 'All current, for both the electronics and the heater, passes through this Schottky diode.',
      why: 'A swapped wire in the field is easy to do, and D1 blocks it. A Schottky diode costs only about 0.35 V, leaving more voltage for the heater.'},
    {phase: 'power', phaseLabel: 'Power in', time: 0.5, focus: ['U3', 'C2'],
      title: 'Two voltages: 12 V for heat, 5 V for the electronics',
      plain: 'A pressure reducer: it takes the battery’s 12 V, which drifts as the battery charges and drains, and hands the chips a steady 5 V.',
      what: 'U3 converts the battery voltage into a constant 5 V for the processor, the thermistor circuit and the power monitor. The heater does not go through it; it runs straight from the battery.',
      why: 'The processor board (Arduino Nano R4) is designed to run at 5 V: its Renesas chip accepts roughly 1.6 to 5.5 V, and Arduino built this board around 5 V to stay compatible with the classic Arduino Nano. The 5 V also sets the full scale of the temperature measurement, so it must stay steady. The heater bypasses U3 because the regulator would turn the difference into waste heat: about (12 − 5) V × 0.2 A ≈ 1.4 W, far too much for this small part.'},
    {phase: 'power', phaseLabel: 'Power in', time: 0.5, focus: ['D7', 'D5', 'C17'],
      title: 'Battery or USB, never backwards',
      plain: 'Two one-way doors into the same room: power can come from the battery or from a laptop, but never flows back out the other door.',
      what: 'D7 feeds the 5 V logic rail from the regulator, D5 from USB during programming; C17 buffers the shared rail.',
      why: 'The board can be programmed from a laptop before potting without USB power flowing back into the regulator, and USB can never drive the heater.'},
    // ---------------- Controller and wake-up ----------------
    {phase: 'logic', phaseLabel: 'Processor', time: 0.5, focus: ['U1', 'Y1'],
      title: 'The processor (Arduino Nano R4, Renesas RA4M1)',
      plain: 'The brain: it decides when to heat, when to read the thermometers, and does the math. It gives orders but never carries the heavy current itself.',
      what: 'U1 runs the measurement: it switches the heater (pin D9), switches the thermistors (D4), reads four temperatures (A0–A3), and talks to the power monitor over I²C. Y1 is a 32.768 kHz crystal for timekeeping.',
      why: 'Its 14-bit analog-to-digital converter (ADC) is the key upgrade. Earlier prototypes used a 10-bit ATmega328P, which read temperature in steps of about 0.09 °C; here a step is about 0.006 °C. The heat-pulse signal is often under 1 °C, so this resolution decides whether the measurement works.'},
    {phase: 'signal', phaseLabel: 'Wake-up', time: 0.5, focus: ['R3', 'R4', 'C4', 'D4'],
      title: 'SDI-12: the logger asks for a measurement',
      plain: 'A party line: the logger calls each sensor by its address, and only that sensor answers.',
      what: 'The logger sends a command on the single SDI-12 data wire. R3 limits current into the processor pin, R4 sets the idle level, C4 softens fast edges, and D4 protects the line.',
      why: 'SDI-12 is the standard language of environmental data loggers: one data wire, many sensors on the same cable, and long cable runs. Using it means the sensor connects to existing field stations.'},
    // ---------------- Background sensing ----------------
    {phase: 'signal', phaseLabel: 'Sampling', time: 0.5, focus: ['R11', 'C13'],
      title: 'A shared reference voltage',
      plain: 'Measuring with the same ruler that sets the scale: if the ruler stretches, the reading stretches with it and the answer stays the same.',
      what: 'R11 and C13 filter VREF. The same voltage powers the thermistor circuits and serves as the ADC’s measuring scale.',
      why: 'This is a ratiometric measurement: if the supply drifts, the thermistor voltage and the ADC reference drift together, so the temperature reading does not.'},
    {phase: 'signal', phaseLabel: 'Sampling', time: 2.012, focus: ['Q2', 'R12', 'R17'],
      title: 'Thermistors switched on only to read',
      plain: 'A gate that opens for a blink: the thermometers get power for 20 thousandths of a second, just long enough to be read.',
      what: 'Once per second the processor raises D4, transistor Q2 connects the thermistors to ground for about 20 ms, the readings are taken, and Q2 turns off again. R17 keeps Q2 off during reset.',
      why: 'Current flowing through a tiny thermistor warms it slightly. With a signal under 1 °C, even that self-heating matters, so the sensors are powered only while being read. It also saves battery.'},
    {phase: 'signal', phaseLabel: 'Sampling', time: 2.012, focus: ['R21', 'R22', 'R23', 'R24', 'C21', 'C22', 'C23', 'C24'],
      partsLabel: 'R21–R24 · C21–C24',
      title: 'How a thermistor measures temperature',
      plain: 'A thermistor is a resistor that changes with temperature: this type loses about 4% of its resistance for every degree it warms. Paired with a fixed resistor, like two people on a seesaw, that change moves the voltage between them, and the processor reads the voltage.',
      what: 'Each 10 kΩ thermistor sits in a divider with a 10 kΩ, 0.1%, low-drift resistor. As the thermistor warms, its resistance falls and so does the voltage the ADC reads. The capacitors hold the node steady while it is sampled.',
      why: 'Any drift in these fixed resistors would look exactly like a temperature change, so they are 0.1% parts that change only 25 parts per million per °C. The firmware waits 10 ms for the voltages to settle, then averages 64 readings.'},
    {phase: 'signal', phaseLabel: 'Background', time: c => B(c) - 0.5, focus: ['TH1', 'TH3'],
      title: 'Background: record the soil before heating',
      plain: 'Like zeroing a kitchen scale before weighing: note the starting temperature so only our added heat is counted.',
      what: c => 'For ' + B(c) + ' s the side needles are read once per second with the heater off. The average becomes the baseline.',
      why: 'Soil temperature is never perfectly steady (sun, time of day). Subtracting the baseline leaves only the rise caused by the heat pulse.'},
    // ---------------- Heating ----------------
    {phase: 'heat', phaseLabel: 'Heating', time: c => heatOn(c) + 0.4, focus: ['Q1', 'R9', 'R10'],
      title: 'The heater switch turns on',
      plain: 'Q1 is a gate: a tiny signal from the brain opens it, and the big heater current rushes through. Flicking it on and off 100 times a second sets how much heat comes out, like a dimmer.',
      what: c => 'D9 goes high; through R9 it turns on transistor Q1, which completes the heater circuit to ground. Q1 is switched at 100 Hz, on ' + c.config.dutyPct + '% of the time, to set the heating power.',
      why: 'The processor pin cannot carry heater current, so it only drives Q1’s gate. Switching (instead of a regulator) trims the raw battery voltage with almost no wasted heat. R10 holds the gate low whenever the processor is off or resetting: a heater stuck on could damage the sensor.'},
    {phase: 'heat', phaseLabel: 'Heating', time: c => heatOn(c) + 1.5, focus: ['R5', 'U4', 'C12'],
      title: 'Measure the heat actually delivered',
      plain: 'An electricity meter: a tiny, precisely known resistor turns the flow of current into a small voltage that U4 reads, like a flow meter in a pipe.',
      what: c => 'All heater current flows through R5, a 0.1 Ω shunt. U4 (INA226) measures the tiny voltage across it (about ' + f(c.run.electrical.onCurrentA * 100, 0) + ' mV) and the heater voltage, giving current and power.',
      why: 'Heat capacity is calculated from the heat released per meter of heater. Any error in that energy becomes the same percentage error in heat capacity (and in the moisture estimated from it), and battery voltage varies from about 12 to 14 V. So the board measures the energy instead of assuming it.'},
    {phase: 'heat', phaseLabel: 'Heating', time: c => heatOn(c) + 5, focus: RH, partsLabel: 'RH1–RH17',
      title: 'Seventeen resistors make a line heater',
      plain: 'Why a resistor gets hot: pushing current through it is like forcing water through a narrow pipe. The “friction” turns electrical energy into heat, and the heat grows with the square of the current (power = current² × resistance).',
      what: c => '17 small 3.3 Ω resistors in series run along ~43 mm of the center prong. Together they release about ' + f(c.run.electrical.heaterPowerW, 2) + ' W, roughly ' + f(c.run.electrical.heaterPowerW / 0.0432, 0) + ' W per meter of needle.',
      why: 'Why 12 V: heating power rises with the square of the voltage (power = voltage² ÷ resistance). From 12 V this 56 Ω chain makes about 2.3 W; from 5 V it would make only about 0.45 W, too little for a clear rise in a short pulse. Field stations already run on 12 V batteries, so the heater uses that raw battery voltage, trimmed by switching. Heat-pulse theory assumes a thin line heater, and resistors spread evenly along the prong approximate that line, on a machine-assembled board instead of hand-wound heater wire.'},
    {phase: 'heat', phaseLabel: 'Heating', time: c => heatOff(c) - 0.5, focus: ['TH2', 'RH15', 'RH16', 'RH17'],
      title: 'Heat spreads into the soil',
      plain: 'Like ripples from a stone dropped in a pond, a warm front moves outward from the heater.',
      what: 'The color map shows the soil warming around the heater. TH2 sits just past the last heater resistor, near the tip.',
      why: 'TH2 confirms the heater really ran: a diagnostic, not the main signal. The warm plume is what reaches the side needles over the next tens of seconds.',
      live: c => 'Soil beside the heater: +' + f(c.state.heatedZoneSoilC - c.config.ambientC, 1) + ' °C · TH2: +' + f(rise(c, 1), 2) + ' °C · energy so far ' + f(c.state.energyJ, 1) + ' J'},
    // ---------------- Cooling ----------------
    {phase: 'cool', phaseLabel: 'Cooling', time: c => heatOff(c) + 0.5, focus: ['Q1'],
      title: 'Heater off, heat keeps traveling',
      plain: 'Like a stove burner turned off: the kitchen keeps warming for a while as the heat spreads.',
      what: 'D9 goes low, Q1 opens and the heater current stops. The thermistors keep being read every second.',
      why: 'Heat needs time to diffuse 8 mm through soil. The side needles are still warming after the heater stops; their peak comes later.',
      live: c => 'Heat delivered: ' + f(c.state.energyJ, 1) + ' J · side needles so far: +' + f(rise(c, 0), 3) + ' °C'},
    {phase: 'cool', phaseLabel: 'Cooling', time: peakTime, focus: ['TH1', 'TH3'],
      title: 'The signal: the side needles peak',
      plain: 'Soil that stores more heat soaks up the pulse on its way, so a smaller rise reaches the needles; soil that conducts heat well delivers it sooner.',
      what: c => 'About ' + f(peakTime(c) - heatOn(c), 0) + ' s after heating began, the needles 8 mm away reach their highest temperature, then slowly cool.',
      why: 'The height of the peak is set mainly by the soil’s volumetric heat capacity, and its timing by how fast heat diffuses. Two side needles give a check on each other.',
      live: c => 'Peak rise: +' + f(rise(c, 0), 3) + ' °C in ' + (c.soil.label || 'this soil')},
    {phase: 'cool', phaseLabel: 'Diagnostics', time: c => c.duration - 1, focus: ['TH4'],
      title: 'Board temperature',
      plain: 'A thermometer for the electronics themselves.',
      what: 'TH4 on the electronics body records the board’s own temperature.',
      why: 'A diagnostic: it can flag unusual electronics temperatures and help correct drift. The twin does not model board heating, so it is not reported here.'},
    // ---------------- Result ----------------
    {phase: 'result', phaseLabel: 'Result', time: c => c.duration, focus: [],
      title: 'From a temperature curve to thermal properties',
      plain: 'Like matching a fingerprint: the physics predicts the curve for every possible soil, and the one that fits the measured curve tells us the soil’s thermal properties.',
      what: 'The recorded rise is fitted with the heat-pulse model, using the measured heater energy and the 8 mm needle spacing. The processor then reports the results to the logger over SDI-12.',
      why: 'One pulse gives the soil’s thermal conductivity, volumetric heat capacity and thermal diffusivity. Water content is then estimated from the heat capacity and the soil’s bulk density.',
      live: c => c.estimate ? 'Sensor estimate: λ ' + f(c.estimate.lambda, 2) + ' W/(m·K), C ' + f(c.estimate.C / 1e6, 2) + ' MJ/(m³·K) (' + (c.estimate.CErrPct >= 0 ? '+' : '') + f(c.estimate.CErrPct, 1) + '% vs the soil)' : ''}
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);
