# Compact Nano R4 assembly

Use a headerless **Arduino Nano R4 ABX00142** with its populated face toward the HAT's populated face. Join the boards permanently with **two Samtec HTSW-115-07-T-S male headers**, soldered into both boards, while a fixture holds the facing PCB surfaces **4.00 mm apart**. Both outside PCB surfaces remain accessible for soldering. This arrangement avoids tall sockets and keeps the electronics compact for potting.

These are soldered electrical joints. Sliding ordinary pins into bare plated holes and relying on epoxy does not provide a reliable electrical connection.

[Open the side-view assembly drawing](nano-hat-stack.svg) for the face-inward orientation, header direction, solder locations and thickness budget.

## Parts and dimensions

| Item | Selected specification |
|---|---|
| Controller | Arduino Nano R4 ABX00142, without factory headers |
| Interconnects | 2 × Samtec HTSW-115-07-T-S; 15 pins per strip, 2.54 mm pitch |
| Header pins | 0.635 mm square, 5.84 mm long post, 2.54 mm solder tail |
| Header insulator height | 2.54 mm, inside the board gap |
| Facing board spacing | 4.00 mm, controlled by the assembly fixture |
| HAT finished holes / pads | 1.10 mm / 1.80 mm; hole diameter is the HAT designer's solder allowance |
| Exterior solid pin ends | Trim to no more than 0.50 mm beyond either outside PCB surface |

The [Samtec TSW/HTSW catalog](https://suddendocs.samtec.com/catalog_english/tsw_th.pdf) supplies the pin dimensions and identifies the HTSW LCP housing as suitable for lead-free soldering. The standard TSW PBT version is not the selected substitute. The [authorized Farnell listing](https://uk.farnell.com/samtec/htsw-115-07-t-s/pin-header-15pos-1row-2-54mm-tht/dp/3752524) showed a one-piece minimum, £0.861 unit price and a three-week stated lead time when checked on 2026-09-23. Prices and delivery are purchasing snapshots, not guarantees; no parts have been ordered.

## Thickness budget

The [official Arduino STEP model](https://docs.arduino.cc/resources/models/ABX00142-step.zip) has a 1.6368 mm board. The USB shell reaches 3.17 mm above its populated face, the Qwiic connector 2.975 mm, the reset switch 2.005 mm and the microcontroller 1.67 mm. These parts sit inside the 4.00 mm gap; the HAT layout reserves clearance opposite the tall connectors.

| Contribution | Thickness |
|---|---:|
| HAT PCB | 0.800 mm |
| Facing gap | 4.000 mm |
| Nano PCB from nominal CAD | 1.637 mm |
| Maximum outer pin/solder allowance, both faces | 1.000 mm |
| Epoxy cover target, 1 mm on each face | 2.000 mm |
| **Nominal board/header total, before field wires** | **9.437 mm** |

Use **10.5 mm as the potting mold body thickness target**, leaving allowance for board thickness, solder and assembly variation. A guaranteed 10.0 mm maximum has not been established. The field wires need their own allowance: three separate bare 22-AWG conductors (about 0.64 mm diameter) bent flat underneath the HAT, with **no more than 0.80 mm total wire/insulation/solder projection**, increase the nominal body budget to **9.737 mm**. Route them in separate parallel lanes toward the USB end, maintaining their separation from the 4 mm terminal pitch; do not cross or stack them. A thin insulating strip underneath the bare conductors prevents contact with exposed copper or damaged solder mask. Include that strip in the 0.80 mm limit.

Start the full wire insulation beyond the PCB edge and bring the three insulated leads out side-by-side. A bundle of insulated wires underneath the board does **not** fit this thickness budget. The cable transition and strain relief may need a local relief in the mold; size it from the actual cable. The 10.5 mm target applies to the main head body, not a verified cable gland envelope. Clean, inspect and test the terminations before potting; encapsulate the separated conductors completely. Solder mask is not a waterproof seal.

The body PCB remains 43.18 × 17.78 mm. The finished epoxy head is longer and wider: the reference design includes 8 mm of needle root embedment beyond the body, and the Nano USB shell overhangs the opposite edge by 1.112 mm. Allowing about 1 mm side coverage gives a preliminary mold envelope of **54 × 21 × 10.5 mm**. Its width includes the two outer needle tubes, 2.77 mm outside diameter at ±8 mm centers. The exposed needles extend beyond that head.

## Assembly sequence

1. Inspect and program the Nano through its USB-C connector before final assembly. Use the headerless ABX00142; the factory-header version is not the intended stack.
2. Put the two header strips on the HAT component face, with short tails through the HAT and long posts toward the Nano. Insert the Nano populated face downward, USB at the cable end.
3. Hold a measured 4.00 mm gap with a removable fixture that does not press on components. Align both board outlines and tack opposing corner pins. Check the gap and squareness before completing all 60 header solder joints.
4. Trim the solid exterior pin ends to the stated limit without stressing solder joints. Inspect the joints and confirm no pin bridges or protrusions exceed the envelope.
5. Solder and strain-relieve the field wires using the separate flat-conductor routing above. Measure the exterior projection and check the actual insulated cable exit against the mold. Program and run the complete sensor, including a heater pulse, before encapsulation.
6. Mask connector cavities against resin entry and pot the tested assembly. This sealed version assumes USB programming is completed before potting; it does not provide a permanently exposed waterproof USB port.

## Mechanical evidence and limitations

`nano-r4-envelope.json` contains nominal envelopes for the board and 63 components extracted from the official STEP assembly, with source hash. The coordinate mapping to KiCad's screen-down Y convention is **HAT X = Nano X, HAT Y = Nano Y − 8.89** for this face-down installation. Digital row J3 is at +7.62 mm and analog/power row J4 at −7.62 mm; the [official pinout](https://docs.arduino.cc/resources/pinouts/ABX00142-full-pinout.pdf) and power/built-in LED positions were checked independently.

The extraction uses transformed solid vertices, not a full tolerance or resin-flow simulation. The automated assembly check adds package and placement allowances; physical first-assembly verification is still required before committing a mold. Field wires and cable strain relief are not modeled. Connector soldering, board bow and potting cure stress are not established by a CAD pass.

The investigated Mill-Max socket pair could provide a 3.94 mm gap, but was rejected as the default because the exact short socket was not stocked in small quantities at the checked distributor. Its hollow socket tails also cannot be treated like ordinary solid pins for trimming. Direct soldered headers retain the compact geometry with lower cost and no separable contact inside the permanently potted sensor.
