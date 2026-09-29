# HP-HAT — JLCPCB order settings

Upload `HP-HAT_gerbers.zip`, `HP-HAT_BOM.csv` and `HP-HAT_CPL.csv` from this folder together.

| Setting | Selected value |
| --- | --- |
| Material / layers | FR-4 / **4 layers** |
| Finished thickness | **0.8 mm nominal**; required for the preserved needle geometry |
| Standard construction | **JLC04081H-7628** |
| Copper | **1 oz outer / 0.5 oz inner** |
| Surface finish | **LeadFree HASL** |
| Mask / legend | **Green / white** |
| Vias | **Tented on both sides**, keep cable and header holes open |
| Controlled impedance | **No** |
| Assembly | **Standard PCBA, both sides** (28 top, 21 bottom) |
| Prototype quantity | **5 bare boards, 2 assembled** |
| Bare-PCB electrical test | **Yes** |
| Delivery | Individual boards, depanelized, with smooth needle insertion edges |
| Additional marks | On the body only, clear of pads and labels; none on prongs |

Finished outline: **99.86 × 17.78 mm**, including prongs. Body: **43.18 × 17.78 mm**, the exact Arduino Nano R4 outline. Ask JLCPCB engineering to make a temporary custom support panel for this fork outline; retain the finished outline exactly. Standard PCBA needs a panel at least 70 × 70 mm, so simply adding narrow rails is insufficient. The ordinary automatic panel option does not suit this fork outline. Two-sided assembly and this 0.8 mm four-layer stack both require Standard PCBA; Economic PCBA does not offer them. See [assembly capabilities](https://jlcpcb.com/capabilities/pcb-assembly-capabilities) and [panel ordering instructions](https://jlcpcb.com/help/article/instructions-for-ordering).

The BOM contains **49 parts: 28 on the top face and 21 on the bottom face**. The Gerber package includes paste layers for both faces. **J1/J3/J4 stay empty at the factory.** Buy a headerless Nano R4 ABX00142 and two Samtec HTSW-115-07-T-S strips separately and assemble using the [4 mm gap instructions](../mechanical/ASSEMBLY.md). Do not replace these with tall female sockets or install the Nano face outward.

## Placement preview (both faces)

JLCPCB shows a placement preview for each face before payment. The CPL already includes the rotation corrections for the MSOP-10 and SOT-23 packages. Bottom-face rows follow JLCPCB's bottom-view convention: 180° minus the KiCad angle, plus the same package correction. On the preview, confirm these polarized parts against the renders `render_top.png` and `render_bottom.png`:

- **Top face:** no polarized parts; D4 is a bidirectional ESD diode.
- **Bottom face:** D1 cathode toward the needle end (away from the cable holes), Q1 drain toward the needles, and U4 pin 1 at the corner nearest the board's center line and the cable end. D2 is bidirectional.

Correct any rotation there before paying.

## Advanced assembly options

| Option | Selection |
| --- | --- |
| Bake Components | No optional blanket bake; normal required moisture handling still applies |
| Board Cleaning | **No** |
| Special stencil | No (standard stencils for both faces) |
| Depanel boards & edge rail before delivery | **Yes** |
| Flying Probe Test | No optional assembled-board service; keep the bare-board electrical test |
| Function test | No; no programmed functional-test package is supplied |
| Photo Confirmation | No |
| Conformal Coating | No |
| Packaging | Antistatic bubble film, with rigid prong protection requested below |
| Solder Paste | High temp., lead-free, compatible rosin no-clean flux |
| Nitrogen reflow | No |
| Assembly remark | Yes; use the paragraph below |

## Assembly remark

Copy only this paragraph; it is shorter than 500 characters:

> HP-HAT: exact BOM/CPL; RH1-RH17=C313752, 0.33W only. Two-sided assembly. J1/J3/J4: leave holes empty. Custom support panel; preserve outline, 4 layers, 0.8 mm. Deliver depanelized; remove tabs flush from 1.4 mm prongs without damaging copper, mask or parts. No markings on prongs. Lead-free HASL/solder, rosin no-clean flux. DO NOT CLEAN: Murata NCP15 thermistors. No solvent, dry ice, ultrasonics or coating. Rigid packing to protect prongs.

## Cleaning and later assembly

Keep **Board Cleaning: No**. The [Murata NCP15 specification](https://www.murata.com/-/media/webrenewal/products/thermistor/ntc/ncp/ncp15.ashx?cvid=20231225010000000000&la=ja-jp) excludes cleaning after no-clean flux. Use compatible rosin-based no-clean flux and do not wash, spray or immerse the assembled sensor. Do not select solvent, dry-ice or ultrasonic whole-board cleaning.

Use the exact 17 × 3.3 ohm Vishay CRCW06033R30FKEAHP 0.33 W heater resistors (C313752), the same as flat-nano; do not substitute a lower-power part. Keep the exact Murata NTCs, 0.1% reference resistors, current shunt and INA226.

After delivery, solder the two boards and three field wires, inspect all joints, and bench-test through USB and the intended battery/logger supply before potting. Use flat, separated wire terminations on the hat's outer face between the cable end and the cable holes, as described in the assembly guide; do not stack insulated wires under the board. Insulate copper from steel needles. Choose potting compatible with no-clean residues and thermistors, and compare readings before and after the first cure. Solder mask is not a waterproof enclosure.
