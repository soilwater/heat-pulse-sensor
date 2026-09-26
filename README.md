# heat-pulse

Information, datasets, and digital twins for heat-pulse sensors that measure soil thermal properties.

**Digital twin:** an interactive simulation of the HP-SDI12-NANO r2 sensor running in real Kansas soils, published from [`docs/`](docs/). Open `docs/index.html` locally in Chrome or Edge; no installation is needed. **Guided tour** in its header steps through one measurement part by part.

## Repository layout

| Folder | Contents |
|---|---|
| [`docs/`](docs/) | The digital-twin website (static HTML, CSS and JavaScript; served as-is) |
| [`digital-twin/`](digital-twin/) | How the twin works, its data builders and tests, and the soil and heater analyses ([KANSAS_SOIL.md](digital-twin/KANSAS_SOIL.md)) |
| [`flat-nano/`](flat-nano/) | Main sensor board, HP-SDI12-NANO r2: KiCad sources, release checks and manufacturing files |
| [`hat/`](hat/) | Secondary design: a heat-pulse hat for the Arduino Nano R4 |
| [`reference/`](reference/) | Lab data used by the twin (Kansas Mesonet KD2 Pro workbook, logger record). Vendor manuals are kept locally, not in the repository |

## Working on the twin

```powershell
node digital-twin/sensor-model.test.js
node digital-twin/sensor-routes.test.js
node digital-twin/kansas-soil.test.js
node digital-twin/kansas-soil-build.js                          # rebuild docs/kansas-soil-data.js
& 'D:/KiCAD/bin/python.exe' 'digital-twin/export_board.py'      # rebuild docs/board-data.js from the board
```

Board release steps are in each board's README.
