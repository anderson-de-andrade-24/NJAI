const MAP_CENTER = [40.19, -74.67];
const MAP_ZOOM = 8;
const POLICY_DATA_URL = "./data/policies.json";
const DISTRICT_GEOJSON_URL = "./data/nj-school-districts.geojson";

const mapHint = document.getElementById("map-hint");
const panelTitle = document.getElementById("panel-title");
const panelSubtitle = document.getElementById("panel-subtitle");
const panelContent = document.getElementById("panel-content");
const counts = document.getElementById("counts");
const searchInput = document.getElementById("search");
const districtTypeSelect = document.getElementById("district-type");
const clearSelectionBtn = document.getElementById("clear-selection");

const map = L.map("map", { zoomControl: true }).setView(MAP_CENTER, MAP_ZOOM);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

let policies = [];
let policyIndex = new Map();
let allDistricts = null;
let geoLayer = null;
let selectedLayer = null;
let districtLookup = new Map();

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
};

function canonicalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bdisrict\b/g, "district")
    .replace(/\birvngton\b/g, "irvington")
    .replace(/\bpasssaic\b/g, "passaic")
    .replace(/\bsd\b/g, "school district");
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

function buildPolicyIndex(items) {
  const index = new Map();

  for (const item of items) {
    const key = normalizeName(item.district);
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(item);
  }

  return index;
}

function resolvePoliciesForDistrict(districtName) {
  const norm = normalizeName(districtName);
  if (!norm) return [];
  if (policyIndex.has(norm)) return policyIndex.get(norm);

  for (const [key, list] of policyIndex.entries()) {
    if (key.includes(norm) || norm.includes(key)) return list;
  }

  return [];
}

function findPolicyMatchesBySearch(query) {
  const needle = normalizeName(query);
  if (!needle) return [];

  return policies.filter((item) => {
    const key = normalizeName(item.district);
    return key && (key.includes(needle) || needle.includes(key));
  });
}

function renderCounts() {
  const total = policies.length;
  const withSource = policies.filter((p) => p.source_url).length;
  const linked = policies.filter((p) => p.status === "linked").length;
  const noneFound = policies.filter((p) => p.status === "none_found").length;
  const pending = policies.filter((p) => p.status === "pending").length;
  const districtCount = allDistricts?.features?.length || 0;
  counts.innerHTML = `
    <strong>Policy records:</strong> ${total}<br />
    <strong>With source URL:</strong> ${withSource}<br />
    <strong>Linked / None / Pending:</strong> ${linked} / ${noneFound} / ${pending}<br />
    <strong>Map polygons:</strong> ${districtCount}
  `;
}

function renderDistrictDetails(districtName, matches, districtType) {
  panelTitle.textContent = districtName;

  if (!matches.length) {
    panelSubtitle.textContent = `No policy linked yet (${typeLabels[districtType] || districtType || "District"}).`;
    panelContent.innerHTML = `
      <div class="policy-card">
        <h3>Next step</h3>
        <p>Add a matching district record to <code>data/policies.json</code> when the policy is found.</p>
      </div>
    `;
    return;
  }

  panelSubtitle.textContent = `${matches.length} policy entr${matches.length === 1 ? "y" : "ies"} found`;

  panelContent.innerHTML = matches
    .map((item) => {
      const pdfLink = item.policy_file
        ? `<p><a href="./${encodeURI(item.policy_file)}" target="_blank" rel="noopener noreferrer">Open saved PDF</a></p>`
        : "<p>Local PDF not saved yet.</p>";

      const source = item.source_url
        ? `<p><a href="${item.source_url}" target="_blank" rel="noopener noreferrer">School board source page</a></p>`
        : "<p>Source URL not added yet.</p>";

      const notes = item.notes ? `<p><strong>Notes:</strong> ${item.notes}</p>` : "";

      return `
        <article class="policy-card">
          <h3>${item.district}</h3>
          <p><strong>Map layer:</strong> ${typeLabels[districtType] || districtType || "Unknown"}</p>
          ${pdfLink}
          ${source}
          ${notes}
          <span class="status">${item.status || "collected"}</span>
        </article>
      `;
    })
    .join("");
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
  panelSubtitle.textContent = "Hover over a district on the map to preview details.";
  panelContent.innerHTML = "";
}

