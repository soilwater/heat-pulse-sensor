# HP-SDI12-NANO r2 — JLCPCB order settings

Use these three files together from this folder:

- `HP-SDI12-NANO_gerbers.zip`
- `HP-SDI12-NANO_BOM.csv`
- `HP-SDI12-NANO_CPL.csv`


| Setting | Selected value |
| --- | --- |
| Material / layers | FR-4 / **4 layers** |
| Finished thickness | **0.8 mm nominal**; retain this thickness for needle fit |
| Standard construction | **JLC04081H-7628**, the default 0.8 mm, 1 oz outer / 0.5 oz inner stack |
| Copper weight | **1 oz outer / 0.5 oz inner** |
| Finish | **lead-free HASL** |
| Solder mask / legend | **Green / white** |
| Via covering | **Tented**, both sides; retain the supplied mask openings over cable/programming holes |
| Impedance control | **No controlled-impedance requirement** |
| Assembly | **Standard PCBA, top side only** |
| Bare-PCB factory electrical test | **Yes**; separate from the optional assembled-board flying-probe service below |
| Additional marking | Keep order/traceability marks on the electronics body, clear of pads and labels; none on the needle prongs |
| Delivery | Individual assembled sensors, depanelized, with smooth needle-insertion edges |

The single PCB outline is **99.86 × 17.78 mm**; the electronics body is **43.18 × 17.78 mm**. Request **custom panel design through JLCPCB engineering** for this fork-shaped outline. The ordinary automatic **Panel by JLCPCB** option is intended for rectangles/circles and is not suitable here. Use the supplied single-sensor files as the source for the custom temporary manufacturing panel. Standard PCBA requires at least 70 × 70 mm; simply adding 5 mm rails to this narrow board is insufficient. Do not enlarge the finished sensor to satisfy panel dimensions. Economic PCBA does not support this exact four-layer, 0.8 mm construction.

Select **LeadFree HASL** in the surface-finish selector. This is the lower-cost lead-free finish selected for this release.

## Advanced PCBA options

| Option | Select | Reason / instruction |
| --- | --- | --- |
| Bake Components | **No** | No blanket extra bake; required component moisture/floor-life handling still applies. |
| Board Cleaning | **No** | This corrects the earlier recommendation. The Murata NCP15 thermistors must not be cleaned after no-clean flux. No solvent, dry-ice or ultrasonic whole-board cleaning. |
| Special stencil | **No** | No special stencil process is specified for this design. |
| Depanel boards & edge rail before delivery | **Yes** | Deliver individual sensors; remove support remnants flush without bending the prongs or damaging components. |
| Flying Probe Test | **No** | Optional assembled-board service omitted for this cost-conscious first order. Keep the separate bare-PCB electrical test enabled. |
| Function test | **No** | No factory functional-test procedure, programming package or test equipment is supplied with these files. Bench-test every assembled sensor before potting. |
| Photo Confirmation | **No** | Omit the paid photo service to reduce cost. Review the online placement preview and inspect the boards after delivery. |
| Conformal Coating | **No** | Keep solder/programming features accessible. Needle insulation and potting are later operations, with material compatibility checked on hardware. |
| Packaging | **Antistatic bubble film** | Request rigid protection for the slender prongs in the remark. |
| Solder Paste | **High temp.** | Lead-free solder with compatible rosin-based no-clean flux; do not select medium/low-temperature paste. |
| Nitrogen reflow soldering | **No** | Do not add this optional surcharge for the current assembly. |
| Assembly remark | **Yes** | Paste only the paragraph below; it fits the 500-character field. |

