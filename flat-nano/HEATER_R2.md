# Flat-nano r2 heater decision and qualification

Engineering review: 23 September 2026. This revision increases heater power while retaining the Nano-size electronics body and the existing needle lengths and sensing positions. The selected parts and circuit calculations support the design; they do not constitute physical validation of a manufactured, insulated and potted sensor.

## Selected components

| Function | Exact part | JLCPCB part | Quantity per board | Public stock checked |
| --- | --- | --- | ---: | ---: |
| Heater | Vishay **CRCW06033R30FKEAHP**, 3.3 Ω, ±1%, 0603, **0.33 W at 70 °C ambient** | [C313752](https://jlcpcb.com/partdetail/VishayIntertech-CRCW06033R30FKEAHP/C313752) | 17 | 1,534 |
| R9 / R12 gate resistors | UNI-ROYAL **0402WGF1501TCE**, 1.5 kΩ, ±1%, 0402, 62.5 mW | [C25867](https://jlcpcb.com/partdetail/26610-0402WGF1501TCE/C25867) | 2 | 2,202,352 |

Stock was returned by JLCPCB's public component search at **2026-09-23 22:03 UTC**, not reserved. Heater prices were $0.1097 each for 1–49 pieces, $0.089 for 50–149, and $0.0788 for 150–499; the 17 fitted heaters therefore cost approximately $1.87 per board at the smallest tier before assembly, attrition and other charges. Gate resistors were $0.0029 each at 1–999. JLCPCB reported heater minimum placement quantity 5 and attrition quantity 2; its final quotation determines the charged quantity.

The heater chain is **17 × 3.3 Ω = 56.1 Ω nominal**, with centers spaced 2.6 mm. Nominal cold resistance is 55.539–56.661 Ω before wiring, copper and switch resistance. This is a different calibration from the previous 22 × 5.1 Ω chain; update firmware configuration, heater validation limits and thermal geometry together. An aggregate resistance measurement cannot identify every individual resistor defect.

The [Vishay primary datasheet, revision 17 March 2026](https://www.vishay.com/doc?20043=), specifies the 0.33 W ambient rating, temperature derating, lead-free-compatible pure-tin terminations and reflow assembly. Its separate terminal-temperature rating is not used to inflate the conservative rating here. Page 9 gives a maximum body envelope of 1.70 × 0.95 × 0.55 mm. Recommended reflow lands are 0.75 mm long × 1.00 mm wide each, 0.75 mm apart internally, for 2.25 mm total length. At 2.6 mm pitch, adjacent pads have a nominal 0.35 mm gap before solder-mask expansion. Film temperature must remain within the manufacturer's limit; the assembled potting process also requires qualification.

## Available power and the PWM operating requirement

The table assumes 5 m one-way 22 AWG cable (0.53 Ω loop), a 0.35 V input diode drop, 0.1 Ω shunt, 0.032 Ω MOSFET, 0.2 Ω heater-loop copper, and 10 mA electronics load. These are design estimates, not measurements.

| Battery voltage | Full-ON current | Full-ON heater power | Full-ON energy, 8 / 15 s | Duty for 2.0 W average |
| --- | ---: | ---: | ---: | ---: |
| 11.5 V | 0.196 A | 2.147 W | 17.18 / 32.21 J | 93.1% |
| 12.0 V | 0.204 A | 2.344 W | 18.76 / 35.17 J | 85.3% |
| 14.4 V | 0.247 A | 3.410 W | 27.28 / 51.16 J | 58.6% |

The intended default is **2.0 W average heater power, 100 Hz PWM, 8–15 seconds**. This gives **16–30 J** independent of battery voltage while sufficient electrical headroom remains. Closed-loop control must use measured power; the percentages above are explanatory starting estimates. Longer or thinner cables, a low battery, or higher actual circuit losses can prevent 2 W. Saturate at 100% duty, report achieved power/energy, and flag an unmet target rather than extending the authorized pulse silently.

**These are firmware requirements, not a claim that PWM regulation has been implemented or tested.** Every configuration must retain a hard maximum heating duration of 15 s and an explicit OFF state on reset, faults and measurement completion. Detach/disable the PWM output and then drive its GPIO LOW: stopping a timer alone must not leave the output HIGH. Full-ON operation is available for qualified experiments; the normal target remains 2 W. Do not raise the battery voltage above the intended charging range to obtain more power.

PWM reduces average power but does not reduce the instantaneous power during ON intervals. For one resistor at +1% and the other sixteen at −1%, the hottest resistor dissipates approximately **0.142 W at 12 V** and **0.206 W at 14.4 V**, using the losses above. Ignoring all circuit losses gives conservative supply-voltage bounds of **0.155 W** and **0.224 W** respectively. The latter is approximately 68% of the 0.33 W rating at or below 70 °C. Apply temperature derating; at 100 °C the conservative ambient rating is approximately 0.214 W, below that zero-loss bound. Resistance temperature coefficients and measurement errors require additional margin.

Use **90 °C as a provisional maximum measured hottest-resistor temperature during qualification**, leaving margin below the conservative ambient derating intersection. This is a chosen operating limit, not a temperature that current hardware can guarantee or directly monitor. **TH2 is near the prong tip and is not a measurement of the hottest resistor.** Assess the hottest region with an independent temperature measurement during bench qualification.

## Gate drive and measured energy

R9 and R12 change from 1 kΩ to **1.5 kΩ ±1%**. The [Renesas RA4M1 datasheet, table 2.6](https://www.renesas.com/en/document/dst/ra4m1-group-datasheet), limits the relevant GPIO source-current group to 4 mA. At 5.5 V, 1.485 kΩ limits the initial ideal gate-charge current to approximately 3.70 mA. The existing gate pulldowns remain essential. A 100 Hz carrier allows slow, low-loss switching without using a high switching frequency merely for appearance.

The [TI INA226 datasheet](https://www.ti.com/lit/ds/symlink/ina226.pdf) describes sequential shunt and bus conversions. Unsynchronized PWM sampling can alias; multiplying independently averaged current and voltage does not generally give the correct heater energy. The implementation requirement is a settled ON window with single-shot shunt-plus-bus conversion, **588 µs configured per conversion, averaging 1**, allowing the specified conversion maximum of approximately 646 µs per channel and polling conversion-ready. Check that both conversions finish inside the same ON interval. Average valid cycles in software and integrate measured ON power over actual ON time. At very small requested duty, the measurement method must explicitly preserve a sufficiently long ON window or use another validated acquisition scheme.

INA226 bus voltage is sensed at HEAT_P. Its voltage-times-current result includes downstream copper and MOSFET dissipation as well as the heater resistors. Subtract characterized downstream losses when reporting resistor-only energy, or clearly identify the result as delivered heater-loop energy. Validate the complete method against an independent current/voltage measurement; the twin's ideal duty-weighted result does not validate conversion timing.

## Needle fit and insulation

All three PCB prongs are narrowed to **1.40 mm nominal**; their lengths, spacing and thermistor positions stay unchanged. The mechanical acceptance envelope is **actual width no greater than 1.60 mm**, **PCB thickness no greater than 0.90 mm**, and a resistor envelope **0.95 mm wide × 0.65 mm above the PCB**. The last figure includes the manufacturer's 0.55 mm maximum body height plus a **0.10 mm engineering allowance for solder standoff**, which must be verified on assembled boards. The Murata thermistors also have a 0.55 mm maximum height, so the same solder-height allowance is used for their fit checks. The heater's two bottom thermistor lanes move inward to ±0.43 mm and use 0.10 mm traces; its three vias use 0.50 mm pads with 0.30 mm holes. These give 0.13 mm trace-to-via copper clearance and 0.23 mm hole-to-trace clearance. Other signal traces remain at least 0.127 mm, and other vias stay 0.60/0.35 mm. The [factory's standard multilayer capabilities](https://jlcpcb.com/capabilities/Capabilities) accommodate these sizes without an ENIG or filled-via requirement.

Require an **actual minimum unobstructed bore of 2.16 mm** over the insertion region; a nominal gauge or catalogue ID alone does not establish that minimum. Checking all four PCB corners and all four component corners together, the maximum bare cross-section above has a minimum enclosing diameter of approximately **2.051 mm**. A uniform **25 µm radial** internal dielectric liner reduces diameter by 50 µm, leaving a **2.110 mm usable bore** and approximately **0.059 mm diametral clearance**. The 0.65 mm component height excludes this liner; the liner is counted once through the bore reduction. The heater and TH2 share one tube-axis position along the rigid prong. The side needles have about 0.118 mm diametral clearance with their narrower thermistor envelope. A conservative ±0.10 mm lateral heater-placement allowance reduces heater-needle diametral clearance to approximately 0.016 mm. This supports the design envelope but does not guarantee a slip fit through an irregular real needle. A thicker adhesive layer, seam overlap, solder protrusion, burr or local bore restriction can invalidate it.

If a liner is used, **25 µm means its total installed thickness including adhesive**, with no overlap in the insertion section. Ordinary tape specified as 25 µm film plus adhesive does not meet that envelope automatically. Dry-fit and inspect the actual assembled, insulated prong in the actual needle before potting; never force it or scrape its insulation. Reject or rework combinations that bind, and check electrical isolation from steel before and after potting. A measured larger bore or smaller actual prong provides useful margin. The dimension calculation does not certify coating uniformity, long-term insulation or moisture resistance.

## Physical qualification before field deployment

Test complete assemblies in representative **wet and dry intended media**, at the lowest intended battery voltage and at 14.4 V. Measure current, ON timing, integrated energy, actual hottest-resistor temperature, side-needle response and recovery. Repeat pulses to assess drift and repeatability, and check resistance and steel isolation after curing and environmental exposure.

For this project, use a provisional acceptance target of **at least 0.5 °C rise on each side sensing needle and at least ten times its measured baseline RMS noise**. These are chosen engineering margins, not a universal standard. Also confirm that measurements recover known reference-medium properties with the required accuracy. A hot heater needle by itself is insufficient evidence. Layout/ERC/DRC and the digital twin can support these checks; none can promise a successful first physical sensor or replace the assembled thermal and insulation tests.
