/* AE4cast field map — counties when zoomed out, fields when zoomed in.
   Reads manifest.json (written by the publisher) and PMTiles archives by byte range.
   Override the manifest for local tests with ?manifest=test/manifest.fixture.json. */
(function () {
  "use strict";

  // The published manifest (Cloudflare R2 custom domain tiles.ae4cast.com + /manifest.json). Set at deploy time.
  var MANIFEST_URL = "https://tiles.ae4cast.com/manifest.json";
  var FIELD_ZOOM = 9;                  // fields visible from this zoom; counties below it
  var PREDICTION_SENTENCE = "Field crop and field yield are model predictions on the latest public field boundaries";
  var COLORS = { corn: "#ffd300", soy: "#267300", grey: "#cccccc" };
  var COUNTY_NAMES_URL = "counties.json";    // fips -> "Name, ST" (Census cartographic county boundaries); same directory as the page
  var STATES_URL = "states.geojson";         // Census 20 m state boundaries, drawn on top of the basemap
  var RAMP = ["#eff6ff", "#bfdbfe", "#60a5fa", "#2563eb", "#1e3a8a"];   // county choropleth, low to high

  // ?manifest= is for local tests only: a same-origin relative path (no scheme, no leading //).
  var qs = new URLSearchParams(location.search);
  var override = qs.get("manifest");
  var manifestUrl = (override && /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.json$/.test(override) && override.indexOf("..") < 0 && override.indexOf("//") < 0) ? override : MANIFEST_URL;
  var el = function (id) { return document.getElementById(id); };
  var banner = el("banner");
  function esc(v) {   // every value that reaches innerHTML goes through here
    return String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showError(msg) {
    banner.textContent = msg;
    banner.hidden = false;
    el("status").textContent = "";
  }
  function fmt(x, d) {
    if (x === null || x === undefined || x === "" || isNaN(x)) return "n/a";
    return Number(x).toLocaleString("en-US", { maximumFractionDigits: d === undefined ? 1 : d, minimumFractionDigits: d === undefined ? 1 : d });
  }
  function fmtAc(x) { return (x === null || x === undefined || isNaN(x)) ? "n/a" : Math.round(Number(x)).toLocaleString("en-US"); }

  // ---- PMTiles protocol ------------------------------------------------------
  if (typeof pmtiles === "undefined" || typeof maplibregl === "undefined") {
    showError("The map libraries did not load (MapLibre GL or pmtiles.js). Check the network and the script URLs.");
    return;
  }
  var protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  var map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        basemap: {   // CARTO Voyager: a standard street map with place names and administrative borders
          type: "raster", tileSize: 256,
          tiles: ["https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png"],
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a> · state and county boundaries: US Census Bureau'
        }
      },
      layers: [{ id: "basemap", type: "raster", source: "basemap" }]
    },
    center: [-93.5, 41.5], zoom: 5, minZoom: 3, maxZoom: 16, attributionControl: true
  });
  map.addControl(new maplibregl.NavigationControl(), "top-left");
  map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }));

  var manifest = null, current = null;   // current = the selected snapshot entry
  var countyNames = {};                  // fips (string, no leading zeros) -> "Name, ST"; empty until counties.json loads
  fetch(COUNTY_NAMES_URL, { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (d && d.names) countyNames = d.names;
  }).catch(function () { /* popups fall back to the FIPS code */ });
  function countyLabel(fips) {
    var k = String(Number(fips));   // tiles carry fips as a number (19153); counties.json keys are the same digits
    return countyNames[k] ? countyNames[k] + " (FIPS " + k + ")" : "County " + k;
  }
  // state borders on top of the basemap and the county fill; the source is added once the style is ready
  function addStateBorders() {
    if (map.getSource("states")) return;
    map.addSource("states", { type: "geojson", data: STATES_URL });
    map.addLayer({ id: "state-line", type: "line", source: "states",
      paint: { "line-color": "#1f2937", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 8, 2.0, 12, 2.5], "line-opacity": 0.9 } });
  }

  // ---- manifest and selectors -----------------------------------------------
  fetch(manifestUrl, { cache: "no-cache" }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status + " for " + manifestUrl);
    return r.json();
  }).then(function (m) {
    manifest = m;
    var seasons = (m.seasons || []).filter(function (s) { return s.snapshots && s.snapshots.length; });
    if (!seasons.length) throw new Error("The manifest lists no seasons with snapshots (" + manifestUrl + ")");
    seasons.sort(function (a, b) { return b.year - a.year; });
    var sel = el("season");
    seasons.forEach(function (s) {
      var o = document.createElement("option"); o.value = s.year; o.textContent = s.year; sel.appendChild(o);
    });
    sel.addEventListener("change", function () { fillDates(seasons, Number(sel.value)); });
    fillDates(seasons, seasons[0].year);
  }).catch(function (e) {
    showError("Could not load the forecast manifest: " + e.message + ". The map cannot show any snapshot until the manifest at " + manifestUrl + " is reachable.");
  });

  function fillDates(seasons, year) {
    var s = seasons.filter(function (x) { return x.year === year; })[0];
    var sel = el("date"); sel.innerHTML = "";
    var snaps = s.snapshots.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    snaps.forEach(function (e) {
      var o = document.createElement("option");
      o.value = e.date;
      o.textContent = e.date + (e.tiles_ok ? "" : " (unavailable)") + (e.yield_line === "none" ? " · areas only" : e.yield_line === "v2.1" ? " · weather-only yield" : "");
      o.disabled = !e.tiles_ok;
      sel.appendChild(o);
    });
    sel.onchange = function () { loadSnapshot(snaps.filter(function (e) { return e.date === sel.value; })[0]); };
    var first = snaps.filter(function (e) { return e.tiles_ok; })[0];
    if (!first) { showError("Every snapshot of season " + year + " is marked unavailable in the manifest."); return; }
    sel.value = first.date;
    loadSnapshot(first);
  }

  // ---- layers ----------------------------------------------------------------
  var LAYERS = ["county-fill", "county-pick", "county-line", "field-fill", "field-silage", "field-line"];
  function removeLayers() {
    LAYERS.forEach(function (id) { if (map.getLayer(id)) map.removeLayer(id); });
    ["counties", "fields"].forEach(function (id) { if (map.getSource(id)) map.removeSource(id); });
  }
  var BELOW = "state-line";   // snapshot layers are inserted under the state borders so the borders stay on top

  function metricExpr(metric) {
    // null (no forecast / zero grain) -> grey; otherwise a 5-step ramp between the 5th and 95th percentile proxies
    var stops = metric.indexOf("planted") >= 0 ? [0, 25000, 75000, 150000, 300000]
      : metric.indexOf("soy") >= 0 ? [35, 45, 52, 58, 66] : [120, 150, 175, 195, 220];
    var ramp = ["interpolate", ["linear"], ["to-number", ["get", metric], -1]];
    stops.forEach(function (v, i) { ramp.push(v, RAMP[i]); });
    return ["case", ["==", ["typeof", ["get", metric]], "number"], ramp, COLORS.grey];
  }

  function addLayers(entry) {
    removeLayers();
    addStateBorders();
    map.addSource("counties", { type: "vector", url: "pmtiles://" + entry.counties_url, minzoom: 3, maxzoom: 9 });
    map.addSource("fields", { type: "vector", url: "pmtiles://" + entry.fields_url, minzoom: 9, maxzoom: 14 });
    var metric = el("metric").value;
    map.addLayer({ id: "county-fill", type: "fill", source: "counties", "source-layer": "counties", maxzoom: FIELD_ZOOM,
      paint: { "fill-color": metricExpr(metric), "fill-opacity": 0.7 } }, BELOW);
    // invisible county polygons at every zoom (the z9 tiles overzoom): lets a field click find its county
    map.addLayer({ id: "county-pick", type: "fill", source: "counties", "source-layer": "counties",
      paint: { "fill-color": "#000000", "fill-opacity": 0 } }, BELOW);
    map.addLayer({ id: "county-line", type: "line", source: "counties", "source-layer": "counties",
      paint: { "line-color": "#64748b", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.2, 9, 1.2] } }, BELOW);
    var cropColor = ["match", ["get", "crop"], "corn", COLORS.corn, "soy", COLORS.soy, COLORS.grey];
    var useOpacity = ["match", ["get", "use"], "not_harvested", 0.4, "soy_not_harvested", 0.4, 0.85];
    map.addLayer({ id: "field-fill", type: "fill", source: "fields", "source-layer": "fields", minzoom: FIELD_ZOOM,
      paint: { "fill-color": cropColor, "fill-opacity": useOpacity } }, BELOW);
    map.addLayer({ id: "field-silage", type: "fill", source: "fields", "source-layer": "fields", minzoom: FIELD_ZOOM,
      filter: ["==", ["get", "use"], "silage"], paint: { "fill-pattern": "hatch", "fill-opacity": 0.9 } }, BELOW);
    map.addLayer({ id: "field-line", type: "line", source: "fields", "source-layer": "fields", minzoom: 11,
      paint: { "line-color": "#334155", "line-width": 0.4, "line-opacity": 0.6 } }, BELOW);
    drawRamp(metric);
  }

  function drawRamp(metric) {
    var ramp = el("legend-ramp"); ramp.innerHTML = "";
    RAMP.forEach(function (c) { var s = document.createElement("span"); s.style.background = c; ramp.appendChild(s); });
    var lab = document.createElement("div"); lab.className = "legend-ramp-labels";
    var unit = metric.indexOf("planted") >= 0 ? "acres" : "bu/ac";
    lab.innerHTML = "<span>low</span><span>" + metric.replace(/_/g, " ") + " (" + unit + ")</span><span>high</span>";
    ramp.parentNode.insertBefore(lab, ramp.nextSibling);
    var old = ramp.parentNode.querySelectorAll(".legend-ramp-labels");
    for (var i = 0; i < old.length - 1; i++) old[i].remove();
  }

  function hatchImage() {
    var c = document.createElement("canvas"); c.width = 8; c.height = 8;
    var ctx = c.getContext("2d");
    ctx.fillStyle = COLORS.corn; ctx.fillRect(0, 0, 8, 8);
    ctx.strokeStyle = "#7a6400"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(8, 0); ctx.stroke();
    return ctx.getImageData(0, 0, 8, 8);
  }

  function loadSnapshot(entry) {
    if (!entry) return;
    current = entry;
    el("csb").textContent = entry.csb_vintage || "n/a";
    el("asof").textContent = entry.date;
    el("weather").textContent = entry.weather_through || "n/a";
    el("proto").textContent = "protocol: " + (entry.protocol || "n/a") + " · basis: " + (entry.basis || "n/a") + " · yield line: " + (entry.yield_line || "n/a");
    el("status").textContent = entry.yield_line === "none" ? "Areas and field crops only (no yield report yet)" : entry.yield_line === "v2.1" ? "Weather-only yields (before the first USDA yield report)" : "";
    var go = function () { if (!map.hasImage("hatch")) map.addImage("hatch", hatchImage()); addLayers(entry); };
    if (map.loaded()) go(); else map.once("load", go);
  }

  el("metric").addEventListener("change", function () {
    if (map.getLayer("county-fill")) { map.setPaintProperty("county-fill", "fill-color", metricExpr(el("metric").value)); drawRamp(el("metric").value); }
  });

  // ---- popups ----------------------------------------------------------------
  function row(k, v) { return "<tr><td>" + esc(k) + "</td><td class='v'>" + esc(v) + "</td></tr>"; }
  function labels(p) {
    return "As of " + esc(p.asof || (current && current.date) || "") + " · " + esc(p.protocol || (current && current.protocol) || "") +
      " · basis: " + esc(p.basis || (current && current.basis) || "");
  }
  function countyPopup(p) {
    var cornNH = (p.corn_planted != null && p.corn_grain != null && p.corn_silage != null) ? p.corn_planted - p.corn_grain - p.corn_silage : null;
    var soyNH = (p.soy_planted != null && p.soy_harvested != null) ? p.soy_planted - p.soy_harvested : null;
    var noFc = p.status === "no_forecast";
    var h = "<h4>" + esc(countyLabel(p.fips)) + (noFc ? " · no forecast" : "") + "</h4>";
    if (noFc) return h + "<div class='small'>No AF1 area forecast for this county on " + esc(p.asof || "") + ".<br>" + labels(p) + "</div>";
    h += "<table>" +
      row("Corn planted", fmtAc(p.corn_planted) + " ac") + row("Corn grain harvested", fmtAc(p.corn_grain) + " ac") +
      row("Corn silage", fmtAc(p.corn_silage) + " ac") + row("Corn not harvested", fmtAc(cornNH) + " ac") +
      row("Corn yield, conditional", (p.corn_yield == null ? "n/a" : fmt(p.corn_yield) + " bu/ac")) +
      row("Corn yield, weather-only", (p.corn_yield_uncond == null ? "n/a" : fmt(p.corn_yield_uncond) + " bu/ac")) +
      row("Soybean planted", fmtAc(p.soy_planted) + " ac") + row("Soybean harvested", fmtAc(p.soy_harvested) + " ac") +
      row("Soybean not harvested", fmtAc(soyNH) + " ac") +
      row("Soybean yield, conditional", (p.soy_yield == null ? "n/a" : fmt(p.soy_yield) + " bu/ac")) +
      row("Soybean yield, weather-only", (p.soy_yield_uncond == null ? "n/a" : fmt(p.soy_yield_uncond) + " bu/ac")) +
      row("USDA state corn / soy", fmt(p.usda_state_corn, 0) + " / " + fmt(p.usda_state_soy, 0) + " bu/ac") +
      row("Stages (area / yield)", (p.stage_area || "n/a") + " / " + (p.stage_yield || "n/a")) + "</table>";
    var extras = [];
    if (p.unplaced_acres_corn > 0 || p.unplaced_acres_soy > 0) extras.push("unplaced acres (no land in the rotation layer): corn " + fmtAc(p.unplaced_acres_corn) + ", soy " + fmtAc(p.unplaced_acres_soy));
    if (p.fields_short_corn_grain > 0 || p.fields_short_corn_silage > 0 || p.fields_short_soy_harvested > 0) extras.push("fields short of the county total: grain " + fmtAc(p.fields_short_corn_grain) + ", silage " + fmtAc(p.fields_short_corn_silage) + ", soy " + fmtAc(p.fields_short_soy_harvested) + " ac");
    h += "<div class='small'>" + labels(p) + (extras.length ? "<br>" + esc(extras.join(" · ")) : "") +
      "<br>" + esc(PREDICTION_SENTENCE) + " (CSB " + esc(current ? current.csb_vintage : "") + ").</div>";
    return h;
  }
  function fieldPopup(p, county) {   // county = the county-pick feature under the click (null when none)
    var crop = p.crop === "corn" ? "Corn" : p.crop === "soy" ? "Soybeans" : "Other";
    var use = String(p.use || "").replace(/_/g, " ");
    var unit = p.use === "silage" ? " bu/ac (grain equivalent)" : " bu/ac";
    var h = "<h4>" + esc(crop + (use ? " · " + use : "")) + "</h4><table>" +
      row("Predicted yield", (p.yield == null ? "n/a" : fmt(p.yield) + unit)) +
      row("Chance corn / soy", fmt(p.p_corn, 2) + " / " + fmt(p.p_soy, 2)) +
      row("Last year's crop", p.last_crop || "n/a") + row("County", county ? countyLabel(county.properties.fips) : "n/a") + row("Field id", p.field_id) + "</table>" +
      "<div class='small'>" + esc(PREDICTION_SENTENCE) + " (CSB " + esc(current ? current.csb_vintage : "") + ").<br>" + labels(p) + "</div>";
    return h;
  }
  map.on("click", "county-fill", function (e) {
    if (map.getZoom() >= FIELD_ZOOM) return;
    new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(e.lngLat).setHTML(countyPopup(e.features[0].properties)).addTo(map);
  });
  map.on("click", "field-fill", function (e) {
    var picked = map.getLayer("county-pick") ? map.queryRenderedFeatures(e.point, { layers: ["county-pick"] }) : [];
    new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(e.lngLat).setHTML(fieldPopup(e.features[0].properties, picked.length ? picked[0] : null)).addTo(map);
  });
  ["county-fill", "field-fill"].forEach(function (id) {
    map.on("mouseenter", id, function () { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", id, function () { map.getCanvas().style.cursor = ""; });
  });
  map.on("error", function (e) {
    var msg = e && e.error && e.error.message ? e.error.message : String(e);
    if (/pmtiles|range|fetch|Failed/i.test(msg)) showError("Tile request failed: " + msg + ". The tiles may be unreachable (storage origin or CORS), or this snapshot's archives are missing.");
  });
})();
