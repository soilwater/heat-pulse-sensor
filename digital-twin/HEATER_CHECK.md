# Heater performance check — original r1 investigation

**Update: r2 supersedes the manufacturing decision in this original investigation.** The current flat-nano board uses **17 × 3.3 Ω, 0.33 W Vishay heaters**, totaling 56.1 Ω. The original experimental data below remain useful, but the 22 × 5.1 Ω calculations describe the earlier submitted r1 board. See [the r2 heater decision and qualification](../flat-nano/HEATER_R2.md) and [the replacement upload set](../flat-nano/fab/ORDER_SETTINGS.md).

The updated dashboard includes a duty-cycle control. At 12 V, 85% duty and 15 s, it predicts **1.993 W average**, **29.89 J** and approximately **0.607 °C side-needle rise** under the stated ideal-soil assumptions. At 100% duty the same pulse gives **2.344 W**, **35.17 J** and **0.714 °C**; at 14.4 V / 100% it gives **3.410 W**, **51.16 J** and **1.038 °C**. These remain model predictions, not measured PCB performance. TH2 is now 3.68 mm beyond the last heater center; it still does not measure the hottest resistor.

The field-control specification targets approximately **2 W average using measured power**, so it would reduce duty as the battery charges. The dashboard's direct duty control instead lets you inspect a fixed 12 V example. Neither the dashboard nor this specification constitutes implemented sensor firmware.

---

Initial review, 23 September 2026. This note addresses the concern that the hardware must be able to **“deliver a punch if necessary.”** The existing measurements confirm a hot heater needle in the older probe. The present PCB has less heater power, and the digital twin cannot certify its assembled thermal performance. At the time of this initial check, no manufacturing files or component selections had been changed.

## What the recorded experiment shows

Source: [probe_A25-2.dat](../reference/probe_A25-2.dat). Its TOA5 header identifies a CR1000 and the program `One Thermo-TDR Probe Calibration Andreas All TCs.CR1`; that program source is absent. The table has 4,200 readings: fourteen 300-second records at one-second intervals, starting every two hours. `Htr_mV` is nonzero at counters 8–22 inclusive: fifteen heated samples per record.

For each record, baseline is the arithmetic mean of counters 0–7; peak is the largest subsequent channel value; rise is peak minus baseline. The first record contains impossible T2 values and T3 startup faults, so its T2/T3 results are excluded. No filtering was applied to the thirteen subsequent records. T2's units field is blank; its stable baseline, pulse response and comparison with the construction manual strongly indicate the heater thermocouple, but the missing logger program prevents definitive channel-map verification.

| Channel, thirteen valid records | Median baseline | Median peak | Median rise | Rise range | Median peak after switch-on |
| --- | ---: | ---: | ---: | ---: | ---: |
| T1 | 17.958 °C | 19.436 °C | 1.477 °C | 1.465–1.512 °C | 85 s |
| T2, inferred heater thermocouple | 17.969 °C | 60.211 °C | 42.241 °C | 42.215–44.743 °C | 14 s |
| T3 | 17.969 °C | 19.486 °C | 1.517 °C | 1.440–1.542 °C | 83 s |

T2 peaks at **60.163–63.208 °C**, always on the last heated sample. These data support the reported 50–60 °C heater temperatures. The median standard deviation of the eight baseline samples is approximately 0.0026 °C for T1/T3 and 0.0020 °C for T2; those short-record statistics characterize this older setup, not the PCB's thermistors or ADC.

| Record start | T1 rise | T2 baseline → peak | T3 rise |
| --- | ---: | ---: | ---: |
| 2025-03-18 10:00 | 1.408 °C | invalid startup | invalid startup |
| 2025-03-18 12:00 | 1.479 °C | 18.085 → 60.480 °C | 1.514 °C |
| 2025-03-18 14:00 | 1.481 °C | 17.995 → 60.290 °C | 1.515 °C |
| 2025-03-18 16:00 | 1.476 °C | 18.005 → 60.220 °C | 1.520 °C |
| 2025-03-18 18:00 | 1.477 °C | 17.946 → 60.211 °C | 1.518 °C |
| 2025-03-18 20:00 | 1.478 °C | 17.965 → 60.203 °C | 1.521 °C |
| 2025-03-18 22:00 | 1.512 °C | 17.990 → 60.226 °C | 1.542 °C |
| 2025-03-19 00:00 | 1.476 °C | 17.944 → 60.180 °C | 1.517 °C |
| 2025-03-19 02:00 | 1.466 °C | 17.922 → 60.163 °C | 1.516 °C |
| 2025-03-19 04:00 | 1.476 °C | 17.961 → 60.203 °C | 1.513 °C |
| 2025-03-19 06:00 | 1.477 °C | 17.981 → 60.235 °C | 1.518 °C |
| 2025-03-19 08:00 | 1.465 °C | 17.969 → 60.202 °C | 1.504 °C |
| 2025-03-19 10:00 | 1.484 °C | 17.925 → 60.163 °C | 1.527 °C |
| 2025-03-19 12:00 | 1.495 °C | 18.465 → 63.208 °C | 1.440 °C |

## Why the older probe is a different heater

