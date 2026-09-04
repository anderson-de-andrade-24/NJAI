const DATA_URL = "../data/district_dataset.json";

const state = {
  districtSearch: "",
  county: "all",
  hasPolicy: "all",
  districtType: "all",
  urbanicity: "all",
  enrollmentBand: "all",
  frplBand: "all",
  multilingualBand: "all",
  sortKey: "district_name",
  sortDirection: "asc",
  selectedDistrict: "",
};

const el = {
  districtSearch: document.getElementById("districtSearch"),
  countySelect: document.getElementById("countySelect"),
  policySelect: document.getElementById("policySelect"),
  districtTypeSelect: document.getElementById("districtTypeSelect"),
  urbanicitySelect: document.getElementById("urbanicitySelect"),
  enrollmentSelect: document.getElementById("enrollmentSelect"),
  frplSelect: document.getElementById("frplSelect"),
  multilingualSelect: document.getElementById("multilingualSelect"),
  resetBtn: document.getElementById("resetBtn"),
  kpiContainer: document.getElementById("kpiContainer"),
  detailPanel: document.getElementById("detailPanel"),
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

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return safeText(value);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function badge(flag, yesLabel = "Yes", noLabel = "No") {
  return `<span class="badge ${flag ? "yes" : "no"}">${flag ? yesLabel : noLabel}</span>`;
}

function detailMetric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function rowsForBreakdown(items) {
  return Object.values(items || {})
    .map(
      (item) => `
        <tr>
          <td>${item.label}</td>
          <td>${formatPopulation(item.count)}</td>
          <td>${formatPercent(item.percent)}</td>
        </tr>
      `,
    )
    .join("");
}

function percentBand(value, thresholds) {
  if (value === null || value === undefined) return "missing";
  const percent = value * 100;
  if (percent < thresholds[0]) return `Under ${thresholds[0]}%`;
  if (percent < thresholds[1]) return `${thresholds[0]}% to ${thresholds[1] - 0.1}%`;
  return `${thresholds[1]}% and above`;
}

function enrollmentBand(value) {
  if (value === null || value === undefined) return "missing";
  if (value < 1000) return "Under 1,000";
  if (value < 5000) return "1,000 to 4,999";
  if (value < 10000) return "5,000 to 9,999";
  return "10,000 and above";
}

function getSelectedRecord(records) {
  if (!records.length) return null;
  if (state.selectedDistrict) {
    const found = records.find((record) => record.district_name === state.selectedDistrict);
    if (found) return found;
  }
  state.selectedDistrict = records[0].district_name;
  return records[0];
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
    if (state.districtType !== "all" && record.district_type_label !== state.districtType) return false;
    if (state.urbanicity !== "all" && safeText(record.urbanicity) !== state.urbanicity) return false;
    if (state.enrollmentBand !== "all" && enrollmentBand(record.total_enrollment) !== state.enrollmentBand) {
      return false;
    }
    if (state.frplBand !== "all" && percentBand(record.frpl_percent, [25, 50]) !== state.frplBand) {
      return false;
    }
    if (
      state.multilingualBand !== "all" &&
      percentBand(record.multilingual_percent, [5, 15]) !== state.multilingualBand
    ) {
      return false;
    }
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

  if (leftMissing && rightMissing) return left.district_name.localeCompare(right.district_name);
  if (leftMissing) return 1;
  if (rightMissing) return -1;

  const sortType =
    [
      "total_enrollment",
      "students_of_color_percent",
      "frpl_percent",
      "multilingual_percent",
      "urbanicity_score",
    ].includes(key)
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
    const label = button.dataset.label || button.textContent.replace(/ [↑↓]$/, "");
    const arrow = isActive ? (state.sortDirection === "asc" ? " ↑" : " ↓") : "";
    button.textContent = `${label}${arrow}`;
  });
}

