const MAP_CENTER = [40.19, -74.67];
const MAP_ZOOM = 8;
const DATA_URL = "./data/district_dataset.json";
const DISTRICT_GEOJSON_URL = "./data/nj-school-districts.geojson";

const mapHint = document.getElementById("map-hint");
const panelTitle = document.getElementById("panel-title");
const panelSubtitle = document.getElementById("panel-subtitle");
const panelContent = document.getElementById("panel-content");
const searchInput = document.getElementById("search");
const districtTypeSelect = document.getElementById("district-type");
const clearSelectionBtn = document.getElementById("clear-selection");

const map = L.map("map", { zoomControl: true }).setView(MAP_CENTER, MAP_ZOOM);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

let allDistricts = null;
let geoLayer = null;
let selectedLayer = null;
let districtLookup = new Map();
let records = [];
let recordIndex = new Map();
let summary = {};

const stopwords = new Set([
  "district",
  "school",
  "schools",
  "board",
  "education",
  "township",
  "city",
  "borough",
  "regional",
  "public",
  "of",
  "the",
  "county",
]);

const typeLabels = {
  ALL: "All",
  U: "Unified",
  S: "Secondary",
  E: "Elementary",
  UNK: "Not classified",
};

function canonicalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/distrcit/g, "district")
    .replace(/\bdisrict\b/g, "district")
    .replace(/\birvngton\b/g, "irvington")
    .replace(/\bpasssaic\b/g, "passaic");
}

function normalizeName(name) {
  return canonicalizeName(name)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !stopwords.has(part))
    .join(" ");
}

function getDistrictName(feature) {
  const props = feature?.properties || {};
  return (
    props.DISTRICT ||
    props.DIST_NAME ||
    props.DISTRICT_NAME ||
    props.NAME ||
    props.name ||
    props.district ||
    "Unknown District"
  );
}

function getDistrictType(feature) {
  return feature?.properties?.SD_TYPE || "";
}

function resolveRecord(districtName) {
  const key = normalizeName(districtName);
  if (!key) return null;
  if (recordIndex.has(key)) return recordIndex.get(key);
  for (const [known, record] of recordIndex.entries()) {
    if (known.includes(key) || key.includes(known)) return record;
  }
  return null;
}

function safeText(value, fallback = "Not available") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function formatPercent(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  return `${(value * 100).toFixed(1)}%`;
}

