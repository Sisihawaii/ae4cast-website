# Field map (`/map/`)

Interactive map of AE4cast corn and soybean forecasts: counties when zoomed out
(area and yield, conditional on USDA reports and weather-only), individual fields
when zoomed in (predicted crop, use and yield), with a season and date selector.

Static page, no build step: `index.html`, `map.css`, `map.js`. Libraries are pinned
from CDNs (MapLibre GL JS 4.7.1 on cdnjs; pmtiles.js 3.2.1 on unpkg). The basemap is
OpenFreeMap's Positron vector style (OpenStreetMap data, no API key; attribution shown on the map).
CARTO's free raster basemaps were used until 2026-10-29, when they began returning an "API KEY
REQUIRED" placeholder tile for this site.

## Data

The page reads one file, `manifest.json`, from the AE4cast tile store (Cloudflare R2,
public base URL set in `map.js` as `MANIFEST_URL`). The manifest lists the three most
recent seasons and, per season, the dated snapshots with their PMTiles archives:

- `counties_<date>.pmtiles` (zoom 3 to 9): one feature per county with planted, grain,
  silage, harvested acres, conditional and weather-only yields, USDA state anchors,
  stages, protocol and basis strings, unplaced acres, scale factors, field shortfalls.
- `fields_<date>.pmtiles` (zoom 9 to 14): one feature per corn or soybean field with
  `crop`, `use` (grain, silage, not_harvested, soy_harvested, soy_not_harvested), `yield`,
  `p_corn`, `p_soy`, `last_crop`, `field_id`.

Snapshots with `tiles_ok: false` are listed as unavailable and cannot be selected.
Both archives are produced on Koa by `code/map/py/make_tiles.py` and uploaded by
`code/map/py/publish_snapshot.py` in the YieldForecastUSA repository (part 2 of
`docs/superpowers/plans/2026-10-21-field-level-map-web.md`).

## Local test

```
cd map
python3 test/serve.py 3000
# then open http://localhost:3000/index.html?manifest=test/manifest.fixture.json
```

`test/serve.py` serves with HTTP Range support (PMTiles reads byte ranges; Python's
stock server ignores Range). `test/manifest.fixture.json` points at `test/fixture/`
(git-ignored: tiles are never committed to this site, so Netlify never deploys them).
Generate the fixture tiles from the YieldForecastUSA repository's test fixture (one Iowa
county, fips 19001, 2026-10-20 snapshot, 5,447 corn/soy fields):

```
cd /path/to/YieldForecastUSA
~/miniconda3/bin/conda run -n ae-map python -s code/map/py/make_tiles.py \
  --snapshot tests/fixtures/map_snapshot_fixture/snapshot --csb tests/fixtures/map_snapshot_fixture/csb \
  --out /path/to/ae4cast-website/map/test/fixture
```

The fixture manifest also lists one deliberately unavailable snapshot (2026-10-13).
The `?manifest=` override accepts only a same-origin relative `.json` path (no scheme,
no `..`), so the production page cannot be pointed at a foreign manifest.

## Manual check list (tick with browser and date before merging)

| check | expected | result |
|---|---|---|
| counties render at zoom 6 and a click opens the county popup | popup with acres, yields, USDA anchor, stages, as-of, protocol and basis | |
| zoom to 9+ over Adair County, Iowa: fields appear in CDL colours (corn `#ffd300`, soybeans `#267300`) | fields drawn; county fill gone | |
| silage fields show the diagonal hatch; not-harvested fields at 40% opacity | visible difference | |
| a field click opens the popup with crop, use, yield, chances, last-year crop and the prediction sentence | popup text matches | |
| the date selector lists 2026-10-20 (selectable) and 2026-10-13 "(unavailable)" (disabled) | as described | |
| `?manifest=test/does-not-exist.json` shows the red banner naming the manifest URL | banner, no spinner | |
| a county with `status = no_forecast` (not in the fixture; check on the live manifest) is grey with the "no forecast" popup | grey fill | |
| phone width (375 px): no horizontal scroll, 16 px gutters, legend readable | as described | |
| page assets (`index.html` + `map.css` + `map.js`) under 1 MB | `du -ch index.html map.css map.js` | |
| the choropleth metric selector switches the county fill and the legend ramp | as described | |

## Deploy

Set `MANIFEST_URL` in `map.js` to the public manifest URL, add the "Field Map" link to
the site navigation (done on this page; the other pages' nav lists get the same link),
open a pull request on branch `map-fields`; Netlify's deploy preview is the acceptance
surface. The tiles are never hosted on Netlify.

## Static data files beside the page

- `counties.json` — FIPS code -> "Name, ST" for all 3,235 US counties, from the Census cartographic
  county boundaries the snapshot builder draws counties from (cb_2024_us_county_500k). Popups show
  the name with the FIPS code; a missing entry falls back to the code.
- `states.geojson` — Census cb_2023_us_state_20m state boundaries (50 states + DC), drawn as the
  `state-line` layer above the county fill and the fields.
Both are regenerated from the YieldForecastUSA repo (scratch script make_page_assets.py; the county
file under map/geo/, the state file from www2.census.gov/geo/tiger/GENZ2023/shp/).
