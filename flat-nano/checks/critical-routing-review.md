# Compact flat sensor: critical routing review

**Historical r1 routing review.** The body routing remains the basis of r2, but the heater chain, prong widths and center-prong sensing traces/vias were intentionally revised. The RH22 measurements and old minimum-connection statement below are historical. Use `fab/r2/RELEASE_MANIFEST.txt` and `HEATER_R2.md` for the current checked revision.

Reviewed final board: `kicad/hp_sensor_routed.kicad_pcb`  
SHA256: `c2e3629a0424d9fac3f02bf377cdc9516ef266c8ae9b11466cce4138515ff8d5`

This review covers the compact 43.18 × 17.78 mm electronics head with four copper layers. It does not change the circuit, component values, or PCB. The final cleanup replaced eight front-layer track segments with four 0.20 mm segments at R24.1 and U4.6. It removed redundant narrow side contacts, shortened both routes, and moved no components or vias. The final stricter DRC checks minimum copper connection width 0.127 mm, minimum mask width 0.10 mm, and mask-to-unrelated-copper clearance 0.09 mm; no PCB checks are disabled. Full board DRC, schematic parity, prong preservation, and fabrication-output validation are recorded separately by the release checks.

## Independent electrical and assembly checks

- **Kelvin sense: all three paths pass.** U4.10 reaches R5.1; U4.9 and U4.8 reach R5.2. Removing the actual corresponding R5 pad polygon disconnects each sense network from all load pads. This uses finite copper widths, X crossings, filled zones, drilled holes, via annuli, and plated connections across all enabled layers. It respects removed unused inner annuli. Eight in-memory regression fixtures pass, including an unwanted connection through In2.Cu.
- **Ordinary via holes: zero exterior-pad mask-opening conflicts.** All 118 vias were checked against 247 exterior openings (221 SMD and 26 through-hole pad openings). The hole edge remains at least 0.10 mm from every checked opening on both exterior sides. The checker includes effective mask expansion and actual pad shape; it does not assume filled/capped vias. Polygon approximation is 0.001 mm.
- **Inner power planes:** the saved fills contain one connected polygon each: In1.Cu GND, approximately 648.62 mm²; In2.Cu +5V, approximately 637.01 mm². The local supply branches below reach vias that retain their connection to In2.Cu. Complete pad/plane connectivity is also subject to final DRC.

## Measured critical routes

These are approximate pad-center-to-pad-center distances along explicit track center lines, including short connections within pads. They are routing measurements, not extracted electrical delay or current-density results. Front/back changes count through-via traversal; a plated J2 entry can also contribute one change. Connections through a plane do not have a unique centerline length and are reported separately.

| Connection | Length, mm | Front/back changes |
|---|---:|---:|
| ADC reference: U1.59 → C13.1 | 3.33 | 0 |
| MCU internal regulator: U1.5 → C10.1 | 2.31 | 0 |
| USB regulator: U1.20 → C16.1 | 2.66 | 0 |
| Clock input: U1.6 → Y1.1 | 7.37 | 2 |
| Clock output: U1.7 → Y1.2 | 5.93 | 2 |
| Clock input load capacitor: U1.6 → C5.1 | 7.27 | 2 |
| Clock output load capacitor: U1.7 → C6.1 | 9.73 | 2 |
| INA226 IN+: U4.10 → R5.1 | 2.38 | 0 |
| INA226 IN−: U4.9 → R5.2 | 2.76 | 0 |
| INA226 bus sense: U4.8 → R5.2 | 2.26 | 0 |
| USB D−: J2.2 → U1.18 | 16.00 | 2 |
| USB D+: J2.3 → U1.19 | 18.50 | 4 |
| USB power: J2.1 → D5.2 | 43.34 | 2 |
| Input capacitor: U3.2 → C1.1 | 6.16 | 0 |
| LDO output capacitor: U3.3 → C2.1 | 6.02 | 0 |
| LDO output to isolation diode: U3.3 → D7.2 | 6.88 | 0 |
| Battery input: J1.1 → D1.2 | 14.52 | 0 |
| Protected input to heater shunt: D1.1 → R5.1 | 46.15 | 4 |
| Heater supply: R5.2 → RH1.1 | 18.55 | 2 |
| Heater return: RH22.2 → Q1.3 | 57.26 | 2 |

The ADC reference capacitor is now local to U1 and its reference route stays on the front. The USB pair has approximately 2.50 mm centerline mismatch and different via counts. These dimensions alone do not demonstrate a USB failure, but this review does not establish differential impedance or signal integrity. Likewise, crystal trace lengths do not establish oscillator startup margin.

## Decoupling and local plane access

| Supply terminal | Explicit trace to a connected +5V plane via, mm |
|---|---:|
| U1.11 / U1.39 / U1.56 | 1.83 / 1.80 / 1.50 |
| U4.6 | 1.06 |
| C7.1 / C8.1 / C9.1 | 0.66 / 0.65 / 1.37 |
| C12.1 | 0.65 |
| R11.1, reference-filter supply | 0.62 |
| D7.1 / D5.1, power-diode outputs | 0.85 / 0.85 |
| C17.1, rail bulk capacitor | 0.80 |

C8 and C9 also have direct explicit routes to their associated MCU supply pins, approximately 2.45 and 2.87 mm. C7 and C12 connect through the power plane; the absence of a centerline-only path between those capacitors and the IC pins is expected.

Nearest GND-via distances from capacitor ground-pad centers are approximately 0.63–0.75 mm for C7/C8/C9/C10/C12/C16, 0.57–0.63 mm for C5/C6, 0.80–0.83 mm for C1/C2, and 1.34 mm for C13. These are spatial proximity measurements, not ground impedance or a proof of the current-return path. They avoid placing ordinary drilled vias within the solder pads.

## Selected fabrication construction

The PCB and Gerber job specify JLC04081H-7628, nominal 0.8 mm, 1 oz outer / 0.5 oz inner copper, green mask, white legend, lead-free HASL and tented vias. The published finished inner copper value is 0.0152 mm. The job carries the actual 99.86 × 17.78 mm outline dimensions, excluding the drawn outline stroke. It does not claim controlled impedance or an unpublished dielectric loss tangent. Standard PCBA requires custom panel design through JLCPCB engineering for this fork-shaped board; see `fab/ORDER_SETTINGS.md`.

## Limits and reproducible checks

This is a layout/connectivity review, not prototype qualification. It does not certify oscillator startup, USB communication, ADC noise during a heater pulse, regulator transients, or resistor/needle temperatures. Those require measurements on assembled hardware. A PCB/hash change requires rerunning the checks and updating this record.

Run with the installed KiCad Python:

```text
D:/KiCAD/bin/python.exe flat-nano/kicad/check_kelvin.py --self-test
D:/KiCAD/bin/python.exe flat-nano/kicad/check_kelvin.py flat-nano/kicad/hp_sensor_routed.kicad_pcb
D:/KiCAD/bin/python.exe flat-nano/checks/check_solder_vias.py --board flat-nano/kicad/hp_sensor_routed.kicad_pcb
```