function formatPopulation(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return safeText(value);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function yesNoPill(flag, yesLabel = "Yes", noLabel = "No") {
  return `<span class="pill ${flag ? "yes" : "no"}">${flag ? yesLabel : noLabel}</span>`;
}

function detailItem(label, value) {
  return `<div class="detail-item"><strong>${label}</strong>${value}</div>`;
}

function tableRows(items, countKey = "count", percentKey = "percent") {
  return Object.values(items)
    .map(
      (item) => `
        <tr>
          <td>${item.label}</td>
          <td>${formatPopulation(item[countKey])}</td>
          <td>${formatPercent(item[percentKey])}</td>
        </tr>
      `,
    )
    .join("");
}

function popupHtml(districtName, record, districtType) {
  if (!record) {
    return `
      <div class="popup-title">${districtName}</div>
      <div class="popup-row"><strong>Type:</strong> ${typeLabels[districtType] || districtType || "Unknown"}</div>
      <div class="popup-row"><strong>Data:</strong> Not available</div>
    `;
  }

  const link = record.policy_link
    ? `<a href="${record.policy_link}" target="_blank" rel="noopener noreferrer">Open policy</a>`
    : "Not available";

  return `
    <div class="popup-title">${record.district_name}</div>
    <div class="popup-row"><strong>County:</strong> ${safeText(record.county)}</div>
    <div class="popup-row"><strong>Enrollment:</strong> ${formatPopulation(record.total_enrollment)}</div>
    <div class="popup-row"><strong>AI policy:</strong> ${record.has_ai_policy ? "Yes" : "No"}</div>
    <div class="popup-row"><strong>Policy number:</strong> ${safeText(record.policy_number)}</div>
    <div class="popup-row"><strong>Students of color:</strong> ${formatPercent(record.students_of_color_percent)}</div>
    <div class="popup-row"><strong>FRPL:</strong> ${formatPercent(record.frpl_percent)}</div>
    <div class="popup-row"><strong>Policy link:</strong> ${link}</div>
  `;
}

function renderDistrictDetails(districtName, record, districtType) {
  panelTitle.textContent = districtName;

  if (!record) {
    panelSubtitle.textContent = `No merged district record found (${typeLabels[districtType] || districtType || "District"}).`;
    panelContent.innerHTML = `
      <div class="detail-card">
        <h3>Available data</h3>
        <p>This district boundary is present, but the workbook record was not matched.</p>
      </div>
    `;
    return;
  }

  const policyDates = record.policy_dates?.length
    ? record.policy_dates.map(formatDate).join(", ")
    : "Not available";

  panelSubtitle.textContent = `${record.district_type_label || typeLabels[districtType] || "District"} district`;
  panelContent.innerHTML = `
    <article class="detail-card hero-card">
      <div class="hero-top">
        <div>
          <h3>${record.district_name}</h3>
          <p>${safeText(record.county)} County</p>
        </div>
        <div class="hero-pills">
          ${yesNoPill(record.has_ai_policy, "AI Policy", "No AI Policy")}
          ${yesNoPill(record.has_se_policy, "SE Listed", "No SE")}
        </div>
      </div>
      <div class="detail-grid">
        ${detailItem("Enrollment", formatPopulation(record.total_enrollment))}
        ${detailItem("District Type", safeText(record.district_type_label))}
        ${detailItem("Schools", formatPopulation(record.number_of_schools))}
        ${detailItem("Urbanicity", safeText(record.urbanicity))}
        ${detailItem("Students of Color", formatPercent(record.students_of_color_percent))}
        ${detailItem("FRPL", formatPercent(record.frpl_percent))}
        ${detailItem("Multilingual Learners", formatPercent(record.multilingual_percent))}
        ${detailItem("Policy Number", safeText(record.policy_number))}
      </div>
    </article>

    <details class="detail-card accordion" open>
      <summary>Policy & District Profile</summary>
      <div class="detail-grid">
        ${detailItem("County Code", safeText(record.county_code))}
        ${detailItem("District Code", safeText(record.district_code))}
        ${detailItem("Adopted", formatDate(record.policy_adopted))}
        ${detailItem("Policy Timeline", policyDates)}
        ${detailItem("Serves PK-8", yesNoPill(record.district_profile?.serves_primary))}
        ${detailItem("Serves 9-12", yesNoPill(record.district_profile?.serves_secondary))}
        ${detailItem("Unified", yesNoPill(record.district_profile?.serves_unified))}
        ${detailItem("Urbanicity Score", safeText(record.urbanicity_score))}
      </div>
      <div class="link-row">
        ${
          record.policy_link
            ? `<a href="${record.policy_link}" target="_blank" rel="noopener noreferrer">Open policy document</a>`
            : "<span>Policy document not available</span>"
        }
      </div>
    </details>

    <details class="detail-card accordion">
      <summary>Race Composition</summary>
      <div class="table-block">
        <table class="mini-table">
          <thead>
            <tr><th>Category</th><th>Count</th><th>Percent</th></tr>
          </thead>
          <tbody>${tableRows(record.race_breakdown || {})}</tbody>
        </table>
      </div>
    </details>

    <details class="detail-card accordion">
      <summary>Grade Distribution</summary>
      <div class="table-block">
        <table class="mini-table">
          <thead>
            <tr><th>Grade</th><th>Count</th><th>Percent</th></tr>
          </thead>
          <tbody>${tableRows(record.grade_breakdown || {})}</tbody>
        </table>
      </div>
    </details>

    <details class="detail-card accordion">
      <summary>Student Support Indicators</summary>
      <div class="table-block">
        <table class="mini-table">
          <thead>
            <tr><th>Indicator</th><th>Count</th><th>Percent</th></tr>
          </thead>
          <tbody>${tableRows(record.student_support || {})}</tbody>
        </table>
      </div>
    </details>
  `;
}

function getBaseStyleForType(type) {
  if (type === "E") {
    return { color: "#4f6757", weight: 1, fillColor: "#9bbf8f", fillOpacity: 0.42 };
  }
  if (type === "S") {
    return { color: "#355c7d", weight: 1, fillColor: "#6c99bf", fillOpacity: 0.42 };
  }
  return { color: "#35634a", weight: 1, fillColor: "#69a382", fillOpacity: 0.42 };
}

function setLayerState(layer, selected = false, hovered = false) {
  const type = getDistrictType(layer.feature);
  const base = getBaseStyleForType(type);
  const active = {
    color: "#0f3f26",
    weight: 2,
    fillColor: "#2e8b57",
    fillOpacity: 0.65,
  };

  layer.setStyle(selected || hovered ? active : base);
}

function resetPanel() {
  panelTitle.textContent = "Select a district";
  panelSubtitle.textContent = "Hover over a district to preview high-level data, then click to explore full district details.";
  panelContent.innerHTML = "";
}

function clearSelection() {
  if (selectedLayer) {
    setLayerState(selectedLayer, false, false);
    selectedLayer.closePopup();
    selectedLayer = null;
  }
  resetPanel();
  searchInput.value = "";
}

function attachLayerEvents(layer, districtName, districtType) {
  const record = resolveRecord(districtName);
  layer.bindTooltip(`${districtName} (${typeLabels[districtType] || districtType})`, {
    sticky: true,
    direction: "top",
  });
  layer.bindPopup(popupHtml(districtName, record, districtType));

  layer.on("mouseover", () => {
    if (layer !== selectedLayer) setLayerState(layer, false, true);
    renderDistrictDetails(districtName, record, districtType);
  });

  layer.on("mouseout", () => {
    if (layer !== selectedLayer) setLayerState(layer, false, false);
    if (!selectedLayer) resetPanel();
  });

  layer.on("click", () => {
    if (selectedLayer && selectedLayer !== layer) setLayerState(selectedLayer, false, false);
    selectedLayer = layer;
    setLayerState(layer, true, false);
    renderDistrictDetails(districtName, record, districtType);
    layer.setPopupContent(popupHtml(districtName, record, districtType)).openPopup();
    map.fitBounds(layer.getBounds(), { maxZoom: 11 });
  });
}

function renderGeoLayer() {
  if (!allDistricts?.features?.length) return;

  if (geoLayer) map.removeLayer(geoLayer);
  districtLookup = new Map();
  selectedLayer = null;

  const selectedType = districtTypeSelect.value;
  const filteredFeatures =
    selectedType === "ALL"
      ? allDistricts.features
      : allDistricts.features.filter((feature) => getDistrictType(feature) === selectedType);

  geoLayer = L.geoJSON(
    { type: "FeatureCollection", features: filteredFeatures },
    {
      style(feature) {
        return getBaseStyleForType(getDistrictType(feature));
      },
      onEachFeature(feature, layer) {
        const districtName = getDistrictName(feature);
        const districtType = getDistrictType(feature);
        const norm = normalizeName(districtName);
        if (norm && !districtLookup.has(norm)) districtLookup.set(norm, layer);
        attachLayerEvents(layer, districtName, districtType);
      },
    },
  ).addTo(map);

  if (geoLayer.getLayers().length) map.fitBounds(geoLayer.getBounds(), { padding: [10, 10] });
  mapHint.textContent =
    "Hover to preview, click to lock a district, and expand the side-panel sections for full workbook detail.";
  resetPanel();
}

function wireSearch() {
  searchInput.addEventListener("input", () => {
    const needle = normalizeName(searchInput.value);
    if (!needle) {
      if (!selectedLayer) resetPanel();
      return;
    }

    for (const [norm, layer] of districtLookup.entries()) {
      if (!norm.includes(needle)) continue;
      if (selectedLayer && selectedLayer !== layer) setLayerState(selectedLayer, false, false);
      selectedLayer = layer;
      setLayerState(layer, true, false);
      const featureName = getDistrictName(layer.feature);
      const featureType = getDistrictType(layer.feature);
      const record = resolveRecord(featureName);
      renderDistrictDetails(featureName, record, featureType);
      layer.setPopupContent(popupHtml(featureName, record, featureType)).openPopup();
      map.fitBounds(layer.getBounds(), { maxZoom: 11 });
      return;
    }

    const record = records.find((item) => normalizeName(item.district_name).includes(needle));
    if (!record) return;
    renderDistrictDetails(record.district_name, record, record.district_type);
    panelSubtitle.textContent = "Matched workbook record without polygon selection";
  });

  districtTypeSelect.addEventListener("change", () => {
    searchInput.value = "";
    renderGeoLayer();
  });

  clearSelectionBtn.addEventListener("click", clearSelection);
}

async function loadDashboard() {
  const dataResp = await fetch(DATA_URL);
  if (!dataResp.ok) {
    throw new Error(`Failed to load ${DATA_URL} (${dataResp.status})`);
  }

  const payload = await dataResp.json();
  records = payload.records || [];
  summary = payload.summary || {};
  recordIndex = new Map(records.map((record) => [normalizeName(record.district_name), record]));
  wireSearch();

  const districtResp = await fetch(DISTRICT_GEOJSON_URL);
  if (!districtResp.ok) {
    throw new Error(`Failed to load ${DISTRICT_GEOJSON_URL} (${districtResp.status})`);
  }

  allDistricts = await districtResp.json();
  renderGeoLayer();
}

loadDashboard().catch((err) => {
  mapHint.textContent = "Could not load dashboard data.";
  panelTitle.textContent = "Error";
  panelSubtitle.textContent = "Dashboard initialization failed.";
  panelContent.innerHTML = `<div class="detail-card"><p>${err.message}</p></div>`;
});