The optional assembled-board flying-probe service adds checks of component values and assembly connections and requires additional test data (ODB++ for other CAD tools). It is not equivalent to the bare-PCB electrical test and does not replace firmware/communication/heating checks. See [JLCPCB personalized services](https://jlcpcb.com/help/article/jlcpcb-supported-personalized-services). The choices above also follow the factory's [moisture-handling guidance](https://jlcpcb.com/blog/moisture-sensitivity-level-msl-baking-guide), [solder-paste guidance](https://jlcpcb.com/help/article/medium-low-temperature-solder-paste-service), and [reflow guidance](https://jlcpcb.com/blog/reflow-soldering).

## Assembly remark - 360 characters

Copy only this paragraph:

> HP-SDI12-NANO r2: exact BOM/CPL; RH1-RH17=C313752, 0.33W only. Top assembly; J1/J2/J5 bare. Custom panel; preserve outline, 4 layers, 0.8mm. Deliver depanelized; tabs flush on 1.4mm prongs; no prong markings. Lead-free HASL/solder, rosin no-clean flux. DO NOT CLEAN: Murata NCP15. No solvent, dry ice, ultrasonics or coating. Protect prongs with rigid packing.

All 69 fitted parts belong on the top side. The placement file includes the package rotation corrections for the specified JLCPCB parts. The three bare cable holes are +12 V, SDI-12 signal, and ground; underside labels and the square positive-supply pad identify them.

Use the exact BOM parts, especially the 17 × 3.3 ohm Vishay CRCW06033R30FKEAHP 0.33 W heater resistors (C313752), Murata thermistors, reference resistors, current shunt and Holtek regulator. Do not substitute a lower-power heater resistor. Review pin-1 and diode polarity in the assembly preview.

## Cleaning method - no factory wash

Select **Board Cleaning: No** for this BOM. [JLCPCB normally uses no-clean solder paste](https://jlcpcb.com/help/article/terms-and-conditions-of-jlcpcb-assembly-service). For TH1-TH4, Murata NCP15XH103F03RC, the [manufacturer's specification](https://www.murata.com/-/media/webrenewal/products/thermistor/ntc/ncp/ncp15.ashx?cvid=20231225010000000000&la=ja-jp), pages 13 and 18, explicitly excludes cleaning after no-clean flux. Its separate IPA cleaning conditions do not override that exclusion. Use compatible rosin-based no-clean flux; water-soluble flux is excluded by that specification.

Do not choose dry ice or solvent cleaning for the assembled board. Also exclude ultrasonic cleaning: [Epson FC-135 handling precautions](https://download.epsondevice.com/td/pdf/app/FC-135_en.pdf), section 11(5), warn of resonant damage to Y1. This is a component-specific process decision, not a claim that either solvent or dry-ice cleaning is unsuitable for every PCB.

## Assembly after delivery

Hand-solder 22 AWG cables and anchor the cable jacket so pull does not load the PCB pads. Use a small amount of compatible electronics no-clean flux. If cable-joint residue requires removal, clean only the cable-pad area with a compatible electronics flux remover and prevent liquid from reaching the thermistors; do not immerse or spray the whole sensor. Let the treated area dry fully. This replaces the earlier generic instruction to clean the whole assembly.

Use a measured minimum 2.16 mm steel-needle bore and a total radial insulating liner no thicker than 25 µm (including adhesive, no overlap at the PCB). All three revised PCB prongs are 1.4 mm nominal. Dry-fit a completed, insulated prong before potting: solder height, PCB tolerance, insulation and actual bore all matter. Electrically insulate copper from the steel and encapsulate the electronics and cable entry for soil exposure. Select a potting process compatible with the remaining no-clean residues. Murata requires evaluation of resin effects on the mounted thermistors; check readings before and after curing and evaluate moisture/thermal exposure on a first finished sensor before encapsulating the batch. Solder mask and the surface finish are not waterproof encapsulation.

These files have been checked as CAD/manufacturing outputs. First-unit programming, communication, current measurement and heating checks are still required on the assembled hardware before field deployment.

Sources: [JLCPCB stackups](https://jlcpcb.com/impedance), [PCB capabilities](https://jlcpcb.com/capabilities/Capabilities), [assembly capabilities](https://jlcpcb.com/capabilities/pcb-assembly-capabilities), [automatic panel restrictions](https://jlcpcb.com/help/article/instructions-for-ordering), [custom panel engineering support](https://jlcpcb.com/blog/pcb-panelization), [via covering](https://jlcpcb.com/help/article/pcb-via-covering).

## Revised heater

The r2 heater is 56.1 Ω total with roughly twice the r1 heating capacity at 12 V. Use 11.5–14.4 V externally; the proposed 2 W, 100 Hz PWM control and 15 s shutdown must be implemented and tested in firmware. No firmware is supplied to JLCPCB. See [HEATER_R2.md](../../HEATER_R2.md) before powering or potting assembled sensors.
