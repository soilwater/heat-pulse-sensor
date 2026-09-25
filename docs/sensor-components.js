/* Component explanations for the current compact Nano-body r2 / 3.3 ohm PCB.
 * Sources: flat-nano/kicad/netlist.json and flat-nano/fab/HP-SDI12-NANO_BOM.csv.
 * Browser: SensorComponents.getComponentInfo(ref, footprint).
 * Node: require('./sensor-components').getComponentInfo(ref, footprint).
 */
(function (root) {
  'use strict';

  const roles = {
    J1: ['Battery and data solder pads', 'Pin 1 brings battery power in, pin 2 carries SDI-12 data, and pin 3 is the common ground return. The logger requests a measurement and retrieves its results over the data line.'],
    J2: ['USB programming pads', 'Five bare fixture connections provide USB power, D−, D+, ground, and boot selection. USB can power the electronics through D5, but cannot power the heater.'],
    J5: ['Debug and recovery pads', 'These bare fixture connections expose ground, the logic rail, SWDIO, SWCLK, and reset. A suitable debug probe can program or recover the controller.'],
    U1: ['Controller', 'The RA4M1 uses D9 to command the heater, D4 to enable thermistor readings, A0–A3 to measure temperatures, and I²C to read U4. Its pins drive the switch gates; heater current does not pass through the controller.'],
    U3: ['5 V regulator', 'Converts protected battery power at VIN_P to the 5V_LDO rail for the electronics. Heater current bypasses this regulator, and D7 lowers the voltage reaching the shared logic rail.'],
    U4: ['Current and voltage monitor', 'The INA226 measures the millivolt drop across R5 and the HEAT_P voltage, then sends readings over I²C. Its sense inputs do not carry heater current. Proposed PWM firmware must synchronize single-shot readings with a settled ON interval; multiplying asynchronous averages can give incorrect power. Bus voltage times current includes downstream copper and Q1 losses as well as resistor heating.'],
    Q1: ['Heater switch', 'D9 drives this MOSFET through R9, connecting HEAT_RTN to ground and completing the battery–heater circuit. Setting D9 LOW stops normal heating, but cannot turn off a physically shorted MOSFET.'],
    Q2: ['Thermistor ground switch', 'D4 drives this MOSFET through R12 to connect the four thermistor dividers to ground. VREF stays powered; wait for the ADC nodes to settle, read them, then turn Q2 off to reduce self-heating.'],
    D1: ['Battery protection diode', 'Conducts from VIN to VIN_P and blocks reversed battery polarity. Both the heater and electronics draw through it, so its load-dependent forward drop reduces the available voltage.'],
    D2: ['Input transient suppressor', 'This bidirectional TVS connects VIN to ground and limits short voltage transients within its ratings. It is not a regulator or a sustained-overvoltage cutoff.'],
    D4: ['Data-line transient suppressor', 'This bidirectional protection diode connects the SDI-12 line to ground to limit transients within its ratings. It does not correct the mismatch between the MCU receive threshold and the minimum allowed SDI-12 high level.'],
    D5: ['USB isolation diode', 'Conducts from VUSB to the shared logic rail while blocking battery-powered logic from feeding the USB supply. USB-only power does not reach the heater chain.'],
    D7: ['Regulator isolation diode', 'Conducts from 5V_LDO to the shared logic rail and prevents USB power from back-feeding the regulator output. Its forward drop makes the battery-powered logic rail lower than the regulator’s nominal 5 V.'],
    R1: ['Reset pull-up', 'Pulls RESET high for normal operation. Together with C11, it filters the reset node; the recovery fixture can pull it low.'],
    R2: ['Boot-mode pull-up', 'Pulls MD high for normal boot. The programming fixture can pull MD low to request the MCU boot mode.'],
    R3: ['SDI-12 series resistor', 'This 1.5 kΩ resistor connects the MCU data pin to the SDI-12 line and limits transmit and fault current. The receiver is still the MCU input, so guaranteed bus-level compatibility remains a hardware consideration.'],
    R4: ['SDI-12 idle resistor', 'This 220 kΩ resistor connects the SDI-12 line to ground. It sets the line’s weak idle bias when the MCU releases it.'],
    R5: ['Heater current shunt', 'Every ampere through the heater passes through this 0.1 Ω, 1% resistor. U4 uses separate sense connections to measure its drop: current equals voltage drop divided by 0.1 Ω.'],
    R6: ['I²C data pull-up', 'Pulls A4_SDA toward the logic rail when the controller and INA226 release the data line. It carries signal current, not heater current.'],
    R7: ['I²C clock pull-up', 'Pulls A5_SCL toward the logic rail when the clock line is released. It carries signal current, not heater current.'],
    R9: ['Heater gate resistor', 'Connects D9, physical U1 pin 29, to Q1’s gate through 1.5 kΩ. It limits gate-charging current; it is outside the heater’s main current path.'],
    R10: ['Heater gate pull-down', 'Connects Q1’s gate to ground through 100 kΩ so the heater stays off while D9 is high impedance, including during reset. It cannot clear a drain-to-source short in Q1.'],
    R11: ['Reference filter resistor', 'Feeds VREF through 10 Ω and works with C13 to filter the reference supply. The ADC and thermistor dividers share VREF for ratiometric readings, while their current causes a small drop across R11.'],
    R12: ['Thermistor gate resistor', 'Connects D4, physical U1 pin 45, to Q2’s gate through 1.5 kΩ. The proposed reading sequence keeps Q2 on only long enough to settle and acquire the four temperatures.'],
    R14: ['NMI pull-up', 'Holds the non-maskable interrupt input high through 5.1 kΩ. This gives the otherwise unused input a defined level.'],
    R15: ['USB-detect upper resistor', 'Connects VUSB to VBUS_SENSE through 5.1 kΩ. Together with R16 it signals USB presence to U1 pin 16; it draws no battery current through this divider when USB is absent.'],
    R16: ['USB-detect lower resistor', 'Connects VBUS_SENSE to ground through 10 kΩ. Together with R15 it divides the USB supply and holds the detect input low when USB is absent.'],
    R17: ['Thermistor gate pull-down', 'Connects Q2’s gate to ground through 100 kΩ. It keeps the thermistor return disconnected while D4 is high impedance or the controller is resetting.'],
    C1: ['Protected-input capacitor', 'Stores charge between VIN_P and ground to reduce local input ripple. It supports the regulator and heater input but is not an overvoltage cutoff.'],
    C2: ['Regulator-output capacitor', 'Connects 5V_LDO to ground at U3’s output. It supports regulator stability and supplies brief local load changes before D7.'],
    C4: ['SDI-12 edge filter', 'Connects the data line to ground through 3.3 nF and works with the line resistance to slow edges and filter fast disturbances. The selected BOM part uses an X7R dielectric.'],
    C5: ['Crystal input load capacitor', 'Connects XCIN to ground through 18 pF as part of the 32.768 kHz oscillator network. Its capacitance and routing contribute to the crystal’s effective load.'],
    C6: ['Crystal output load capacitor', 'Connects XCOUT to ground through 18 pF as part of the 32.768 kHz oscillator network. Its capacitance and routing contribute to the crystal’s effective load.'],
    C7: ['Controller supply bypass', 'Provides 100 nF between the logic rail and ground near U1’s digital supply. It supplies brief switching currents locally and reduces supply noise.'],
    C8: ['Controller supply bypass', 'Provides 100 nF between the logic rail and ground near another U1 digital supply connection. It supports the controller during fast current changes.'],
    C9: ['Analog supply bypass', 'Provides 100 nF between the logic rail and ground for the MCU analog supply. Quiet power and return routing help the ADC measurements.'],
    C10: ['Core-regulator capacitor', 'Connects the MCU’s VCL core-regulator node to ground through 4.7 µF. This is a regulator support component, not a heater or sensor capacitor.'],
    C11: ['Reset filter capacitor', 'Connects RESET to ground through 100 nF. Together with the R1 pull-up it slows brief disturbances at the reset input.'],
    C12: ['INA226 supply bypass', 'Provides 100 nF from the INA226 supply to ground. It supplies local current transients and reduces noise on U4’s power input.'],
    C13: ['Reference filter capacitor', 'Connects VREF to ground through 1 µF and works with R11 to filter the shared ADC and divider supply. Q2 switches the thermistor return, so VREF remains powered between readings.'],
    C16: ['USB-regulator capacitor', 'Connects VCC_USB to ground through 4.7 µF to support the MCU’s internal USB regulator. VCC_USB is distinct from the incoming USB power net VUSB.'],
    C17: ['Logic-rail capacitor', 'Connects the shared logic rail to ground after the isolation diodes. It buffers short load changes whether the electronics are powered from the battery or USB.'],
    Y1: ['32.768 kHz crystal', 'Provides the MCU subclock when firmware enables and selects it. Fitting the crystal does not automatically make heater timing or software delays use that clock.'],
    TH1: ['Left needle thermistor', 'Its divider measures the side-needle response through A0, physical U1 pin 53, at 8 mm spacing on the actual PCB. Heat can continue reaching this sensor after the heater switches off.'],
    TH2: ['Heater-tip thermistor', 'Its divider connects to A1, physical U1 pin 64, near the center-prong tip beyond the last heater resistor. It does not measure the hottest resistor’s temperature.'],
    TH3: ['Right needle thermistor', 'Its divider measures the opposite side needle through A2, physical U1 pin 63. Symmetric soil gives the same ideal response as TH1; real soil and needle contact can differ.'],
    TH4: ['Board thermistor', 'A diagnostic thermistor on the electronics body, read through A3, physical U1 pin 62. The soil model holds it at ambient because heating of the electronics and PCB is not modeled.']
  };

  function getComponentInfo(ref, footprint) {
    const key = String(ref || '');
    if (Object.prototype.hasOwnProperty.call(roles, key)) {
      return {title: roles[key][0], description: roles[key][1]};
    }
    if (/^RH(?:[1-9]|1[0-7])$/.test(key)) {
      return {title: 'Heater resistor', description: 'One of 17 series-connected 3.3 Ω resistors on the center prong. Every intact resistor carries the same ON current and releases I²R heat during each PWM ON interval. Average heating is ON power times duty; this heat conducts through the PCB, epoxy, and steel into the soil.'};
    }
    if (/^R2[1-4]$/.test(key)) {
      const channel = Number(key.slice(2)) - 1;
      return {title: 'Precision divider resistor', description: 'This 10 kΩ, 0.1% resistor connects VREF to the A' + channel + ' thermistor node. As its NTC warms, thermistor resistance falls and the ADC voltage falls.'};
    }
    if (/^C2[1-4]$/.test(key)) {
      const channel = Number(key.slice(2)) - 1;
      return {title: 'ADC filter capacitor', description: 'This 100 nF capacitor connects the A' + channel + ' thermistor node to ground. The node charges near VREF while Q2 is off and must settle after Q2 turns on before a temperature is accepted.'};
    }
    return {title: 'Support component', description: footprint && typeof footprint.description === 'string' && footprint.description.trim()
      ? footprint.description : 'Inspect this component’s listed pad connections to identify its circuit role. No specific behavior is modeled for it.'};
  }

  // The released BOM has no manufacturer column. These are well-established part-number
  // families; anything not listed returns null rather than a guess.
  const MANUFACTURERS = [
    [/^CL(05|10|21)/, 'Samsung Electro-Mechanics'], [/^CRCW|^WSL/, 'Vishay'],
    [/^0(402|603)W[AG]F/, 'UNI-ROYAL'], [/^CC0402/, 'Yageo'], [/^0402CG/, 'Fenghua (FH)'],
    [/^INA226/, 'Texas Instruments'], [/^AO3400/, 'Alpha & Omega Semiconductor'],
    [/^NCP15XH/, 'Murata'], [/^Q13FC135/, 'Epson'], [/^R7FA4M1/, 'Renesas'],
    [/^PESD5V0/, 'Nexperia'], [/^HT75/, 'Holtek']
  ];
  function manufacturerOf(mpn) {
    const hit = MANUFACTURERS.find(([re]) => re.test(String(mpn || '')));
    return hit ? hit[1] : null;
  }

  const api = {getComponentInfo, manufacturerOf};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SensorComponents = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
