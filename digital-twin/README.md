# Flat heat-pulse sensor dashboard

The dashboard itself lives in [`../docs/`](../docs/) and is published from there as the project website. Locally, open **`docs/index.html` in Chrome or Edge on a desktop computer**; double-clicking works without a server, installation, or internet connection. This folder holds the twin's documentation, data builders and tests. The dashboard is a single control view: the sensor drawing on the left; the temperature chart and one live **Readings** table on the right. Above them, a control row uses the same two columns: the Soil and Parts cards over the sensor, and the run controls over the chart. Soil selection and the parts list open as dialogs from those cards. The header switch changes between the dark theme (default) and the light theme; the choice is saved in this browser. It represents the latest **HP-SDI12-NANO r2** sensor with **17 series-connected 3.3 Ω resistors**, a **12 V battery**, and a **22 °C starting temperature**. It simulates a proposed measurement sequence; it does not connect to hardware or execute sensor firmware.

## Run a measurement

Three durations and one heater-duty setting are editable, and the soil is chosen with the **Soil** card above the sensor. Durations use whole seconds; duty uses whole percent:

| Setting | Range | Default |
|---|---:|---:|
| Background sensing | 1–60 s | 10 s |
| Heating | 8–15 s | 15 s |
| Cooling sensing | 1–600 s | 90 s |
| Heater duty | 0–100% | 85% |

## Choose a soil

Every soil is a real measurement. The **Soil** card above the sensor shows the current one (station, depth, water state, texture, λ, C, θ); it opens on a typical silty clay loam at 33 kPa, the reading closest to the Kansas 33 kPa medians. **Change** opens the **Select soil** dialog:

- Click a dot on the USDA texture triangle. There is one dot per Kansas Mesonet core; the two cores at each station depth share a position, so click again to cycle. Hover for station, depth, texture and the colored variable.
- Or narrow the list with **Texture** and pick from **Core** (grouped by station, keyboard accessible).
- **Color by** organic matter, bulk density, depth, or water content at the selected state.
- Pick a **water state** chip. Each shows that reading's water content θ. A "!" marks heat capacities flagged in the workbook's QA/QC log (all 5 and 10 kPa readings, plus individual cores); they remain selectable, and the flag text is shown.

The twin applies the choice immediately and uses that single reading's measured conductivity and heat capacity; nothing is interpolated. The dialog lists the core's texture, OM, bulk density, θ, λ and C, and plots the actual KD2 Pro reading of that sample next to the twin's prediction for the KD2 probe (30 mm, 6 mm spacing, 60 s heating), so each soil can be traced back to a real measurement. See [KANSAS_SOIL.md](KANSAS_SOIL.md) for the data, the model check against all 1,448 curves, and the expected signal range.

Press **Run measurement**, pause/resume, reset, or run again. Drag the time slider to inspect any moment. Playback speed cycles through **1×, 4×, and 10×**; this changes animation speed, not the simulated pulse duration. Changing a timing or duty value resets the measurement. Duty is the fraction of each 100 Hz PWM cycle that the heater switch is ON. At 0%, the measurement sequence still runs but the heater stays off.

Displayed time **0 starts background sensing**. The default cycle lasts **115 seconds** and contains exactly the three phases above. The underlying model's initial idle and final reporting intervals are not displayed.

The vertical sensor view uses the actual PCB outline, component positions, and copper snapshot. Scroll over the board to zoom at the pointer, or use **+ / −**; drag to pan and press **Fit** to restore the whole board. Zoom ranges from 100% to 600%. Clicking a component, a callout, or a Readings row opens its role and current values in a detail dialog; dragging does not open a dialog.

The **Parts / Top / In1 / In2 / Bot** tabs preserve zoom, pan, measurement time, and playback. Copper tabs hide component bodies and show the selected layer's actual tracks, filled copper areas, pad outlines, and drill holes. All four copper views use the same top-view coordinates; inner and bottom copper are viewed through the board, not mirrored. In1 is the ground plane; In2 is the +5 V plane. The inner planes stop at the electronics body. Via annuli and pads appear only on layers where the released board actually flashes copper; through-drill holes remain visible on every layer they traverse. Pad clicks and the component callouts still open details.

