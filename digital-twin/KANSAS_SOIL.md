# Kansas Mesonet soil data in the digital twin

Source: `reference/kansas_mesonet_soil_database_summary_2026.xlsx`, a copy of the workbook in the
`kansas-soil-props` repository (SHA-256 `1c543b63…2025101`). Cite Parker, Kluitenberg, Redmond &
Patrignani (2022), *SSSAJ* 86(6):1495–1508, https://doi.org/10.1002/saj2.20465.

The workbook links 1,448 KD2 Pro SH-1 dual-needle readings to 316 of its 320 cores (40 stations, 5–50 cm,
8 water states). SH-1: 30 mm needles, 6 mm spacing, 60 readings 2 s apart, heater on for the first 60 s.
Texture coverage is silt loam, silty clay loam, silty clay, clay loam, loam and 24 sandy-loam cores:
**there are no sands**, so these data do not cover the Feb-2026 sand tests.

Rebuild and re-run the checks (≈3 s, Node only):

```powershell
node digital-twin/kansas-soil-build.js          # writes docs/kansas-soil-data.js and prints the checks
node digital-twin/kansas-soil.test.js
```

## In the dashboard

The **Select soil** dialog picks any of the 316 cores (texture triangle, texture filter or core list) and
any of its water states; the twin then runs on that single reading's measured λ and C, and the dialog shows
the reading's KD2 Pro curve beside the twin's prediction for it. The dashboard opens on the unflagged 33 kPa
reading closest to the 33 kPa medians (Hodgeman, 20 cm, silty clay loam: λ 1.28, C 2.35). After each run,
the Readings table's *Sensor estimate* shows the λ, C and θ the r2 sensor itself would report for that
soil (Check 2's line-source bias, computed live). See the README for how to use it.

Particle size was measured on one core of each station-depth pair (core 2) and organic matter on the
other (core 1), so both cores take texture and OM from their pair. Bulk density and all thermal readings
are each core's own.

For context, the medians per water state (printed by the build) are:

| Water state | n | λ W/(m·K) | C MJ/(m³·K) | θ m³/m³ |
|---|---:|---:|---:|---:|
| Saturated | 316 | 1.37 | 2.73 | 0.44 |
| Field capacity (33 kPa) | 312 | 1.29 | 2.33 | 0.34 |
| 70 kPa | 242 | 1.25 | 2.16 | 0.32 |
| Air-dry (2 days) | 208 | 1.05 | 1.75 | 0.17 |
| Oven-dry (40 °C) | 220 | 0.43 | 1.31 | 0.02 |

5 and 10 kPa are omitted here because the workbook's `qaqc_log` flags all of their heat capacities
(~30% low); individually flagged heat capacities are also excluded. In the panel, flagged readings stay
selectable but are marked "!" with the flag text.

## Check 1 — does the twin's heat model reproduce real curves?

Each KD2 curve was predicted from its own reported λ, C and heater power (W/m), using the same
`engine.js` functions the dashboard uses:

| Model | Peak predicted / measured (p5 · median · p95) | RMSE, median |
|---|---|---|
| Finite 30 mm heater (the twin's point-source sum) | 0.99 · **1.04** · 1.13 | 0.05 °C |
| Infinite line source | 1.01 · 1.06 · 1.15 | 0.09 °C |

The finite-length model the twin uses halves the error of the textbook line source. The remaining ~4%
overestimate is consistent with what the model leaves out (needle heat capacity, contact resistance).
When the finite model is fitted freely to the raw curves, C agrees with the KD2 value within ~2% (median),
but λ comes out ~9% higher. The instrument's λ is probably biased low, so treat KD2 λ as ±10%.

## Check 2 — what will the r2 sensor see in Kansas soils?

The default r2 pulse (1.99 W average, 15 s, 8 mm spacing), run through all 1,448 measured (λ, C) pairs:

| Quantity (p5 · median · p95) | Value |
|---|---|
| Side-needle peak rise | 0.41 · **0.58** · 1.05 °C |
| Saturated soils only | 0.39 · 0.45 · 0.56 °C |
| Oven-dry soils only | 0.71 · 0.94 · 1.37 °C |
| Time of peak after heater on | 28 · 39 · 64 s |
| Soil beside heated section (needle surface) | 5.4 · 7.1 · 17.6 °C rise |
| Line-source analysis bias, λ / C (geometry only, no noise) | +3.7% / +2.7% (median) |

Implications:

- **Wet soils give the smallest signal.** About 0.4 °C is the design case, not 0.6 °C (λ 1.5, C 2.0, the dashboard's former reference soil).
  At 0.0063 °C per 14-bit code that is roughly 60–70 codes before noise, so noise and drift, not
  quantization, will limit C resolution. This makes the case for averaging or a longer/stronger pulse in wet soil.
- **Dry soil runs hot.** Oven-dry cores push the needle-surface soil to about +16 °C (up to +22 °C) with
  the same energy. That is a steep gradient that can drive water away from the heater in moist soil,
  and it is the hotter environment for the heater resistors.
- The 90 s cooling window covers the peak in every case (latest ≈ 64 s).
- The line-source analysis bias is small and fairly stable (+2.4 to +2.9% for C) across Kansas soils,
  so a single calibration factor should remove most of it.

## Check 3 — the engine's texture-based soil-property model (`engine.soilProps`, not used by the dashboard)

Against 1,398 measurements with texture, bulk density and water content: λ RMSE 0.20 W/(m·K) (refitting its
constants to Kansas data improved this only to ~0.18 with leave-one-station-out validation), C biased +0.12 MJ/(m³·K) overall. It
underestimates oven-dry λ by 0.18. It was left unchanged because the dashboard now uses measured
values directly; refit it before using it to predict properties from texture and water content.

## Limits

- KD2 Pro properties come from a 60 s heat pulse on a 30 mm, 6 mm-spaced probe. λ and C are soil
  properties and transfer to the r2 geometry; the KD2 *curves* do not reproduce a 15 s, 8 mm measurement.
- The readings are on small intact cores in the lab. Field contact resistance, layering and water
  redistribution around the heater are not represented.
