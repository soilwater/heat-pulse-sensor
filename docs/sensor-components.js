/* Component explanations for the current compact Nano-size flat-nano PCB (17 x 3.3 ohm heater).
 * Sources: flat-nano/kicad/netlist.json and flat-nano/fab/HP-SDI12-NANO_BOM.csv.
 * Browser: SensorComponents.getComponentInfo(ref, footprint), SensorComponents.manufacturerOf(mpn, lcsc).
 * Node: require('./sensor-components').getComponentInfo(ref, footprint).
 */
(function (root) {
  'use strict';

  const roles = {
    J1: ['Cable solder holes', 'Three plated holes take the logger cable, hand-soldered after assembly. Pad 1, the square middle hole on the board’s center line, brings +12 V battery power in; pad 2, an outer hole, carries SDI-12 data; pad 3, the other outer hole, is the common ground return (each hole is labeled on the underside: 12V, SDI and GND). The logger requests a measurement and retrieves its results over the data line.'],
    J2: ['Programming clip holes', 'Five bare holes for an off-the-shelf 2.54 mm 5-pin pogo clip: 1 = 5 V (VUSB), 2 = D−, 3 = D+, 4 = ground, 5 = BOOT. With a USB-to-Dupont cable the board appears as an Arduino UNO R4 Minima. A jumper across clip pins 4–5 while plugging in selects the chip’s built-in USB boot mode, for the first bootloader load or for recovery. USB can power the electronics through D5, but cannot power the heater.'],
    U1: ['Processor', 'The RA4M1 (the Arduino Nano R4 chip) uses pin D9 to switch the heater through Q1, pin D4 to power the thermistor dividers and ADC reference through R11, A0–A3 to measure temperatures, and I²C to read U4. It has no clock crystal: the processor and USB run from its internal oscillator. Only pin D9 drives a switch gate; heater current never passes through the processor.'],
    U3: ['5 V buck regulator', 'A TI LMR36503 synchronous buck converter. It switches protected battery power at VIN_P through L1 at up to 2.2 MHz (fewer pulses at light load) to make a fixed 5 V (5V_BUCK), smoothed by C2. It wastes only about 10 mW, where a linear regulator would drop 7–9 V as heat, and it sits on the board’s center line. It runs whenever the battery is connected. Heater current bypasses this regulator, and D7 lowers the voltage reaching the shared logic rail.'],
    U4: ['Power monitor', 'The INA226 measures the millivolt drop across R5 and the HEAT_P voltage, then sends readings over I²C. Its sense inputs do not carry heater current. Proposed PWM firmware must synchronize single-shot readings with a settled ON interval; multiplying asynchronous averages can give incorrect power. Bus voltage times current includes downstream copper and Q1 losses as well as resistor heating.'],
    L1: ['Buck inductor', 'A 22 µH Sunlord power inductor (4 × 4 mm, 0.62 A saturation) between U3’s switch node (SW) and the 5 V output. It stores energy during each switching cycle (up to 2.2 MHz) and, with C2, smooths the pulses into a steady 5 V. It carries only electronics current and sits on the board’s center line.'],
    Q1: ['Heater switch', 'Pin D9 drives this MOSFET through R9, connecting HEAT_RTN to ground and completing the battery–heater circuit. Setting pin D9 LOW stops normal heating, but cannot turn off a physically shorted MOSFET.'],
    D1: ['Battery protection diode', 'Conducts from VIN to VIN_P and blocks reversed battery polarity. Both the heater and electronics draw through it, so its load-dependent forward drop reduces the available voltage.'],
    D2: ['Input transient suppressor', 'This bidirectional TVS connects VIN to ground and limits short voltage transients within its ratings. It is not a regulator or a sustained-overvoltage cutoff.'],
    D4: ['Data-line transient suppressor', 'This bidirectional protection diode connects the SDI-12 line to ground to limit transients within its ratings (this is part D4, not the processor’s pin D4). It does not correct the mismatch between the processor receive threshold and the minimum allowed SDI-12 high level.'],
    D5: ['USB isolation diode', 'Conducts 5 V from the programming clip (J2 hole 1, VUSB) to the shared logic rail while blocking battery-powered logic from feeding the USB supply. USB-only power does not reach the heater chain.'],
    D7: ['Regulator isolation diode', 'Conducts from the buck output (5V_BUCK) to the shared logic rail and prevents USB power from back-feeding the regulator output. Its forward drop makes the battery-powered logic rail lower than the regulator’s nominal 5 V.'],
    R1: ['Reset pull-up', 'Pulls RESET high through 10 kΩ for normal operation. Together with C11 it filters the reset node. No external hole reaches RESET; recovery uses J2’s BOOT hole.'],
    R2: ['Boot-mode pull-up', 'Pulls MD high through 10 kΩ for normal boot. A jumper across programming-clip pins 4–5 (GND and BOOT) while plugging in pulls MD low and selects the chip’s built-in USB boot mode, for the first bootloader load or for recovery.'],
    R3: ['SDI-12 series resistor', 'This 1.5 kΩ resistor connects the processor data pin to the SDI-12 line and limits transmit and fault current. The receiver is still the processor input, so guaranteed bus-level compatibility remains a hardware consideration.'],
    R4: ['SDI-12 idle resistor', 'This 220 kΩ resistor connects the SDI-12 line to ground. It sets the line’s weak idle bias when the processor releases it.'],
    R5: ['Heater current shunt', 'Every ampere through the heater passes through this 0.1 Ω, 1% resistor. U4 uses separate sense connections to measure its drop: current equals voltage drop divided by 0.1 Ω.'],
    R6: ['I²C data pull-up', 'Pulls A4_SDA toward the logic rail when the processor and INA226 release the data line. It carries signal current, not heater current.'],
    R7: ['I²C clock pull-up', 'Pulls A5_SCL toward the logic rail when the clock line is released. It carries signal current, not heater current.'],
    R9: ['Heater gate resistor', 'Connects pin D9, physical U1 pin 29, to Q1’s gate through 1.5 kΩ. It limits gate-charging current to within the chip’s 4 mA pin limit; it is outside the heater’s main current path.'],
    R10: ['Heater gate pull-down', 'Connects Q1’s gate to ground through 100 kΩ so the heater stays off while pin D9 is high impedance, including during reset. It cannot clear a drain-to-source short in Q1.'],
    R11: ['Thermistor excitation resistor', 'Connects pin D4 (physical U1 pin 45, D4_EXC) to VREF through 1.5 kΩ. When pin D4 goes HIGH it charges C13 and powers VREF, which feeds all four thermistor dividers and the ADC reference. It limits the pin to about 3.3 mA at most (5 V ÷ 1.5 kΩ) while C13 charges, within the chip’s 4 mA per-pin limit. The divider current leaves VREF at roughly 3.5–3.7 V at 25 °C, which does not matter because the dividers and the ADC share VREF (ratiometric readings). With pin D4 LOW the thermistors are unpowered.'],
    R14: ['NMI pull-up', 'Holds the non-maskable interrupt input high through 5.1 kΩ. This gives the otherwise unused input a defined level.'],
    R15: ['USB-detect upper resistor', 'Connects VUSB to VBUS_SENSE through 5.1 kΩ. Together with R16 it signals USB presence to U1 pin 16. It is fed from the programming clip only, so it draws no battery current in the field.'],
    R16: ['USB-detect lower resistor', 'Connects VBUS_SENSE to ground through 10 kΩ. Together with R15 it divides the USB supply and holds the detect input low when USB is absent.'],
    C1: ['Buck input capacitor', 'Connects VIN_P to ground through 4.7 µF, 50 V, at U3’s input (the datasheet minimum). It supplies the regulator’s switching current locally. C3 supplies the heater’s sudden current steps locally and C18 bypasses the highest frequencies; none of them is an overvoltage cutoff.'],
    C2: ['Buck output capacitor', 'Connects 5V_BUCK to ground through 22 µF, 25 V. With L1 it filters U3’s switching ripple (up to 2.2 MHz) and keeps the regulator loop stable, and it supplies brief load changes before D7.'],
    C3: ['Bulk input capacitor', 'Connects VIN_P to ground through 22 µF, 25 V, near the cable holes. Each time the 100 Hz PWM switches the heater, its current changes by about 0.2 A almost instantly. C3 supplies or absorbs that sudden change locally, so the current in the long cable changes gently; a sharp current step through a long cable makes the supply voltage overshoot and ring.'],
    C4: ['SDI-12 line filter', 'Connects the data line to ground through 3.3 nF. With R3 (1.5 kΩ) and the cable’s resistance it rounds off each voltage switch over a few microseconds (R3 × C4 ≈ 5 µs). On a long cable, sharp switches overshoot and ring, and brief spikes picked up by the cable could be mistaken for data bits; the rounding damps both. Each SDI-12 bit lasts 833 µs (1200 baud), so the data is unaffected. The selected BOM part uses an X7R dielectric.'],
    C7: ['Processor supply bypass', 'Provides 100 nF between the logic rail and ground near U1’s digital supply. It supplies brief switching currents locally and reduces supply noise.'],
    C8: ['Processor supply bypass', 'Provides 100 nF between the logic rail and ground near another U1 digital supply connection. It supports the processor during fast current changes.'],
    C9: ['Analog supply bypass', 'Provides 100 nF between the logic rail and ground for the processor analog supply. Quiet power and return routing help the ADC measurements.'],
    C10: ['Core-regulator capacitor', 'Connects the processor’s VCL core-regulator node to ground through 4.7 µF. This is a regulator support component, not a heater or sensor capacitor.'],
    C11: ['Reset filter capacitor', 'Connects RESET to ground through 100 nF. Together with the R1 pull-up it slows brief disturbances at the reset input.'],
    C12: ['INA226 supply bypass', 'Provides 100 nF from the INA226 supply to ground. It supplies local current transients and reduces noise on U4’s power input.'],
    C13: ['Reference filter capacitor', 'Connects VREF to ground through 1 µF. It charges through R11 each time pin D4 goes HIGH, then steadies the shared ADC reference and divider supply during the reading and, with R11, filters supply noise. VREF is unpowered between readings, so the firmware waits 10 ms after pin D4 goes HIGH before reading.'],
    C16: ['USB-regulator capacitor', 'Connects VCC_USB to ground through 4.7 µF to support the processor’s internal USB regulator. VCC_USB is distinct from the incoming USB power net VUSB.'],
    C17: ['Logic-rail capacitor', 'Connects the shared logic rail to ground through 10 µF after the isolation diodes. It buffers short load changes whether the electronics are powered from the battery or the programming clip.'],
    C18: ['Buck input bypass', 'Connects VIN_P to ground through 100 nF right at U3’s input and ground pins. It supplies the fastest switching currents and is rated 50 V because it sees the full cable voltage.'],
    C19: ['Bootstrap capacitor', 'Connects U3’s BOOT pin to its switch node (SW) through 100 nF. On every switching cycle it lifts the gate drive of the regulator’s internal high-side switch above the input voltage.'],
    C20: ['Regulator supply capacitor', 'Connects VCC_BUCK to ground through 1 µF. It steadies the internal supply that U3 uses to run its own control and gate-drive circuits.'],
    TH1: ['Right needle thermistor', 'Its divider measures the side-needle response through A2, physical U1 pin 63, at 8 mm spacing on the actual PCB. Heat can continue reaching this sensor after the heater switches off.'],
    TH2: ['Heater-tip thermistor', 'Its divider connects to A1, physical U1 pin 64, near the center-prong tip beyond the last heater resistor. It does not measure the hottest resistor’s temperature.'],
    TH3: ['Left needle thermistor', 'Its divider measures the opposite side needle through A0, physical U1 pin 53. Symmetric soil gives the same ideal response as TH1; real soil and needle contact can differ.'],
    TH4: ['Board thermistor', 'A diagnostic thermistor on the electronics body, read through A3, physical U1 pin 62. The soil model holds it at ambient because heating of the electronics and PCB is not modeled.']
  };

  // Thermistor node for each divider pair (R2n, C2n pair with THn), from netlist.json. The pad
  // net of the actual footprint takes precedence; this table is only the fallback.
  const NODE_OF_PAIR = {1: 'A2_TH1', 2: 'A1_TH2', 3: 'A0_TH3', 4: 'A3_TH4'};
  function thermistorNode(key, footprint) {
    const pads = footprint && Array.isArray(footprint.pads) ? footprint.pads : [];
    const net = pads.map(pad => String(pad.net || '')).find(name => /^A\d_TH\d$/.test(name)) || NODE_OF_PAIR[Number(key.slice(2))];
    const [channel, thermistor] = net.split('_');
    return channel + ' / ' + thermistor;
  }

  function getComponentInfo(ref, footprint) {
    const key = String(ref || '');
    if (Object.prototype.hasOwnProperty.call(roles, key)) {
      return {title: roles[key][0], description: roles[key][1]};
    }
    if (/^RH(?:[1-9]|1[0-7])$/.test(key)) {
      return {title: 'Heater resistor', description: 'One of 17 series-connected 3.3 Ω resistors on the center prong. Every intact resistor carries the same ON current and releases I²R heat during each PWM ON interval. Average heating is ON power times duty; this heat conducts through the PCB, epoxy, and steel into the soil.'};
    }
    if (/^R2[1-4]$/.test(key)) {
      return {title: 'Precision divider resistor', description: 'This 10 kΩ, 0.1% resistor connects VREF to the ' + thermistorNode(key, footprint) + ' thermistor node. As its NTC warms, thermistor resistance falls and the ADC voltage falls.'};
    }
    if (/^C2[1-4]$/.test(key)) {
      return {title: 'ADC filter capacitor', description: 'This 100 nF capacitor connects the ' + thermistorNode(key, footprint) + ' thermistor node to ground. The node is at 0 V while pin D4 is LOW. When pin D4 powers VREF, the node charges to the divider voltage and must settle (the firmware waits 10 ms) before a temperature is accepted.'};
    }
    return {title: 'Support component', description: footprint && typeof footprint.description === 'string' && footprint.description.trim()
      ? footprint.description : 'Inspect this component’s listed pad connections to identify its circuit role. No specific behavior is modeled for it.'};
  }

  // The current BOM (flat-nano/fab/HP-SDI12-NANO_BOM.csv) has no manufacturer column. These are
  // well-established part-number families; anything not listed returns null rather than a guess.
  const MANUFACTURERS = [
    [/^CL(05|10|21|31)/, 'Samsung Electro-Mechanics'], [/^CRCW|^WSL/, 'Vishay'],
    [/^0(402|603)W[AG]F/, 'UNI-ROYAL'], [/^CC0402/, 'Yageo'],
    [/^(INA226|LMR3)/, 'Texas Instruments'], [/^AO3400/, 'Alpha & Omega Semiconductor'],
    [/^NCP15XH/, 'Murata'], [/^R7FA4M1/, 'Renesas'], [/^SWPA/, 'Sunlord'],
    [/^PESD5V0/, 'Nexperia']
  ];
  // Generic part numbers made by several companies: the maker is taken from the exact LCSC
  // listing instead (checked on LCSC for each code below).
  const MANUFACTURERS_BY_LCSC = {
    C22624: 'JSCJ (Jiangsu Changjing)',          // B5819WS Schottky diodes D1, D5, D7
    C123805: 'MDD (Microdiode Semiconductor)',  // SMF16CA input TVS D2
    C54973934: 'SIE',                           // CRF0603Q103BN 0.1% reference resistors R21-R24
  };
  function manufacturerOf(mpn, lcsc) {
    const code = String(lcsc || '');
    if (Object.prototype.hasOwnProperty.call(MANUFACTURERS_BY_LCSC, code)) return MANUFACTURERS_BY_LCSC[code];
    const hit = MANUFACTURERS.find(([re]) => re.test(String(mpn || '')));
    return hit ? hit[1] : null;
  }

  const api = {getComponentInfo, manufacturerOf};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SensorComponents = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