The supplied [Thermo-TDR Construction Manual](<../reference/Thermo-TDR Construction Manual.pdf>) (kept locally; not in the repository) provides these primary construction details:

- **Page 4:** the center needle contains both the heater and a thermocouple. All three thermocouple junctions lie at the same axial position, within the heated section; adjacent needles are 8 mm apart.
- **Page 7:** 38 AWG heater wire is folded three times over a 42 mm guide. A handwritten note specifies approximately 35–40 Ω.
- **Page 24:** the printed heater acceptance range is **35–45 Ω**.
- **Page 25:** the heater wire is Nichrome 80, 40.63 Ω/ft; the needles are **14 gauge stainless steel**, filled with thermally conductive Omegabond 101 epoxy.

With an ideal **12 V actually across 35–45 Ω**, this construction would dissipate **3.20–4.11 W**. That is a conditional circuit calculation, not measured power from the log. `Htr_mV` averages approximately 296–302 mV during heating, but the shunt value and conversion to current are undocumented. The log therefore does not establish exact amperes, watts or pulse energy. The previous 37 Ω / 0.30 A estimate is consistent with the construction range but is not a measured calibration recovered from this file.

The submitted PCB has **22 × 5.1 Ω = 112.2 Ω**, a 43 mm heated length, **12 gauge needles**, epoxy and an FR-4 prong. Different steel, epoxy and PCB heat storage prevent direct transfer of the older probe's calibration.

## What the r1 PCB and original model provided

The following calculations use the twin's existing assumptions: 5 m one-way 22 AWG cable, 0.35 V input-diode drop, 0.1 Ω shunt, 0.032 Ω MOSFET, 0.2 Ω heater-loop copper and 10 mA electronics load. Side-temperature predictions assume homogeneous soil with conductivity **1.5 W/(m·K)**, heat capacity **2 MJ/(m³·K)** and **8 mm spacing**.

| Battery / pulse | Heater power | Heater energy | Energy per heated length | Predicted side-needle rise |
| --- | ---: | ---: | ---: | ---: |
| 12 V / 8 s | 1.190 W | 9.52 J | 221 J/m | 0.197 °C |
| 12 V / 12 s | 1.190 W | 14.28 J | 332 J/m | 0.293 °C |
| 12 V / 15 s | 1.190 W | 17.85 J | 415 J/m | 0.364 °C |
| 14.4 V / 15 s | 1.731 W | 25.97 J | 604 J/m | 0.529 °C |

Changing 8 s to 15 s increases energy by **87.5%** without increasing instantaneous resistor power. A battery at 14.4 V provides about **45% more power** than at 12 V under these assumptions. Neither change makes the present heater equivalent to the older 35–45 Ω wire heater. Treat 14.4 V as a normal charging condition, not a requirement to boost the battery. Do not overdrive the existing 0.1 W resistors to chase a needle temperature.

The twin's **TH2 is at the heater-prong tip**, at axial position 54.08 mm; the last heater center is at 50.8 mm. The older thermocouple lies inside the heated section. Even within the same ideal model, a 12 V / 15 s pulse gives about **0.64 °C rise at TH2's location** versus **4.85 °C at the heated midpoint**, using the model's 0.85 mm effective radius. Neither number predicts the temperature of a resistor chip or the actual steel needle. Steel conduction, epoxy/contact resistance, FR-4 heat storage and water movement are absent from the model.

## Acceptance decision and a stronger candidate

Use **15 s as the initial intended pulse** when testing the existing hardware. For this project, adopt a provisional engineering acceptance target of **at least 0.5 °C rise on each side needle and at least ten times its measured baseline RMS noise**, in representative wet and dry media at the lowest intended battery voltage. This is a chosen practical margin, not a universal heat-pulse physics threshold. Also verify repeatability, recorded heater energy and recovery of known reference-medium properties. A hot center needle alone does not establish adequate signal at the sensing needles.

The default 12 V / 15 s model result is **below that chosen 0.5 °C target**. Physical tests may differ, but current evidence cannot certify the submitted hardware against this target or promise the older probe's response.

The initial 0402 candidate, subsequently superseded by the stocked r2 0603 selection, was **22 × Panasonic ERJPA2J2R7X, 2.7 Ω, ±5%, 0402**, giving 59.4 Ω total. Its ERJPA2 series specifies **0.20 W at 70 °C ambient**, with a separate 0.25 W terminal-temperature rating. Use the conservative 0.20 W screening figure while evaluating actual terminal temperatures and derating; these ratings are not interchangeable. See the [Panasonic ERJP/ERJPA datasheet, ratings and derating on pages 2–3](https://industrial.panasonic.com/cdbs/www-data/pdf/RDO0000/AOA0000C331.pdf).

With the same circuit-loss assumptions, this candidate gives approximately **2.22 W at 12 V** and **3.23 W at 14.4 V**, or **33.3–48.4 J for 15 s**. The one-high/21-low ±5% resistance corner gives approximately **0.116 W / 0.169 W** in the hottest resistor at those two supplies. These are screening calculations. Exact sourcing and factory assembly, component/package compatibility, switch/protection margins, thermal behavior and pulse safeguards still require qualification. This was a candidate calculation only. The r2 package now uses the different 17-part Vishay design identified at the top of this note.