The drawing is a top view on a 1 mm drafting grid with a title block. Callouts give each designator and its function. The soil-temperature and circuit-activity legends float in the drawing's upper-left corner.

## Readings and the sensor estimate

The **Readings** table updates with the time slider: TH1, TH3 and TH2 temperatures and rises, the soil beside the heated section, battery draw and current, heater power and energy, and the component losses. TH4 (board) stays on the drawing but is not reported, because board heating is not modeled. Click any row for details.

**Sensor estimate** answers "what would this sensor report in this soil?". When cooling ends, the simulated TH1 record (14-bit ADC, 64 readings averaged, one sample per second) is baseline-corrected and fitted with the pulsed infinite-line-source model, as simple firmware would, using q′ = average heater power ÷ heated length and the nominal 8 mm spacing. The table shows the sensor's λ and C next to the soil's KD2 Pro values, with the difference. Water content is then derived from C with the de Vries relation θ = (C − ρb·0.75)/4.18 and the core's bulk density, and compared with the measured θ. The λ and C differences are the sensor-and-analysis bias, about +2.5–4%, mostly from the finite heater length. The θ difference also contains the de Vries relation's own error, since measured C scatters about ±10% around it.

## Parts list

The **Parts list** card opens one table of all 72 placed parts, grouped by part number: designators, function, value, manufacturer, part number, LCSC number and BOM description. The released BOM has no manufacturer column; manufacturers are filled in only for part-number families that identify them unambiguously, otherwise a dash. Click a designator for that part's role and live values.

J1 is drawn as three bare solder holes with incoming **12 V power, SDI-12 signal, and ground** wires from an external battery/logger. Dimension lines show **99.86 mm overall PCB length × 17.78 mm width** (43.18 mm body length), calculated from the exported outline and excluding the wires. All three PCB prongs are now 1.4 mm wide; needle lengths and thermistor locations remain unchanged.

Neon **yellow logic-power** and **pink control/sensing** highlights follow the **actual exported copper tracks and vias**. Each copper tab shows activity only on its selected layer, including the **orange heater circuit**: the series connections on top and the long return trace underneath. The Parts tab retains the simplified orange guide to the complete loop. Copper pads and fills also indicate activity; shared supply and ground use yellow during sensing and orange during heating. These colors indicate circuit activity, not voltage, current density, or decoded waveforms. Supply/heater nets include sensing and protection branches, so their copper highlights pulse without claiming equal branch current or a direction everywhere. Heater traces without highlights do not necessarily have zero voltage. Component selection uses a thin unfilled rectangular border that keeps its screen width when zooming.

Before a measurement, the board uses muted copper and component colors with no automatic activity highlights. The electronics are still powered and their standby draw remains visible in the Readings table. Running or scrubbing a measurement enables highlights, including background sensing at displayed time zero. Pausing freezes them at that moment; reset clears them.

The chart and Readings table show the evolving ideal thermal response: **TH1/TH3** on the side needles and **TH2** at the heater-prong tip. Component details also show the last simulated ADC reading. The Readings table updates PWM-cycle-average battery draw, heater power, accumulated heater energy, and component/group losses. Resistor and switch dialogs also show ON current and ON power. Copper animation represents average activity; it does not flash at 100 Hz or reconstruct actual switching waveforms. **The electronics stay powered during background sensing and cooling**, even when heater power is zero.

The soil colormap uses **purple → pink → orange → yellow** and the same spatial heat equation as the temperature curves. Its fixed, logarithmically spaced **0–5 °C rise scale** keeps small side-needle responses visible without rescaling a cooling pulse; values above 5 °C saturate. The map is neutral before heating, remains warm after switch-off, and follows the same time across all copper tabs, zoom and pan. It refreshes at quarter-second simulation intervals. The physical heater-needle interior is masked rather than assigned a fictitious temperature.

**TH2 is 3.68 mm beyond the last heater resistor.** Its label now says "Beyond heaters." A separate **Beside the heated section** reading samples the ideal soil field at the middle of the heated length, 1.385 mm from the axis (the nominal 12G needle outer radius). This is a soil estimate, **not the steel, thermocouple or resistor temperature**. Click this reading or the color legend for the distinction and a comparison with the recorded experiment. The thermistor chart keeps its smaller scale so the side-needle signal remains readable.

