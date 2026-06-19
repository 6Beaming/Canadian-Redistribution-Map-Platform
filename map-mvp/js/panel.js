const panelEl = document.getElementById("side-panel");
const panelBodyEl = document.getElementById("panel-body");
const panelTitleEl = document.getElementById("panel-title");

const UNORGANIZED_FOOTNOTE =
  "* This dissemination area lies in a census subdivision classified as " +
  "<strong>Unorganized</strong>—areas outside incorporated municipalities in Yukon " +
  "(Statistics Canada geography).";

function formatPopulation(value) {
  if (value === MISSING_DA_POPULATION) {
    return MISSING_DA_POPULATION;
  }
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return MISSING_DA_POPULATION;
  }
  return Number(value).toLocaleString();
}

function formatSourceLink(source) {
  if (!source) return "";
  if (typeof source === "string") {
    if (source.startsWith("http://") || source.startsWith("https://")) {
      return `<a href="${source}" target="_blank" rel="noopener noreferrer">${source}</a>`;
    }
    return `<code>${source}</code>`;
  }
  const label = source.label || source.url || "Source";
  const url = source.url;
  if (url) {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }
  return label;
}

function showDaPanel(dguid) {
  const population = getDaPopulationDisplay(dguid);
  const profile = getDaProfile(dguid);
  const panelTitle = getDaPanelTitle(profile);
  const showPending =
    !profile ||
    profile.status !== "ok" ||
    population === MISSING_DA_POPULATION;
  const pendingNotice = showPending
    ? `<p class="panel-data-pending">Census name and population are collected externally. Run <code>scripts/collect_yt_da_profiles.py</code> to refresh <code>yt_da_profiles.json</code>.</p>`
    : "";

  const daCodeRow =
    profile?.da_code != null
      ? `<dt>DA code</dt><dd><code>${profile.da_code}</code></dd>`
      : "";
  const communityRow =
    profile?.community_display &&
    !panelTitle.unorganized &&
    profile.community_display !== panelTitle.text
      ? `<dt>Community (CSD)</dt><dd>${escapeHtml(profile.community_display)}</dd>`
      : "";
  const communitySourceRow = profile?.community_source
    ? `<dt>Community source</dt><dd>${formatSourceLink(profile.community_source)}</dd>`
    : "";
  const unorganizedFootnote = panelTitle.unorganized
    ? `<p class="panel-footnote">${UNORGANIZED_FOOTNOTE}</p>`
    : "";

  panelTitleEl.innerHTML = formatDaPanelTitleHtml(profile);
  panelBodyEl.innerHTML = `
    <dl class="da-details">
      <dt>DGUID</dt>
      <dd><code>${dguid ?? "—"}</code></dd>
      ${daCodeRow}
      ${communityRow}
      <dt>Population (2021)</dt>
      <dd>${formatPopulation(population)}</dd>
      <dt>FED</dt>
      <dd><code>${MVP_FED_NUM}</code></dd>
      ${profile?.source ? `<dt>Population source</dt><dd>${formatSourceLink(profile.source)}</dd>` : ""}
      ${communitySourceRow}
    </dl>
    ${pendingNotice}
    <p class="panel-hint">Click another DA to inspect it. Only the selected DA is highlighted in yellow.</p>
    ${unorganizedFootnote}
  `;
  panelEl.classList.add("is-open");
}

function showFedPanel(fedNum, fedName) {
  const num = String(fedNum ?? "—");
  const name = fedName || `FED ${num}`;

  panelTitleEl.textContent = name;
  panelBodyEl.innerHTML = `
    <dl class="da-details">
      <dt>FED</dt>
      <dd><code>${num}</code></dd>
    </dl>
    <p class="panel-coming-soon">Coming Soon!</p>
    <p class="panel-hint">This region is not part of the pilot demo yet. Yukon (${MVP_FED_NUM}) is available now.</p>
  `;
  panelEl.classList.add("is-open");
}

/** @deprecated Use showFedPanel — kept for cached map.js during dev */
function showComingSoonPanel(fedNum, fedName) {
  showFedPanel(fedNum, fedName);
}

function showEmptyPanel() {
  panelTitleEl.textContent = "Region details";
  panelBodyEl.innerHTML = `
    <p class="panel-empty">Click a dissemination area or federal electoral district on the map to view details.</p>
  `;
  panelEl.classList.remove("is-open");
}
