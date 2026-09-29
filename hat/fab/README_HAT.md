# HP-HAT — compact heat-pulse sensor for Arduino Nano R4

The hat applies the same review rules as flat-nano, at the exact Arduino Nano R4 footprint:

- **Nano outline and pins.** The body is exactly the Nano R4 PCB outline, **43.18 × 17.78 mm**, with the Nano's two pin rows at their exact positions. To fit, parts sit on **both faces**. The top face, toward the Nano, carries low parts inside the 4 mm gap. The bottom face, outward, carries the power stage, INA226 and thermistor dividers, which the potting covers.
- **Power copper.** Every trace carrying heater, battery or Nano-supply current is at least 0.5 mm on the outer layers, with no narrower neck. The heater supply (VIN_P) and the Nano supply (NANO_VIN) run inside the board as 1.2 mm strips on the 0.5 oz In2 layer, which is more copper than 0.5 mm of 1 oz outer copper. Every via on those nets has a barrel at least equal to that trace. The cable ground hole and both Nano ground pins connect to the pours through 0.5 mm spokes.
- **Heat on the axis.** Every part dissipating more than 2 mW sits on the center line: D1, R18, R5 and Q1.
- **Balanced left and right.** The three needles are exact mirror images, and both side-needle wires enter the body the same way. On every copper layer, the body's copper left and right of the center line must agree within 10 % (release check). This board: top 7.2 %, inner 0.5 % and 3.2 %, bottom 6.7 %. To help the top side balance, the right-needle (TH1) and tip (TH2) thermistor wires run north of the center line and the left-needle (TH3) wire south of it.
- **Hand-planned copper.** Every trace and via of the body is placed by `kicad/preroute.py`, and `kicad/gen_pcb.py` draws the needle copper, identical to flat-nano; no auto-router. Signals run straight or at 45°, and a via appears only where a signal changes layer.

