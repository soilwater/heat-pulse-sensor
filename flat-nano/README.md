# Compact flat sensor — HP-SDI12-NANO

An independent layout of the current flat heat-pulse sensor, built around the Arduino Nano R4 chip. The electronics body is **43.18 × 17.78 mm**, exactly the Arduino Nano R4 PCB outline, with every part on the top side. The WAGO connector is replaced with three plated cable solder holes. The heater is a stronger 0603 chain designed for controlled PWM heating.

## Changes after the electrical-engineering review

These changes answer an electrical-engineering review of the previous layout. The INA226 power monitor is kept; whether to keep it is still open for discussion.

- **Buck regulator instead of the linear regulator:** the HT7550-1 LDO dropped 7–9 V at the full MCU current and heated the board next to the thermistors. U3 is now a TI **LMR36503R5RPER** synchronous buck (fixed 5 V, 3–65 V input, 2.2 MHz, JLC C3190197) with a Sunlord SWPA4020S220MT 22 µH inductor (C82401), 100 nF 50 V input bypass (C307331), and a 22 µF 25 V output capacitor. Its losses are about 10 mW, on the center line.
- **Bulk input capacitor:** C3, 22 µF 25 V X5R 1206 (Samsung CL31A226KAHNNNE, JLC C12891), at the cable input.
- **Q2 removed:** D4 now powers the thermistor dividers and the ADC reference (VREF) through R11, 1.5 kΩ, which keeps the pin within the RA4M1's 4 mA output limit; the thermistors return straight to ground. Sequence unchanged: D4 HIGH, wait 10 ms, read, D4 LOW.
- **32.768 kHz crystal removed** (Y1, C5, C6): the stock Arduino core for the UNO R4 Minima / Nano R4 clocks the CPU and USB from the internal HOCO and the RTC from LOCO; it never uses the crystal.
- **USB routed as a real differential pair:** D+/D− run on the top layer only, 0.30 mm wide with a 0.20 mm gap (about 88 Ω differential on this stackup, inside USB's 90 Ω ±15 %), with no vias, over the solid inner ground plane. The SWD programming pads (J5) are removed: no external programmer is ever needed, because the chip's built-in USB boot mode (BOOT jumper on the clip) reloads the bootloader over the same clip.
- **Heater and battery current copper ≥ 0.5 mm everywhere, with no exceptions:** every trace the heater or battery current flows through, from the cable pad through the reverse-polarity diode, the shunt, the heater chain on the needle and its return, the MOSFET, and the regulator input and output, is at least 0.5 mm of 1 oz copper. The heater feed runs inside the board on the 0.5 oz In2 layer as a 1.2 mm strip, which holds more copper than a 0.5 mm outer trace, and every via on these nets has at least the barrel copper of a 0.5 mm trace. The 5 V and ground connections of the chips go through the inner planes. The three INA226 sense lines are dedicated Kelvin taps and carry no current.
- **Balanced, thermally symmetric layout:** every part that dissipates more than 2 mW (MCU, buck regulator and its inductor, input diode, 5 V OR-ing diode, shunt, heater MOSFET) sits on the board's center line. The three needles are exact mirror images, and both side-needle wires enter the body the same way. On every copper layer, the body's copper left and right of the center line must agree within 10 % (release check). This board: top 3.7 %, inner 0.9 % and 1.5 %, bottom 0.1 %.
- **Hand-planned copper, no auto-router:** every trace and via of the body is drawn deliberately by `kicad/preroute.py`. Signals run straight or at 45°. A signal changes layer only to cross the center line or another signal, and then runs at least 3 mm on the bottom layer. Every via connects copper on two layers.
- **Thermistor pin map** (same on flat-nano and the hat): A2 = TH1 right needle, A1 = TH2 heater-needle tip, A0 = TH3 left needle, A3 = TH4 board body. Left and right are as seen on the top face with the cable end up and the needles pointing down, the way the website draws the board.
- D1, D5 and D7 are Guangdong Hottech 1N5819WS 1 A 40 V Schottky diodes (SOD-323, JLC C191023, a Basic part).

**Use the complete upload set in `fab/`: `HP-SDI12-NANO_gerbers.zip`, `HP-SDI12-NANO_BOM.csv`, and `HP-SDI12-NANO_CPL.csv`. Upload all three together.**

This is the main sensor board. The `hat` folder holds the secondary Nano R4 hat design. The digital twin in `docs/` displays this board.

## Dimensions and construction

| Item | Original flat | Compact variant |
| --- | ---: | ---: |
| Electronics PCB body, excluding prongs | 60 × 18 mm | **43.18 × 17.78 mm** (Arduino Nano R4 outline) |
| Overall PCB, including prongs | 116.68 × 18 mm | **99.86 × 17.78 mm** |
| Board thickness | 0.8 mm | 0.8 mm |
| Copper layers | 2 | **4** |
| Assembly | Top side | Top side |
| Cable connection | WAGO terminal | Three plated solder holes |

The body is 16.82 mm shorter than the original flat board. All three PCB prongs are **1.4 mm wide**, providing clearance for the larger 0603 resistors within the same 12G steel needle. All prong lengths, four thermistor positions and 8 mm needle-center spacing stay unchanged. The heater uses **17 × 3.3 Ω, 1%, Vishay CRCW06033R30FKEAHP**, rated **0.33 W at 70 °C** (JLC **C313752**). Its 56.1 Ω series chain delivers about **2.34 W at 12 V** and **3.41 W at 14.4 V** under the stated cable-loss assumptions. The custom footprint follows the manufacturer's recommended reflow lands at 2.6 mm pitch. R9 is 1.5 kΩ to respect the MCU gate-drive current limit.

Use a nominal **2 W average heater-power target**, **100 Hz hardware PWM**, and **8–15 s** heating windows. At 12 V this is approximately 85% duty, with full power available when a stronger measurement is qualified. This is a firmware specification, **not implemented firmware**. See [HEATER.md](HEATER.md) for exact ratings, power calculations, synchronized current measurement, shutdown requirements and bench acceptance checks.

The 43.18 × 17.78 mm dimension describes the **bare PCB body**. The steel needles span approximately 18.77 mm across their outside surfaces, and the finished enclosure needs room for needle embedment, insulation, epoxy, and cable strain relief.

## Cable connection

J1 is a bare plated-hole feature, omitted from the factory assembly BOM and placement file. Hand-solder the three wires after assembly. There is no solder-paste aperture over these holes.

| J1 pad | Connection | Identification |
| --- | --- | --- |
| 1 | Battery +12 V | Middle pad, square, on the center line; `12V` label on underside |
| 2 | SDI-12 signal | Outer pad beside the `SDI` label on the underside |
| 3 | Ground / battery negative | Other outer pad, beside the `GND` label on the underside |

The holes have 1.2 mm nominal finished diameter, 2.4 mm copper pads, and 4 mm spacing. Use 22 AWG stranded wires with neatly tinned ends that enter freely. The nearest pad copper is 0.6 mm from the board end. Keep the cable jacket anchored in the housing or potting so cable pull does not reach the pads.

## Programming

J2 is a row of five bare holes on the long edge for an off-the-shelf 2.54 mm 5-pin pogo clip: 5V, D−, D+, GND, BOOT. Plug a "USB to 4-pin Dupont" cable onto the clip and the board is an "Arduino UNO R4 Minima" in the Arduino IDE. BOOT is used only for the very first bootloader load or for recovery: fit a jumper cap across clip pins 4–5 while plugging in. All 68 fitted components are on the top side; J1 and J2 are bare connection features.

## Files and checks

- `kicad/hp_sensor_routed.kicad_pcb`: the routed PCB.
- `kicad/hp_sensor.kicad_sch`: corresponding schematic.
- `kicad/placement.json`: component locations.
- `kicad/preroute.py`: every trace, via and pour of the body, drawn by hand plan.
- `checks/check_quality.py`: layout-quality gate for the review rules: current-path copper width, mirrored needles, left/right copper balance, heat sources on the axis, routing style (no short via-to-via jumpers, no jogs, no acute turns, no via without a purpose, no top copper under the inductor or deep under the MCU) and the USB pair.
- `kicad/export_view.py` and `kicad/plot_view.py`: layer-by-layer review drawings of the routed board.
- `preview/index.html`: dimension comparison and top/bottom assembly views.
- `fab/`: current manufacturing outputs (Gerbers, BOM, CPL, schematic PDF, renders and order settings), generated only after the release checks pass. `release.py` also writes `fab/RELEASE_MANIFEST.txt` with SHA-256 hashes of the checked board and outputs.

The release process requires zero ERC findings, zero DRC findings at all severities with zero unconnected items, schematic/PCB parity, dedicated Kelvin connections for all three current-monitor sense pins, no courtyard overlap, reserved soldering space around J1, and a pass of the layout-quality gate. A separate check keeps ordinary via holes clear of all exterior solder openings, including the cable and programming pads, to avoid solder wicking; this design does not assume filled/capped vias. This is a verified layout package; no assembled hardware has been tested.

From the project root, rebuild, check and export with:

```powershell
& 'D:/KiCAD/bin/python.exe' 'flat-nano/kicad/release.py'
```

Add `--verify-existing` to check and export the existing routed board without rebuilding it. Run with KiCad's Python environment, not a generic Python installation. This variant supports the current 12G configuration only.

## Manufacturing and assembly

Use **4-layer FR-4, 0.8 mm nominal thickness, 1 oz outer copper / 0.5 oz inner copper, green solder mask, white silkscreen, lead-free HASL finish, tented vias, and Standard PCBA on the top side only**. Select the standard **JLC04081H-7628** construction. No controlled-impedance certification is requested. The layer order is front signals, inner ground, inner +5 V (which also carries the 1.2 mm heater feed along the center line), and back signals. Both inner planes stop inside the electronics body; the needles retain their original two-sided copper construction. Unused inner via pads are removed. Keep the supplied finished-hole sizes and the needle-prong outline. Body signals are 0.2 mm wide with at least 0.127 mm clearance, and ordinary vias use 0.35 mm holes with 0.60 mm pads. Only the two heater-needle thermistor lanes use 0.09 mm traces, and the heater-needle thermistor uses two 0.30 mm-hole vias with 0.50 mm pads. The narrower paths retain the full clearance rules and fit the factory's standard multilayer capabilities.

The Gerber ZIP, BOM, and CPL must be used together from this variant's `fab/` folder. Review the supplier's component-orientation preview for this placement, in particular the polarity of D1, D5 and D7 and pin 1 of U1, U3 and U4. These local file changes do not replace files in an existing JLCPCB order; upload the three files together before production.

Any factory support tabs must be removed flush from the needle-insertion edges. Use steel needles with a measured **minimum 2.16 mm internal bore**. The heater fit calculation allows a 0.9 mm maximum PCB thickness, 1.6 mm maximum manufactured heater-prong width, 0.95 × 0.65 mm maximum resistor-plus-solder envelope and a **25 µm total radial liner including adhesive, without overlap**. Dry-fit the insulated assembly before potting; PCB thickness, routed edges, component height, and solder thickness all affect the fit. Layout checks do not replace the first assembled unit's power, programming, communication, and heating tests.

For this narrow, fork-shaped board, use **Standard PCBA with custom panel design through JLCPCB engineering and temporary supports**. The ordinary automatic Panel by JLCPCB service is not suitable for this fork-shaped outline; request the custom engineering service using the order remarks. Its minimum assembly panel is 70 × 70 mm; ordinary 5 mm rails around this 99.86 × 17.78 mm outline do not meet that width. The detailed Economic PCBA combinations do not include this four-layer, 0.8 mm construction. Request tooling holes, fiducials, and supports on the factory panel, with the sensors delivered separately and all remnants removed flush from needle-insertion edges. These supports are not part of the 43.18 × 17.78 mm finished body. Use the exact wording and settings in `fab/ORDER_SETTINGS.md`. See [assembly capabilities](https://jlcpcb.com/capabilities/pcb-assembly-capabilities) and [panel requirements](https://jlcpcb.com/capabilities/Capabilities).

The explicit stack follows [JLCPCB's published 0.8 mm JLC04081H-7628 construction](https://jlcpcb.com/impedance): 0.035 mm outer copper, 0.2104 mm 7628 prepreg, 0.0152 mm inner copper, 0.250 mm core, 0.0152 mm inner copper, 0.2104 mm 7628 prepreg, and 0.035 mm outer copper. The 0.0152 mm inner value belongs to the factory's nominal 0.5 oz option. The solder-mask model uses the published 0.01524 mm above-copper thickness on each side. Their combined model is 0.80168 mm; the specified finished thickness remains nominal 0.8 mm with the factory's published ±0.1 mm tolerance. The Gerber job records these published construction dimensions without claiming controlled impedance or a measured loss tangent.

For durable soil service, fully encapsulate the assembled electronics and cable entry using electrically insulating, low-water-absorption potting suitable for electronics. Insulate copper from the steel needles, anchor the cable mechanically, and dry-fit each assembled prong before potting. The surface finish and solder mask do not replace waterproof encapsulation.

Select **Board Cleaning: No**: the Murata NCP15 thermistors must not be cleaned after no-clean flux. Do not solvent-wash, dry-ice-clean or ultrasonically clean the assembled board. Follow the component-specific cleaning and potting guidance and the 500-character assembly remark in [ORDER_SETTINGS.md](fab/ORDER_SETTINGS.md). Evaluate the chosen potting process on a finished sensor before encapsulating the batch.

The separate solder-opening check also found ordinary via holes overlapping SMD solder openings in the original flat PCB. Those locations are corrected in this compact layout. The original board and its manufacturing files were deliberately preserved; this release does not certify their soldering geometry.

Dimension reference: [Arduino Nano R4 datasheet, mechanical drawing](https://docs.arduino.cc/resources/datasheets/ABX00142-datasheet.pdf). Manufacturing reference: [JLCPCB capabilities](https://jlcpcb.com/capabilities/Capabilities), including 0.8 mm board thickness tolerance ±0.1 mm, regular routed dimensions ±0.2 mm, and plated-hole tolerance +0.13/−0.08 mm.
