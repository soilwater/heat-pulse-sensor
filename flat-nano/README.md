# Compact flat sensor — HP-SDI12-NANO r2

An independent layout of the current flat heat-pulse sensor. The electronics body is **43.18 × 17.78 mm**, matching the bare Arduino Nano R4 PCB mechanical drawing. The WAGO connector is replaced with three plated cable solder holes. Revision r2 adds a stronger heater designed for controlled PWM heating; the body and overall lengths are unchanged.

**Use the complete upload set in `fab/`: `HP-SDI12-NANO_gerbers.zip`, `HP-SDI12-NANO_BOM.csv`, and `HP-SDI12-NANO_CPL.csv` (revision r2). Upload all three together.**

This is the main sensor board. The `hat` folder holds the secondary Nano R4 hat design. The digital twin in `docs/` displays this four-layer Nano-body board.

## Dimensions and construction

| Item | Original flat | Compact variant |
| --- | ---: | ---: |
| Electronics PCB body, excluding prongs | 60 × 18 mm | **43.18 × 17.78 mm** |
| Overall PCB, including prongs | 116.68 × 18 mm | **99.86 × 17.78 mm** |
| Board thickness | 0.8 mm | 0.8 mm |
| Copper layers | 2 | **4** |
| Assembly | Top side | Top side |
| Cable connection | WAGO terminal | Three plated solder holes |

The body is 16.82 mm shorter. All three PCB prongs are now **1.4 mm wide**, providing clearance for the larger 0603 resistors within the same 12G steel needle. All prong lengths, four thermistor positions and 8 mm needle-center spacing stay unchanged. The heater uses **17 × 3.3 Ω, 1%, Vishay CRCW06033R30FKEAHP**, rated **0.33 W at 70 °C** (JLC **C313752**). Its 56.1 Ω series chain delivers about **2.34 W at 12 V** and **3.41 W at 14.4 V** under the stated cable-loss assumptions. The custom footprint follows the manufacturer's recommended reflow lands at 2.6 mm pitch. R9/R12 become 1.5 kΩ to respect the MCU gate-drive current limit.

Use a nominal **2 W average heater-power target**, **100 Hz hardware PWM**, and **8–15 s** heating windows. At 12 V this is approximately 85% duty, with full power available when a stronger measurement is qualified. This is a firmware specification, **not implemented firmware**. See [HEATER_R2.md](HEATER_R2.md) for exact ratings, power calculations, synchronized current measurement, shutdown requirements and bench acceptance checks.

The 43.18 × 17.78 mm dimension describes the **bare PCB body**. The steel needles span approximately 18.77 mm across their outside surfaces, and the finished enclosure needs room for needle embedment, insulation, epoxy, and cable strain relief. It will not have precisely the bare Nano dimensions after potting.

## Cable connection

J1 is a bare plated-hole feature, omitted from the factory assembly BOM and placement file. Hand-solder the three wires after assembly. There is no solder-paste aperture over these holes.

| J1 pad | Connection | Identification |
| --- | --- | --- |
| 1 | Battery +12 V | Square pad; `12V` label on underside |
| 2 | SDI-12 signal | Middle pad; `SDI` label on underside |
| 3 | Ground / battery negative | `GND` label on underside |

The holes have 1.2 mm nominal finished diameter, 2.4 mm copper pads, and 4 mm spacing. Use 22 AWG stranded wires with neatly tinned ends that enter freely. The nearest pad copper is 0.8 mm from the board end. Keep the cable jacket anchored in the housing or potting so cable pull does not reach the pads.

USB and SWD programming contacts remain accessible at the two long edges. All 69 fitted components remain on the top side; J1, J2, and J5 are bare connection features.

## Files and checks

- `kicad/hp_sensor_routed.kicad_pcb`: completed routed PCB candidate.
- `kicad/hp_sensor.kicad_sch`: corresponding schematic.
- `kicad/placement.json`: reproducible compact component locations.
- `preview/index.html`: dimension comparison and top/bottom assembly views.
- `checks/check_variant.py`: independent geometry, connectivity, source-preservation, and manufacturing-file checks.
- `fab/`: current manufacturing outputs (Gerbers, BOM, CPL, schematic PDF, renders and order settings), generated only after the release checks pass. `release.py` also writes `fab/RELEASE_MANIFEST.txt` with SHA-256 hashes of the checked board and outputs.
- `checks/critical-routing-review.md`: measured reference, clock, USB, power, and current-sensing paths on the released board.

The completed release passed fresh ERC and DRC with zero findings and zero unconnected pads, all three physical Kelvin checks, zero via-hole/solder-opening conflicts, explicit copper-connection/mask-clearance rules, and independent checks of the fabrication files. This is a verified layout package; no assembled hardware has been tested.

The release process requires zero ERC/DRC findings and zero unconnected items, schematic/PCB parity, dedicated Kelvin connections for all three current-monitor sense pins, the explicitly specified r2 heater/prong geometry, preserved thermistor positions, no courtyard overlap, reserved soldering space around J1, and preservation of the original projects. A separate check keeps ordinary via holes clear of all exterior solder openings, including the cable and programming pads, to avoid solder wicking; this design does not assume filled/capped vias. The process then checks BOM/CPL references, values, locations, rotations, and Gerber/drill content against fresh exports of the routed board.

From the project root, validate and export a routed candidate with:

