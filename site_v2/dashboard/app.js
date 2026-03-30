const DATA_URL = "../data/district_dataset.json";

const state = {
  districtSearch: "",
  county: "all",
  hasPolicy: "all",
  sizeClass: "all",
  minorityBand: "all",
  povertyBand: "all",
  snapBand: "all",
  sortKey: "district_name",
  sortDirection: "asc",
};

const el = {
  districtSearch: document.getElementById("districtSearch"),
  countySelect: document.getElementById("countySelect"),
  policySelect: document.getElementById("policySelect"),
  sizeSelect: document.getElementById("sizeSelect"),
  minoritySelect: document.getElementById("minoritySelect"),
  povertySelect: document.getElementById("povertySelect"),
  snapSelect: document.getElementById("snapSelect"),
  resetBtn: document.getElementById("resetBtn"),
  kpiContainer: document.getElementById("kpiContainer"),
  districtTbody: document.getElementById("districtTbody"),
  lastUpdated: document.getElementById("lastUpdated"),
  sortButtons: Array.from(document.querySelectorAll(".sort-button")),
};

const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

let payload = { summary: {}, records: [] };

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function buildSelect(select, values, allLabel = "All") {
  select.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = allLabel;
  select.appendChild(all);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
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
  return fmtInt.format(value);
}

function band(value, type) {
  if (value === null || value === undefined) return "missing";
  const percent = value * 100;
  if (type === "minority") {
    if (percent < 25) return "Under 25%";
    if (percent < 50) return "25% to 49.9%";
    return "50% and above";
  }
  if (type === "poverty" || type === "snap") {
    if (percent < 10) return "Under 10%";
    if (percent < 20) return "10% to 19.9%";
    return "20% and above";
  }
  return "missing";
}

function filteredRecords() {
  const rows = payload.records.filter((record) => {
    if (
      state.districtSearch &&
      !record.district_name.toLowerCase().includes(state.districtSearch.toLowerCase())
    ) {
      return false;
    }
    if (state.county !== "all" && record.county !== state.county) return false;
    if (state.hasPolicy === "yes" && !record.has_ai_policy) return false;
    if (state.hasPolicy === "no" && record.has_ai_policy) return false;
    if (state.sizeClass !== "all" && record.district_size_class !== state.sizeClass) return false;
    if (state.minorityBand !== "all" && band(record.minority_enrollment, "minority") !== state.minorityBand) {
      return false;
    }
    if (state.povertyBand !== "all" && band(record.below_poverty, "poverty") !== state.povertyBand) {
      return false;
    }
    if (state.snapBand !== "all" && band(record.snap, "snap") !== state.snapBand) return false;
    return true;
  });

  return rows.sort(compareRecords);
}