## Heating capacity and the recorded probe

The r2 chain is **17 × 3.3 Ω = 56.1 Ω**, using Vishay CRCW06033R30FKEAHP (LCSC C313752), 0.33 W, 1%, 0603 resistors. They are spaced 2.6 mm apart, beginning 8.8 mm from the body/prong boundary. The dashboard uses the latest board and has no hardware configuration selector.

At the fixed **12 V** supply and modeled cable/circuit losses, full ON gives **204.4 mA and 2.344 W**. The default **85% duty** gives **1.993 W average and 29.89 J over 15 seconds**. Increasing duration increases energy; increasing duty increases average power. A duty of 100% delivers approximately 35.17 J in 15 seconds under these assumptions.

**The dashboard applies a fixed duty, not closed-loop power regulation.** Real firmware is intended to regulate around 2 W average at 100 Hz as battery voltage changes. For example, the model requires approximately 85.3% at 12 V but 58.6% at 14.4 V. Leaving duty at 85% on a 14.4 V supply would produce approximately 2.90 W average. That firmware has not been implemented or qualified by this dashboard.

[HEATER_R2.md](../flat-nano/HEATER_R2.md) records the revised part choice, electrical limits, needle fit, insulation assumptions, and bench qualification requirements. Neither the soil model nor passing PCB design rules establishes the hottest chip temperature or adequate thermal signal in a manufactured sensor.

[HEATER_CHECK.md](HEATER_CHECK.md) is the earlier analysis of `reference/probe_A25-2.dat`, the supplied construction manual, and the former 22 × 5.1 Ω design. Thirteen valid records show approximately 60–63 °C on the inferred heater-thermocouple channel and approximately 1.5 °C side-channel rises. The manual describes a 35–45 Ω wire heater and 14G needles. The logged heater-millivolt signal has no documented power conversion, so those records do not calibrate this revised 56.1 Ω, 12G sensor. A hot needle alone does not establish the side-needle response needed for measurement.

## What the circuit model represents

- Heater current flows through **J1 → D1 → R5 → RH1–RH17 → Q1 → ground**. D9 controls Q1's gate through R9; the MCU does not supply heater current. Each heater resistor releases **I_ON²R** during each ON interval. Average heat is this power multiplied by duty / 100, not the square of average current times resistance.
- **U3** regulates the protected input to an assumed 5.0 V; **D7** drops an assumed 0.25 V before the logic rail. The power ledger separates these losses from aggregate logic consumption. It does not invent individual MCU or INA226 current consumption.
- **U4/INA226** senses R5 and HEAT_P. Its calculated power includes heater-loop copper and Q1 losses; delivered heater energy counts the 17 resistors alone. Proposed firmware must use settled ON-window single-shot shunt/bus conversions, check conversion-ready, and integrate measured ON power over actual ON time. Asynchronous PWM averages can alias and cannot simply be multiplied. The twin uses ideal ON/OFF weighted averages and does not simulate conversion timing errors.
- **R9/R12** are now 1.5 kΩ gate resistors to limit MCU output current. Firmware must detach PWM and explicitly drive the heater output LOW at the deadline; stopping a timer alone is insufficient.
- **D4/Q2** switches the thermistors' common ground. VREF remains powered through R11. The proposed sequence allows 10 ms settling and 10 ms acquisition every second, using `AR_EXTERNAL`, 14-bit ADC conversions, and 64 readings.

Other settings are fixed in the dashboard: 5 m one-way 22 AWG cable, zero additional contact resistance at the soldered cable pads (idealized), 0.2 Ω heater-loop copper, 0.35 V D1 drop, 10 mA aggregate electronics current, 8 mm needle spacing, and uniform soil with the selected reading's λ and C. See **Model assumptions** for these limits while using the dashboard.

## Limits

The electrical model assumes constant resistance, diode drops, and electronics current. The selected Vishay CRCW06033R30FKEAHP heater is rated 0.33 W at ambient temperatures up to 70 °C, with linear derating to zero at 155 °C. Rating checks use full-ON power and resistance tolerances regardless of selected duty. Calculated power is a screening result, not qualification of the assembled needle.

