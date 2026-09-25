# HP-HAT r4 — compact heat-pulse sensor for Arduino Nano R4

The hat now has the same **43.18 × 17.78 mm body**, needle outline and heater/sensing components as the submitted `flat-nano` reference. The complete bare PCB outline is **99.86 × 17.78 mm**. It uses **four copper layers, 0.8 mm nominal thickness and lead-free HASL**. The reference files were not changed.

Use a **headerless Arduino Nano R4, ABX00142**, with its components facing the hat's components across a **4.00 mm gap**. Two **Samtec HTSW-115-07-T-S** strips are soldered to both boards; this is a permanent compact stack. The WAGO terminal and tall sockets have been removed. The field cable is soldered into J1's three holes. Ordinary loose pins held by epoxy are not reliable electrical contacts.

The target potted body thickness is **10.5 mm**, subject to a physical fit check. The estimated stack is about **9.7 mm with flat bare-wire terminations and 1 mm epoxy cover per face**. Cable insulation and strain relief leave the end of the body; a bundled cable cannot be placed underneath the board within this allowance. See the [assembly guide and drawing](../mechanical/ASSEMBLY.md) for dimensions, part sources, wire routing and tolerances.

## Manufacturing files

Use these three files together:

| File | JLCPCB upload |
| --- | --- |
| `HP-HAT_gerbers.zip` | PCB Gerbers |
| `HP-HAT_BOM.csv` | Assembly BOM |
| `HP-HAT_CPL.csv` | Assembly placement |

[ORDER_SETTINGS.md](ORDER_SETTINGS.md) contains the factory selections and a remark below 500 characters. The PCB has **56 factory-fitted components**, all on top. J1, J3 and J4 are deliberately excluded from the assembly BOM/CPL: fit the wires, headers and Nano after delivery. Purchase the Nano and two HTSW strips separately; they are not supplied by this JLCPCB package. The old r3 upload files are superseded.

The editable board is `../kicad/hp_hat_routed.kicad_pcb`. Its matching schematic is `../kicad/hp_hat.kicad_sch`. Changes belong in the generators and `placement.json` so that rebuilding preserves the design. Run `D:\KiCAD\bin\python.exe hat/kicad/release.py` from the project folder to regenerate, check and export. `--verify-existing` checks and exports an existing routed candidate without routing again.

## Operation and shared components

Use the intended clean **12 V battery/logger supply, normally 11.5–14.4 V**, with **8–15 s heater pulses**. RH1–RH17 are the same heater as flat-nano: Vishay **CRCW06033R30FKEAHP**, 17 × 3.3 ohm 0603 in series, nominally 56.1 ohm, 0.33 W each at 70 °C. Full-on at 12 V is roughly 2.3–2.5 W; the intended default is 2 W average via 100 Hz PWM with a hard 15 s limit. See `flat-nano/HEATER_R2.md` for the power, derating and needle-fit calculations. Use INA226 measurements to calculate delivered energy. Resistor tolerance, temperature, potting and pulse repetition still matter; these calculations are not a completed thermal qualification.

D2 retains the hat's SMF15CA, the intentional exception to the flat-nano shared BOM, for the Nano supply branch. The Nano's regulator supplies the 5 V circuits. R18 is a filter resistor, not an overvoltage regulator; D2 does not guarantee protection against every surge above the Nano's allowed input. This is the battery/logger configuration, not a lightning-qualified input. USB alone can power logic but cannot power the battery-fed heater.

| Nano pin | Function |
| --- | --- |
| D2 | SDI-12 data |
| D4 | Thermistor excitation, HIGH enables |
| D9 | Heater gate, HIGH enables |
| A0 / A1 / A2 | Left / heater-tip / right thermistors |
| A3 | Body thermistor |
| A4 / A5 | INA226 I2C SDA / SCL, address 0x40 |
| AREF (B0 on pinout) | Filtered thermistor reference |
| BOOT (B1) | Unconnected on the hat |

The connector rows are checked for the face-inward orientation: J3 digital row at +7.62 mm, J4 analog/power row at −7.62 mm. USB faces the cable end. This design is specifically for the Nano R4; a classic Nano, Nano Every or a reversed Nano is not the intended assembly.

## Checks and first assembly

The release procedure checks schematic/PCB parity, ERC, all-severity DRC, all three Kelvin sense connections, via-hole separation from solder openings, component courtyards, all four copper layers, needle geometry and BOM/CPL/Gerber consistency. It separately verifies 30 Nano contact positions/nets and conservative opposing component envelopes. The current model's smallest allowed separation is about **0.48 mm** after the documented allowances. It also verifies that all 90 protected flat-nano files remain unchanged.

These are CAD/manufacturing checks, not proof of a functioning potted sensor. Before potting the first unit:

1. Assemble and measure the 4.00 mm gap and finished height, including wire terminations. Check needle fit with the actual tubing and electrical insulation.
2. Upload firmware through the Nano's USB-C port. The repo contains hardware instructions, not a validated hat firmware release. Firmware must select the external ADC reference and 14-bit readings, control excitation settling, force heating off on timeout/fault, and enforce the maximum 15 s pulse and input-voltage limit. Do not heat above 15 V input; normal operation is the battery range stated above.
3. Verify all four temperature readings, heater voltage/current and energy, heater-off behavior and communication with the actual logger/cable. The direct SDI-12 GPIO receive threshold is not guaranteed for every compliant sender; verify the intended Campbell setup.
4. Recheck readings after a trial potting cure. The Nano has its own regulator and LEDs, so its standby consumption differs from the flat sensor; measure it and use logger-switched power where practical.

Do not wash the whole assembly: the selected Murata thermistors require the specified no-clean process. Pot only tested assemblies using compatible materials. USB access is for programming before final encapsulation; this version has no exposed waterproof USB connector.