function compareValues(left, right, type = "text") {
  if (type === "number") return left - right;
  if (type === "boolean") return Number(left) - Number(right);
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function compareRecords(left, right) {
  const key = state.sortKey;
  const direction = state.sortDirection === "asc" ? 1 : -1;
  const leftMissing = left[key] === null || left[key] === undefined || left[key] === "";
  const rightMissing = right[key] === null || right[key] === undefined || right[key] === "";

  if (leftMissing && rightMissing) {
    return left.district_name.localeCompare(right.district_name);
  }
  if (leftMissing) return 1;
  if (rightMissing) return -1;

  const sortType =
    key === "minority_enrollment" || key === "below_poverty" || key === "snap" || key === "population"
      ? "number"
      : key === "has_ai_policy"
        ? "boolean"
        : "text";

  const primary = compareValues(left[key], right[key], sortType);
  if (primary !== 0) return primary * direction;
  return left.district_name.localeCompare(right.district_name) * direction;
}

function updateSortButtons() {
  el.sortButtons.forEach((button) => {
    const isActive = button.dataset.sort === state.sortKey;
    button.classList.toggle("active", isActive);
    const arrow = isActive ? (state.sortDirection === "asc" ? " ↑" : " ↓") : "";
    button.textContent = `${button.dataset.label || button.textContent.replace(/ [↑↓]$/, "")}${arrow}`;
  });
}

function renderKPIs(records) {
  const withPolicy = records.filter((record) => record.has_ai_policy).length;
  const withLabels = records.filter((record) => record.policy_label).length;
  const counties = new Set(records.map((record) => record.county).filter(Boolean)).size;

  const cards = [
    { label: "Visible Districts", value: records.length },
    { label: "Has AI Policy", value: withPolicy },
    { label: "Has Policy Label", value: withLabels },
    { label: "Counties", value: counties },
  ];

  el.kpiContainer.innerHTML = cards
    .map(
      (card) => `
        <div class="kpi">
          <div class="label">${card.label}</div>
          <div class="value">${card.value}</div>
        </div>
      `,
    )
    .join("");
}

function policyBadge(flag) {
  return `<span class="badge ${flag ? "yes" : "no"}">${flag ? "Yes" : "No"}</span>`;
}

function renderTable(records) {
  const sorted = records.slice(0, 300);
  el.districtTbody.innerHTML =
    sorted
      .map(
        (record) => `
          <tr>
            <td><strong>${safeText(record.district_name)}</strong></td>
            <td>${safeText(record.county)}</td>
            <td>${formatPercent(record.minority_enrollment)}</td>
            <td>${formatPercent(record.below_poverty)}</td>
            <td>${formatPercent(record.snap)}</td>
            <td>${formatPopulation(record.population)}</td>
            <td>${policyBadge(record.has_ai_policy)}</td>
            <td>${safeText(record.policy_label)}</td>
            <td>${record.policy_link ? `<a href="${record.policy_link}" target="_blank" rel="noopener noreferrer">Open policy</a>` : "Not available"}</td>
          </tr>
        `,
      )
      .join("") ||
    `<tr><td colspan="9" style="text-align:center; color:#5c6f73;">No districts match current filters.</td></tr>`;
}

function renderAll() {
  const rows = filteredRecords();
  updateSortButtons();
  renderKPIs(rows);
  renderTable(rows);
}

function wireEvents() {
  el.districtSearch.addEventListener("input", () => {
    state.districtSearch = el.districtSearch.value.trim();
    renderAll();
  });
  el.countySelect.addEventListener("change", () => {
    state.county = el.countySelect.value;
    renderAll();
  });
  el.policySelect.addEventListener("change", () => {
    state.hasPolicy = el.policySelect.value;
    renderAll();
  });
  el.sizeSelect.addEventListener("change", () => {
    state.sizeClass = el.sizeSelect.value;
    renderAll();
  });
  el.minoritySelect.addEventListener("change", () => {
    state.minorityBand = el.minoritySelect.value;
    renderAll();
  });
  el.povertySelect.addEventListener("change", () => {
    state.povertyBand = el.povertySelect.value;
    renderAll();
  });
  el.snapSelect.addEventListener("change", () => {
    state.snapBand = el.snapSelect.value;
    renderAll();
  });
  el.resetBtn.addEventListener("click", () => {
    state.districtSearch = "all";
    state.county = "all";
    state.hasPolicy = "all";
    state.sizeClass = "all";
    state.minorityBand = "all";
    state.povertyBand = "all";
    state.snapBand = "all";
    state.sortKey = "district_name";
    state.sortDirection = "asc";

    el.districtSearch.value = "";
    el.countySelect.value = "all";
    el.policySelect.value = "all";
    el.sizeSelect.value = "all";
    el.minoritySelect.value = "all";
    el.povertySelect.value = "all";
    el.snapSelect.value = "all";
    state.districtSearch = "";
    renderAll();
  });

  el.sortButtons.forEach((button) => {
    button.dataset.label = button.textContent;
    button.addEventListener("click", () => {
      const clickedKey = button.dataset.sort;
      if (state.sortKey === clickedKey) {
        state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = clickedKey;
        state.sortDirection = clickedKey === "district_name" || clickedKey === "county" ? "asc" : "desc";
      }
      renderAll();
    });
  });
}

async function initialize() {
  const resp = await fetch(DATA_URL);
  if (!resp.ok) {
    throw new Error(`Failed to load ${DATA_URL} (${resp.status})`);
  }

  payload = await resp.json();

  buildSelect(el.countySelect, unique(payload.records.map((record) => record.county)), "All counties");
  buildSelect(
    el.sizeSelect,
    unique(payload.records.map((record) => record.district_size_class)),
    "All sizes",
  );
  buildSelect(el.minoritySelect, ["Under 25%", "25% to 49.9%", "50% and above", "missing"], "All values");
  buildSelect(el.povertySelect, ["Under 10%", "10% to 19.9%", "20% and above", "missing"], "All values");
  buildSelect(el.snapSelect, ["Under 10%", "10% to 19.9%", "20% and above", "missing"], "All values");

  el.lastUpdated.textContent = `Updated ${payload.summary.generated_at || "Not available"}`;
  wireEvents();
  renderAll();
}

initialize().catch((err) => {
  el.kpiContainer.innerHTML = `<div class="kpi"><div class="label">Error</div><div class="value">${err.message}</div></div>`;
});