Thermal curves sum finite heater point sources in homogeneous soil. They exclude steel, epoxy, PCB heat storage, contact resistance, water movement, and temperature-dependent heater resistance. **Resistor-chip temperature is not predicted. Board heating is not modeled, so TH4 is not reported.** TH1 and TH3 overlap because the modeled soil and spacing are symmetric.

ADC values include deterministic quantization and approximate settling, not validated noise, accuracy, or self-heating. The dashboard does not test SDI-12 compatibility, bootloaders, surge protection, or physical insulation. Hardware testing and calibration remain necessary.

## Source files and updates

Web app, in `docs/` (served as-is; no build step):

| File | Purpose |
|---|---|
| `index.html`, `sensor-ui.js`, `sensor.css` | Dashboard, timing and duty controls, chart, Readings table, sensor estimate, parts list, playback, and dialogs |
| `sensor-board.js`, `sensor-components.js` | Vertical PCB rendering, zoom/pan, component interactions, and explanations |
| `sensor-routes.js`, `sensor-annotations.js` | Actual copper selection, soldered cable illustration, and outline dimensions |
| `sensor-soil.js` | Select soil dialog: texture triangle, core and water-state selection, KD2 Pro curve |
| `sensor-heatmap.js` | Fixed logarithmic soil colormap, sampled from the shared spatial temperature model |
| `sensor-model.js` | Electrical/measurement model, PWM average power ledger, ON-state values, and the sensor estimate (`soilEstimate`) |
| `engine.js` | Shared ideal-soil thermal calculations |
| `kansas-soil-data.js` | Every Kansas Mesonet core with its KD2 Pro readings, generated by `kansas-soil-build.js` from `reference/kansas_mesonet_soil_database_summary_2026.xlsx` (read by `xlsx-read.js`) |
| `board-data.js` | Exported PCB geometry, nets, BOM identities, and source hashes |

Tooling, in `digital-twin/` (not published):

| File | Purpose |
|---|---|
| `export_board.py` | Regenerates `docs/board-data.js` from the routed KiCad board and BOM |
| `kansas-soil-build.js`, `xlsx-read.js` | Builds `docs/kansas-soil-data.js` from the reference workbook and prints the model checks |
| `*.test.js`, `sensor-ui.test.cjs` | Model, routing, soil-data and browser checks against the files in `docs/` |
| `KANSAS_SOIL.md`, `HEATER_CHECK.md` | Soil-data analysis and the earlier heater investigation |
| `export_board.py` | Regenerates the board snapshot without editing KiCad sources |
| `sensor-model.test.js`, `sensor-routes.test.js`, `kansas-soil.test.js`, `sensor-ui.test.cjs` | Model, routing geometry, and browser regression checks |

`board-data.js` records SHA-256 hashes of `flat-nano/kicad/hp_sensor_routed.kicad_pcb` and `flat-nano/fab/HP-SDI12-NANO_BOM.csv`; the dashboard reads this snapshot rather than live KiCad data. After either source changes, regenerate from the repository root:

```powershell
& 'D:/KiCAD/bin/python.exe' 'digital-twin/export_board.py'
```

The compact board snapshot contains four copper layers and the current saved fills, without altering the manufacturing files. The soldered cable pads replace the older WAGO connector. The copper-loss value remains an explicit estimate, not a four-layer resistance extraction.

The exporter updates geometry, BOM metadata, and explicit heater specifications. It refuses an unexpected heater count, identity, or position. Review the model and tests separately after changes to circuit values, topology, geometry, or timing; the physics does not update automatically.

Run checks from the repository root:

```powershell
node digital-twin/sensor-model.test.js
node digital-twin/sensor-routes.test.js
node digital-twin/kansas-soil.test.js
node digital-twin/sensor-ui.test.cjs
```

`sensor-ui.test.cjs` predates the current layout (it expects the earlier temperature tiles and power cards) and needs updating before it can pass; it also requires Playwright, available locally or via `PLAYWRIGHT_MODULE`; `CHROMIUM_EXECUTABLE` can identify an existing Chrome installation. These dependencies are needed only for automated tests, not for opening the dashboard.