function renderKPIs(records) {
  const withPolicy = records.filter((record) => record.has_ai_policy).length;
  const avgEnrollment = Math.round(
    records.reduce((sum, record) => sum + (record.total_enrollment || 0), 0) / Math.max(records.length, 1),
  );
  const avgFRPL =
    records.reduce((sum, record) => sum + (record.frpl_percent || 0), 0) / Math.max(records.length, 1);
  const avgMLL =
    records.reduce((sum, record) => sum + (record.multilingual_percent || 0), 0) / Math.max(records.length, 1);

  const cards = [
    { label: "Visible Districts", value: records.length },
    { label: "Has AI Policy", value: withPolicy },
    { label: "Average Enrollment", value: formatPopulation(avgEnrollment) },
    { label: "Average FRPL", value: formatPercent(avgFRPL) },
    { label: "Average MLL", value: formatPercent(avgMLL) },
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

function renderDetailPanel(record) {
  if (!record) {
    el.detailPanel.innerHTML = `
      <div class="empty-state">
        <h3>No districts match the current filters</h3>
        <p>Relax a filter or search term to bring district detail back into view.</p>
      </div>
    `;
    return;
  }

  const timeline = record.policy_dates?.length
    ? record.policy_dates.map(formatDate).join(", ")
    : "Not available";

  el.detailPanel.innerHTML = `
    <article class="detail-card">
      <div class="detail-top">
        <div>
          <h3>${record.district_name}</h3>
          <p>${safeText(record.county)} County • ${safeText(record.district_type_label)}</p>
        </div>
        <div class="badge-row">
          ${badge(record.has_ai_policy, "AI Policy", "No AI Policy")}
          ${badge(record.has_se_policy, "SE Listed", "No SE")}
        </div>
      </div>

      <div class="metrics-grid">
        ${detailMetric("Enrollment", formatPopulation(record.total_enrollment))}
        ${detailMetric("Students of Color", formatPercent(record.students_of_color_percent))}
        ${detailMetric("FRPL", formatPercent(record.frpl_percent))}
        ${detailMetric("MLL", formatPercent(record.multilingual_percent))}
        ${detailMetric("Schools", formatPopulation(record.number_of_schools))}
        ${detailMetric("Urbanicity", safeText(record.urbanicity))}
        ${detailMetric("Policy Number", safeText(record.policy_number))}
        ${detailMetric("Policy Adopted", formatDate(record.policy_adopted))}
      </div>
    </article>

    <div class="detail-sections">
      <details class="detail-card accordion" open>
        <summary>Policy & Profile</summary>
        <div class="compact-grid">
          ${detailMetric("County Code", safeText(record.county_code))}
          ${detailMetric("District Code", safeText(record.district_code))}
          ${detailMetric("Policy Timeline", timeline)}
          ${detailMetric("Urbanicity Score", safeText(record.urbanicity_score))}
          ${detailMetric("Serves PK-8", record.district_profile?.serves_primary ? "Yes" : "No")}
          ${detailMetric("Serves 9-12", record.district_profile?.serves_secondary ? "Yes" : "No")}
          ${detailMetric("Unified", record.district_profile?.serves_unified ? "Yes" : "No")}
        </div>
        <div class="action-row">
          ${
            record.policy_link
              ? `<a href="${record.policy_link}" target="_blank" rel="noopener noreferrer">Open policy document</a>`
              : "<span>Policy document not available</span>"
          }
        </div>
      </details>

      <details class="detail-card accordion">
        <summary>Race Composition</summary>
        <div class="table-scroll">
          <table class="mini-table">
            <thead><tr><th>Category</th><th>Count</th><th>Percent</th></tr></thead>
            <tbody>${rowsForBreakdown(record.race_breakdown)}</tbody>
          </table>
        </div>
      </details>

      <details class="detail-card accordion">
        <summary>Grade Distribution</summary>
        <div class="table-scroll">
          <table class="mini-table">
            <thead><tr><th>Grade</th><th>Count</th><th>Percent</th></tr></thead>
            <tbody>${rowsForBreakdown(record.grade_breakdown)}</tbody>
          </table>
        </div>
      </details>

      <details class="detail-card accordion">
        <summary>Student Support Indicators</summary>
        <div class="table-scroll">
          <table class="mini-table">
            <thead><tr><th>Indicator</th><th>Count</th><th>Percent</th></tr></thead>
            <tbody>${rowsForBreakdown(record.student_support)}</tbody>
          </table>
        </div>
      </details>
    </div>
  `;
}

function renderTable(records) {
  const selected = getSelectedRecord(records);
  renderDetailPanel(selected);

  el.districtTbody.innerHTML =
    records
      .map(
        (record) => `
          <tr class="${record.district_name === state.selectedDistrict ? "is-selected" : ""}">
            <td><strong>${safeText(record.district_name)}</strong></td>
            <td>${safeText(record.county)}</td>
            <td>${safeText(record.district_type_label)}</td>
            <td>${formatPopulation(record.total_enrollment)}</td>
            <td>${badge(record.has_ai_policy)}</td>
            <td>${formatPercent(record.students_of_color_percent)}</td>
            <td>${formatPercent(record.frpl_percent)}</td>
            <td>${formatPercent(record.multilingual_percent)}</td>
            <td>${safeText(record.urbanicity)}</td>
            <td><button class="row-action" type="button" data-district="${record.district_name}">Details</button></td>
          </tr>
        `,
      )
      .join("") ||
    `<tr><td colspan="10" class="empty-cell">No districts match current filters.</td></tr>`;

  Array.from(document.querySelectorAll(".row-action")).forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDistrict = button.dataset.district || "";
      renderAll();
    });
  });
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
  el.districtTypeSelect.addEventListener("change", () => {
    state.districtType = el.districtTypeSelect.value;
    renderAll();
  });
  el.urbanicitySelect.addEventListener("change", () => {
    state.urbanicity = el.urbanicitySelect.value;
    renderAll();
  });
  el.enrollmentSelect.addEventListener("change", () => {
    state.enrollmentBand = el.enrollmentSelect.value;
    renderAll();
  });
  el.frplSelect.addEventListener("change", () => {
    state.frplBand = el.frplSelect.value;
    renderAll();
  });
  el.multilingualSelect.addEventListener("change", () => {
    state.multilingualBand = el.multilingualSelect.value;
    renderAll();
  });
  el.resetBtn.addEventListener("click", () => {
    state.districtSearch = "";
    state.county = "all";
    state.hasPolicy = "all";
    state.districtType = "all";
    state.urbanicity = "all";
    state.enrollmentBand = "all";
    state.frplBand = "all";
    state.multilingualBand = "all";
    state.sortKey = "district_name";
    state.sortDirection = "asc";
    state.selectedDistrict = "";

    el.districtSearch.value = "";
    el.countySelect.value = "all";
    el.policySelect.value = "all";
    el.districtTypeSelect.value = "all";
    el.urbanicitySelect.value = "all";
    el.enrollmentSelect.value = "all";
    el.frplSelect.value = "all";
    el.multilingualSelect.value = "all";
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
    el.districtTypeSelect,
    unique(payload.records.map((record) => record.district_type_label)),
    "All district types",
  );
  buildSelect(
    el.urbanicitySelect,
    unique(payload.records.map((record) => safeText(record.urbanicity))),
    "All urbanicity",
  );
  buildSelect(el.enrollmentSelect, ["Under 1,000", "1,000 to 4,999", "5,000 to 9,999", "10,000 and above", "missing"], "All sizes");
  buildSelect(el.frplSelect, ["Under 25%", "25% to 49.9%", "50% and above", "missing"], "All values");
  buildSelect(el.multilingualSelect, ["Under 5%", "5% to 14.9%", "15% and above", "missing"], "All values");

  el.lastUpdated.textContent = `Updated ${payload.summary.generated_at || "Not available"}`;
  wireEvents();
  renderAll();
}

initialize().catch((err) => {
  el.kpiContainer.innerHTML = `<div class="kpi"><div class="label">Error</div><div class="value">${err.message}</div></div>`;
});