```powershell
& 'D:/KiCAD/bin/python.exe' 'flat-nano/kicad/release.py' --verify-existing
```

To regenerate placement and routing first, omit `--verify-existing`. Run with KiCad's Python environment, not a generic Python installation. This variant supports the current 12G configuration only.

## Manufacturing and assembly

Use **4-layer FR-4, 0.8 mm nominal thickness, 1 oz outer copper / 0.5 oz inner copper, green solder mask, white silkscreen, lead-free HASL finish, tented vias, and Standard PCBA on the top side only**. Select the standard **JLC04081H-7628** construction. No controlled-impedance certification is requested. The layer order is front signals, inner ground, inner +5 V, and back signals. Both inner planes stop inside the electronics body; the needles retain their original two-sided copper construction. Unused inner via pads are removed on the needles while the outer annular pads are retained. Dedicated power planes allow this compact placement to route with proper solder-pad clearance. Keep the supplied finished-hole sizes and the needle-prong outline. Body signals remain at least 0.127 mm wide with 0.127 mm clearance, and ordinary vias use 0.35 mm holes with 0.60 mm pads. Only the two center-prong thermistor paths use 0.10 mm traces; three center-prong vias use 0.30 mm holes with 0.50 mm pads. The narrower paths retain the full clearance rules and fit the factory's standard multilayer capabilities.

The Gerber ZIP, BOM, and CPL must be used together from this variant's `fab/` folder. Review the supplier's component-orientation preview for this new placement. These local file changes do not replace files in an existing JLCPCB order; upload the three files together before production.

Any factory support tabs must be removed flush from the needle-insertion edges. Use steel needles with a measured **minimum 2.16 mm internal bore**. The heater fit calculation allows a 0.9 mm maximum PCB thickness, 1.6 mm maximum manufactured heater-prong width, 0.95 × 0.65 mm maximum resistor-plus-solder envelope and a **25 µm total radial liner including adhesive, without overlap**. Dry-fit the insulated assembly before potting; PCB thickness, routed edges, component height, and solder thickness all affect the fit. Layout checks do not replace the first assembled unit's power, programming, communication, and heating tests.

For this narrow, fork-shaped board, use **Standard PCBA with custom panel design through JLCPCB engineering and temporary supports**. The ordinary automatic Panel by JLCPCB service is not suitable for this fork-shaped outline; request the custom engineering service using the order remarks. Its minimum assembly panel is 70 × 70 mm; ordinary 5 mm rails around this 99.86 × 17.78 mm outline do not meet that width. The detailed Economic PCBA combinations do not include this four-layer, 0.8 mm construction. Request tooling holes, fiducials, and supports on the factory panel, with the sensors delivered separately and all remnants removed flush from needle-insertion edges. These supports are not part of the 43.18 × 17.78 mm finished body. Use the exact wording and settings in `fab/ORDER_SETTINGS.md`. See [assembly capabilities](https://jlcpcb.com/capabilities/pcb-assembly-capabilities) and [panel requirements](https://jlcpcb.com/capabilities/Capabilities).

The explicit stack follows [JLCPCB's published 0.8 mm JLC04081H-7628 construction](https://jlcpcb.com/impedance): 0.035 mm outer copper, 0.2104 mm 7628 prepreg, 0.0152 mm inner copper, 0.250 mm core, 0.0152 mm inner copper, 0.2104 mm 7628 prepreg, and 0.035 mm outer copper. The 0.0152 mm inner value belongs to the factory's nominal 0.5 oz option. The solder-mask model uses the published 0.01524 mm above-copper thickness on each side. Their combined model is 0.80168 mm; the specified finished thickness remains nominal 0.8 mm with the factory's published ±0.1 mm tolerance. The Gerber job records these published construction dimensions without claiming controlled impedance or a measured loss tangent.

For durable soil service, fully encapsulate the assembled electronics and cable entry using electrically insulating, low-water-absorption potting suitable for electronics. Insulate copper from the steel needles, anchor the cable mechanically, and dry-fit each assembled prong before potting. The surface finish and solder mask do not replace waterproof encapsulation.

Select **Board Cleaning: No**: the Murata NCP15 thermistors must not be cleaned after no-clean flux. Do not solvent-wash, dry-ice-clean or ultrasonically clean the assembled board. Follow the component-specific cleaning and potting guidance and the 500-character assembly remark in [ORDER_SETTINGS.md](fab/ORDER_SETTINGS.md). Evaluate the chosen potting process on a finished sensor before encapsulating the batch.

The separate solder-opening check also found ordinary via holes overlapping SMD solder openings in the original flat PCB. Those locations are corrected in this compact layout. The original board and its manufacturing files were deliberately preserved; this release does not certify their soldering geometry.

Dimension reference: [Arduino Nano R4 datasheet, mechanical drawing](https://docs.arduino.cc/resources/datasheets/ABX00142-datasheet.pdf). Manufacturing reference: [JLCPCB capabilities](https://jlcpcb.com/capabilities/Capabilities), including 0.8 mm board thickness tolerance ±0.1 mm, regular routed dimensions ±0.2 mm, and plated-hole tolerance +0.13/−0.08 mm.

The hat r4 preservation snapshot refers to the previously submitted flat-nano r1 design. Its historical reference check will intentionally fail against the now-authorized r2 source; the hat has not automatically adopted this heater revision.
