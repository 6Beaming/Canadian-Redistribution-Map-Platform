const panelEl = document.getElementById("side-panel");
const panelBodyEl = document.getElementById("panel-body");
const panelTitleEl = document.getElementById("panel-title");

function formatPopulation(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString();
}

function showDaPanel(properties) {
  const dguid = properties?.DGUID ?? "—";
  const population = properties?.C1_COUNT_TOTAL;

  panelTitleEl.textContent = "Dissemination Area";
  panelBodyEl.innerHTML = `
    <dl class="da-details">
      <dt>DGUID</dt>
      <dd><code>${dguid}</code></dd>
      <dt>Population (2021)</dt>
      <dd>${formatPopulation(population)}</dd>
      <dt>FED (MVP)</dt>
      <dd>Yukon · ${MVP_FED_NUM}</dd>
    </dl>
    <p class="panel-hint">Click another DA to inspect it. Only the selected DA is highlighted in yellow.</p>
  `;
  panelEl.classList.add("is-open");
}

function showComingSoonPanel(properties) {
  const fedNum = properties?.fed_num ?? "—";

  panelTitleEl.textContent = "Federal Electoral District";
  panelBodyEl.innerHTML = `
    <p class="panel-coming-soon">Coming Soon!</p>
    <dl class="da-details">
      <dt>FED</dt>
      <dd><code>${fedNum}</code></dd>
    </dl>
    <p class="panel-hint">This region is not part of the MVP demo yet. Yukon (${MVP_FED_NUM}) is available now.</p>
  `;
  panelEl.classList.add("is-open");
}

function showEmptyPanel() {
  panelTitleEl.textContent = "DA details";
  panelBodyEl.innerHTML = `
    <p class="panel-empty">Click a dissemination area on the map to view its census data.</p>
  `;
  panelEl.classList.remove("is-open");
}