Carried over from the previous hat circuit: bulk input capacitor C3 (22 µF 25 V 1206), no Q2 thermistor switch (D4 drives the dividers and AREF through R11, now 1.5 kΩ so the pin stays within the RA4M1's 4 mA output limit), and the SMF15CA input TVS.

Needles, needle copper and the heater and needle thermistors are identical to flat-nano; both bodies are the 43.18 × 17.78 mm Nano outline. The complete bare PCB outline is **99.86 × 17.78 mm**. It uses **four copper layers, 0.8 mm nominal thickness and lead-free HASL**. The flat-nano files are only read, never changed.

Use a **headerless Arduino Nano R4, ABX00142**, with its components facing the hat's top face across a **4.00 mm gap**. Two **Samtec HTSW-115-07-T-S** strips are soldered to both boards, making a permanent compact stack. The field cable is soldered into J1's three holes from the hat's outer face. Ordinary loose pins held by epoxy are not reliable electrical contacts.

The parts on the hat's outer face add up to 1.55 mm there. That puts the nominal potted stack at **10.49 mm with 1 mm of epoxy over each face**, so the 10.5 mm body target is met only nominally. Before committing a mold, check the first assembly and choose between a thinner cover over the hat's outer face and a thicker mold. See the [assembly guide and drawing](../mechanical/ASSEMBLY.md) for dimensions, part sources, wire routing and tolerances.

## Manufacturing files

Use these three files together:

| File | JLCPCB upload |
| --- | --- |
| `HP-HAT_gerbers.zip` | PCB Gerbers (includes top and bottom paste) |
| `HP-HAT_BOM.csv` | Assembly BOM |
| `HP-HAT_CPL.csv` | Assembly placement, top and bottom |

[ORDER_SETTINGS.md](ORDER_SETTINGS.md) contains the factory selections and a remark below 500 characters. The PCB has **49 factory-fitted components**:

- **28 on the top face:** the 17 heater resistors, the three needle thermistors, shunt R5, bulk capacitor C3, the SDI-12 protection (R3, R4, C4, D4) and the I2C pull-ups R6 and R7.
- **21 on the bottom face:** D1, D2, C1, C17, R18, Q1, R9, R10, U4, C12, R11, C13, TH4 and the divider bank R21–R24 and C21–C24.

J1, J3 and J4 are deliberately excluded from the assembly BOM/CPL; fit the wires, headers and Nano after delivery. Purchase the Nano and two HTSW strips separately; they are not supplied by this JLCPCB package.

The editable board is `../kicad/hp_hat_routed.kicad_pcb`. Its matching schematic is `../kicad/hp_hat.kicad_sch`. Changes belong in the generators, `placement.json` and `preroute.py`, so that rebuilding preserves the design. Run `D:\KiCAD\bin\python.exe hat/kicad/release.py` from the project folder to regenerate, check and export. `--verify-existing` checks and exports the existing routed board without rebuilding it.

## Operation and shared components

Use the intended clean **12 V battery/logger supply, normally 11.5–14.4 V**, with **8–15 s heater pulses**. RH1–RH17 are the same heater as flat-nano: Vishay **CRCW06033R30FKEAHP**, 17 × 3.3 ohm 0603 in series, nominally 56.1 ohm, 0.33 W each at 70 °C. Full-on at 12 V is roughly 2.3–2.5 W; the intended default is 2 W average via 100 Hz PWM with a hard 15 s limit. See `flat-nano/HEATER.md` for the power, derating and needle-fit calculations. Use INA226 measurements to calculate delivered energy. Resistor tolerance, temperature, potting and pulse repetition still matter; these calculations are not a completed thermal qualification.

D2 retains the hat's SMF15CA, the intentional exception to the flat-nano shared BOM, for the Nano supply branch. The Nano's regulator supplies the 5 V circuits. R18 is a filter resistor, not an overvoltage regulator; D2 does not guarantee protection against every surge above the Nano's allowed input. This is the battery/logger configuration, not a lightning-qualified input. USB alone can power logic but cannot power the battery-fed heater.

| Nano pin | Function |
| --- | --- |
| D2 | SDI-12 data |
| D4 | Powers the thermistor dividers and AREF through R11; HIGH enables |
| D9 | Heater gate, HIGH enables |
| A0 / A1 / A2 | Left / heater-tip / right thermistors (TH3 / TH2 / TH1), the same map as flat-nano. Left and right are as seen on the top face (toward the Nano) with the cable end up and the needles pointing down; from the outer face they appear swapped. |
| A3 | Body thermistor TH4 |
| A4 / A5 | INA226 I2C SDA / SCL, address 0x40 |
| AREF (B0 on pinout) | Thermistor reference, driven from D4 through R11 |
| 5V | Supplies the INA226 and the I2C pull-ups |
| VIN | From the protected battery supply through R18 (22 ohm) |
| GND | J3.12 (digital row) and J4.14 (analog row) |
| BOOT (B1) | Unconnected on the hat |

The connector rows are checked for the face-inward orientation: J3 digital row at +7.62 mm, J4 analog/power row at −7.62 mm. USB faces the cable end. This design is specifically for the Nano R4; a classic Nano, Nano Every or a reversed Nano is not the intended assembly.

## Checks and first assembly

The release procedure checks schematic/PCB parity, ERC, and DRC at all severities. It also checks all three Kelvin sense connections and via-hole separation from solder openings on both faces. The layout quality gate covers power copper, mirrored needles, left/right copper balance, heat sources on the axis and routing style. The remaining checks cover component courtyards on both faces, all four copper layers and the inner-plane assignments. They confirm the exact Nano outline, the needles against flat-nano, and BOM/CPL/Gerber consistency for both assembly sides. The procedure separately verifies 30 Nano contact positions/nets and conservative envelopes for the parts facing the Nano. The smallest separation after the documented allowances is **0.495 mm**, against a 0.40 mm minimum.

These are CAD/manufacturing checks, not proof of a functioning potted sensor. Before potting the first unit:

1. Assemble and measure the 4.00 mm gap and finished height, including the hat's outer-face parts and wire terminations. Check needle fit with the actual tubing and electrical insulation.
2. Upload firmware through the Nano's USB-C port. The repo contains hardware instructions, not a validated hat firmware release. Firmware must select the external ADC reference and 14-bit readings, control excitation settling, force heating off on timeout/fault, and enforce the maximum 15 s pulse and input-voltage limit. Do not heat above 15 V input; normal operation is the battery range stated above.
3. Verify all four temperature readings, heater voltage/current and energy, heater-off behavior and communication with the actual logger/cable. The direct SDI-12 GPIO receive threshold is not guaranteed for every compliant sender; verify the intended Campbell setup.
4. Recheck readings after a trial potting cure. The Nano has its own regulator and LEDs, so its standby consumption differs from the flat sensor; measure it and use logger-switched power where practical.

Do not wash the whole assembly: the selected Murata thermistors require the specified no-clean process. Pot only tested assemblies using compatible materials. USB access is for programming before final encapsulation; this version has no exposed waterproof USB connector.