function clearSelection() {
  if (selectedLayer) {
    setLayerState(selectedLayer, false, false);
    selectedLayer = null;
  }

  resetPanel();
  searchInput.value = "";
}

function attachLayerEvents(layer, districtName, districtType) {
  layer.on("mouseover", () => {
    if (layer !== selectedLayer) setLayerState(layer, false, true);
    const matches = resolvePoliciesForDistrict(districtName);
    renderDistrictDetails(districtName, matches, districtType);
  });

  layer.on("mouseout", () => {
    if (layer !== selectedLayer) setLayerState(layer, false, false);
    if (!selectedLayer) resetPanel();
  });

  layer.on("click", () => {
    if (selectedLayer && selectedLayer !== layer) setLayerState(selectedLayer, false, false);
    selectedLayer = layer;
    setLayerState(layer, true, false);
    const matches = resolvePoliciesForDistrict(districtName);
    renderDistrictDetails(districtName, matches, districtType);
    map.fitBounds(layer.getBounds(), { maxZoom: 11 });
  });
}

function renderPolicyOnlyFallback() {
  mapHint.textContent =
    "District boundary file not found yet. Add data/nj-school-districts.geojson to enable hover on map polygons.";

  panelTitle.textContent = "Available policy files";
  panelSubtitle.textContent = "Map interactivity will activate after district GeoJSON is added.";

  const sorted = [...policies].sort((a, b) => a.district.localeCompare(b.district));
  panelContent.innerHTML = sorted
    .map(
      (item) => `
      <article class="policy-card">
        <h3>${item.district}</h3>
        ${
          item.policy_file
            ? `<p><a href="./${encodeURI(item.policy_file)}" target="_blank" rel="noopener noreferrer">Open saved PDF</a></p>`
            : "<p>Local PDF not saved yet.</p>"
        }
        ${
          item.source_url
            ? `<p><a href="${item.source_url}" target="_blank" rel="noopener noreferrer">School board source page</a></p>`
            : ""
        }
        <span class="status">${item.status || "collected"}</span>
      </article>
    `,
    )
    .join("");
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
      : allDistricts.features.filter((f) => getDistrictType(f) === selectedType);

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

        layer.bindTooltip(`${districtName} (${typeLabels[districtType] || districtType})`, {
          sticky: true,
          direction: "top",
        });
        attachLayerEvents(layer, districtName, districtType);
      },
    },
  ).addTo(map);

  if (geoLayer.getLayers().length) map.fitBounds(geoLayer.getBounds(), { padding: [10, 10] });

  mapHint.textContent =
    "Hover for preview, click to lock selection. Use district type to switch between Unified, Secondary, and Elementary boundaries.";

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
      renderDistrictDetails(featureName, resolvePoliciesForDistrict(featureName), featureType);
      map.fitBounds(layer.getBounds(), { maxZoom: 11 });
      return;
    }

    const policyMatches = findPolicyMatchesBySearch(searchInput.value);
    if (!policyMatches.length) return;

    if (selectedLayer) {
      setLayerState(selectedLayer, false, false);
      selectedLayer = null;
    }
    renderDistrictDetails(searchInput.value, policyMatches, "Policy-only");
  });

  districtTypeSelect.addEventListener("change", () => {
    searchInput.value = "";
    renderGeoLayer();
  });

  clearSelectionBtn.addEventListener("click", clearSelection);
}

async function loadDashboard() {
  const policyResp = await fetch(POLICY_DATA_URL);
  if (!policyResp.ok) {
    throw new Error(`Failed to load ${POLICY_DATA_URL} (${policyResp.status})`);
  }

  policies = await policyResp.json();
  policyIndex = buildPolicyIndex(policies);

  wireSearch();

  try {
    const districtResp = await fetch(DISTRICT_GEOJSON_URL);
    if (!districtResp.ok) throw new Error(`HTTP ${districtResp.status}`);

    allDistricts = await districtResp.json();
    if (!allDistricts.features?.length) throw new Error("No features found");

    renderGeoLayer();
    renderCounts();
  } catch {
    renderCounts();
    renderPolicyOnlyFallback();
  }
}

loadDashboard().catch((err) => {
  mapHint.textContent = "Could not load dashboard data.";
  panelTitle.textContent = "Error";
  panelSubtitle.textContent = "Dashboard initialization failed.";
  panelContent.innerHTML = `<div class="policy-card"><p>${err.message}</p></div>`;
});
