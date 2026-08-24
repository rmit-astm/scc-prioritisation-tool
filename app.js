"use strict";

const DATA_FILES = {
  model: "data/dashboard_data.json",
  scc: "data/scc_network.geojson",
  facilities: "data/existing_bicycle_facilities.geojson",
  projects: "data/candidate_projects.geojson"
};
const DATA_VERSION = "2026-08-24-2";
const colours = { upgrade: "#1769aa", newLink: "#b74352", existing: "#3d7c5b", painted: "#c38b20", scc: "#707a76", candidate: "#827f78", brand: "#174f45" };
const state = {
  model: null, projects: null, projectById: new Map(), portfolioByKey: new Map(),
  budgets: [], scenario: "p50", objective: "net", budgetIndex: 0,
  selectedLayer: null, selectedBounds: null
};

const map = L.map("map", { zoomControl: false, preferCanvas: true, minZoom: 7 });
L.control.zoom({ position: "topright" }).addTo(map);
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
const lightBase = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20, subdomains: "abcd", attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
}).addTo(map);
const streetBase = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
});
map.setView([-37.82, 144.97], 10);

const formatMoney = (value, digits = 1) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const v = Number(value);
  const precision = Math.abs(v) < 10 && v !== 0 ? Math.max(digits, 2) : digits;
  return `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(precision)}m`;
};
const formatNumber = (value, digits = 1) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("en-AU", { maximumFractionDigits: digits });
};
const keyFor = (scenario, objective, budget) => `${scenario}__${objective}__${budget}`;
const getPortfolio = () => state.portfolioByKey.get(keyFor(state.scenario, state.objective, state.budgets[state.budgetIndex]));

function projectStyle(feature, selected = false) {
  const upgrade = feature.properties.status === "upgrade_candidate";
  return selected
    ? { color: upgrade ? colours.upgrade : colours.newLink, weight: 5.2, opacity: .96, lineCap: "round" }
    : { color: colours.candidate, weight: 1.1, opacity: .38, dashArray: upgrade ? "2 4" : "6 4" };
}

function selectedPopup(feature, selectedMeta) {
  const p = feature.properties;
  const type = p.status === "upgrade_candidate" ? "Upgrade to protected" : "New protected link";
  return `<h3 class="popup-title">${p.project_id}</h3>
    <div class="popup-grid">
      <span>Portfolio rank</span><strong>${selectedMeta.rank}</strong>
      <span>Treatment</span><strong>${type}</strong>
      <span>SCC class</span><strong>${p.scc_type || "—"}</strong>
      <span>Length</span><strong>${formatNumber(p.length_km, 2)} km</strong>
      <span>PV project cost</span><strong>${formatMoney(selectedMeta.pv_cost_aud_m, 2)}</strong>
      <span>Standalone BCR</span><strong>${formatNumber(selectedMeta.singleton_bcr, 2)}</strong>
    </div>
    <p class="popup-note">The standalone value does not include interactions with other selected projects and should not be summed across the portfolio.</p>`;
}

function setMetric(id, value, className = "") {
  const el = document.getElementById(id);
  el.textContent = value;
  const card = el.closest(".metric");
  card.classList.remove("positive", "negative");
  if (className) card.classList.add(className);
}

function interpretationFor(p) {
  if (p.budget_aud_m === 0) return "At zero funding, the map shows the modelled current bicycle facilities and the Strategic Cycling Corridor network. No new projects are selected.";
  const value = p.npv_aud_m >= 0
    ? `estimated benefits exceed costs by ${formatMoney(p.npv_aud_m, 1)}`
    : `estimated costs exceed measured benefits by ${formatMoney(Math.abs(p.npv_aud_m), 1)}`;
  const composition = p.new_km > 0
    ? `${formatNumber(p.upgrade_km, 1)} km of upgrades and ${formatNumber(p.new_km, 1)} km of new links`
    : `${formatNumber(p.upgrade_km, 1)} km of upgrades and no new links`;
  const spending = p.budget_binding
    ? "The available funding is effectively fully used."
    : `${formatMoney(p.unspent_aud_m, 1)} remains unspent because the net-benefit rule does not add projects with insufficient modelled value.`;
  return `The selected program contains ${composition}; ${value}. ${spending}`;
}

function updateSelectedLayer(p) {
  if (state.selectedLayer) map.removeLayer(state.selectedLayer);
  const selectedMeta = new Map(p.selected_projects.map(x => [x.project_id, x]));
  state.selectedLayer = L.geoJSON(state.projects, {
    filter: feature => selectedMeta.has(feature.properties.project_id),
    style: feature => projectStyle(feature, true),
    onEachFeature: (feature, layer) => {
      layer.bindPopup(selectedPopup(feature, selectedMeta.get(feature.properties.project_id)));
      layer.on("mouseover", () => layer.setStyle({ weight: 7 }));
      layer.on("mouseout", () => state.selectedLayer.resetStyle(layer));
    }
  }).addTo(map);
  state.selectedLayer.bringToFront();
  const bounds = state.selectedLayer.getBounds();
  state.selectedBounds = bounds.isValid() ? bounds : null;
  document.getElementById("zoom-selected").disabled = !state.selectedBounds;
}

function renderProjectList(p) {
  const container = document.getElementById("project-list");
  const title = document.getElementById("project-list-title");
  if (!p.selected_projects.length) {
    title.textContent = "No new projects";
    container.innerHTML = '<p class="empty-state">Move the funding slider to view modelled investments.</p>';
    return;
  }
  title.textContent = `${p.n_projects} projects · ${formatNumber(p.length_km, 1)} km`;
  container.innerHTML = "";
  p.selected_projects.forEach(meta => {
    const feature = state.projectById.get(meta.project_id);
    if (!feature) return;
    const props = feature.properties;
    const treatment = props.status === "upgrade_candidate" ? "Upgrade" : "New link";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-row";
    button.innerHTML = `<span class="rank-badge">${meta.rank}</span>
      <span><strong>${meta.project_id}</strong><small>${treatment} · ${formatNumber(props.length_km, 2)} km · ${props.scc_type}</small></span>
      <span class="project-cost">${formatMoney(meta.pv_cost_aud_m, 2)}</span>`;
    button.addEventListener("click", () => state.selectedLayer.eachLayer(layer => {
      if (layer.feature.properties.project_id === meta.project_id) {
        map.fitBounds(layer.getBounds(), { padding: [70, 70], maxZoom: 15 });
        layer.openPopup();
      }
    }));
    container.appendChild(button);
  });
}

function drawReturnChart(current) {
  const canvas = document.getElementById("return-chart");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(320, rect.width);
  canvas.width = cssWidth * dpr;
  canvas.height = 122 * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const w = cssWidth, h = 122, pad = { left: 39, right: 10, top: 12, bottom: 25 };
  const series = state.budgets.map(b => state.portfolioByKey.get(keyFor(state.scenario, state.objective, b)));
  const values = series.map(p => p.npv_aud_m);
  const min = Math.min(0, ...values), max = Math.max(0, ...values), span = Math.max(1, max - min);
  const x = i => pad.left + i * (w - pad.left - pad.right) / (series.length - 1);
  const y = v => pad.top + (max - v) * (h - pad.top - pad.bottom) / span;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#d8dfdb"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.left, y(0)); ctx.lineTo(w - pad.right, y(0)); ctx.stroke();
  ctx.fillStyle = "#66736e"; ctx.font = "10px system-ui"; ctx.textAlign = "right";
  ctx.fillText(formatMoney(max, 0), pad.left - 5, pad.top + 3); ctx.fillText(formatMoney(min, 0), pad.left - 5, h - pad.bottom + 3);
  ctx.textAlign = "left"; ctx.fillText("Available funding", pad.left, h - 7); ctx.textAlign = "right"; ctx.fillText("$100m", w - pad.right, h - 7);
  ctx.strokeStyle = colours.brand; ctx.lineWidth = 2; ctx.beginPath();
  series.forEach((p, i) => i === 0 ? ctx.moveTo(x(i), y(p.npv_aud_m)) : ctx.lineTo(x(i), y(p.npv_aud_m))); ctx.stroke();
  ctx.fillStyle = current.npv_aud_m >= 0 ? colours.brand : colours.newLink; ctx.beginPath(); ctx.arc(x(state.budgetIndex), y(current.npv_aud_m), 4.5, 0, Math.PI * 2); ctx.fill();
  canvas.setAttribute("aria-label", `Net present value across funding levels. Current value ${formatMoney(current.npv_aud_m, 1)} at ${formatMoney(current.budget_aud_m, 1)} available funding.`);
}

function render() {
  const p = getPortfolio();
  if (!p) return;
  document.getElementById("budget-output").textContent = p.budget_aud_m === 0 ? "$0 · today" : `${formatMoney(p.budget_aud_m, p.budget_aud_m < 1 ? 2 : 0)} available`;
  document.getElementById("spend-status").textContent = p.budget_aud_m === 0 ? "Current network" : (p.budget_binding ? "Funding used" : "Funding left unspent");
  document.getElementById("settings-summary").textContent = `${state.scenario === "p50" ? "Permanent P50" : "Low complexity"} · ${state.objective === "net" ? "maximise net benefit" : "maximise benefits"}`;
  document.querySelectorAll(".budget-presets button").forEach(button => button.classList.toggle("active", Number(button.dataset.budget) === p.budget_aud_m));
  setMetric("metric-benefit", formatMoney(p.expected_benefit_aud_m, 1), p.expected_benefit_aud_m > 0 ? "positive" : "");
  setMetric("metric-spend", formatMoney(p.spend_aud_m, 1));
  document.getElementById("metric-unspent").textContent = p.budget_aud_m === 0 ? "No new investment" : `${formatMoney(p.unspent_aud_m, 1)} unspent`;
  setMetric("metric-npv", formatMoney(p.npv_aud_m, 1), p.npv_aud_m > 0 ? "positive" : (p.npv_aud_m < 0 ? "negative" : ""));
  setMetric("metric-bcr", p.bcr === null ? "—" : formatNumber(p.bcr, 2), p.bcr >= 1 ? "positive" : (p.bcr !== null ? "negative" : ""));
  document.getElementById("metric-bcr-note").textContent = p.bcr === null ? "Not applicable at $0" : (p.bcr >= 1 ? "benefits exceed costs" : "measured benefits below costs");
  setMetric("metric-length", `${formatNumber(p.length_km, 1)} km`);
  document.getElementById("metric-projects").textContent = `${p.n_projects} ${p.n_projects === 1 ? "project" : "projects"}`;
  setMetric("metric-co2", `${formatNumber(p.avoided_co2_tonnes_per_year, 1)} t/yr`);
  document.getElementById("interpretation").textContent = interpretationFor(p);
  updateSelectedLayer(p); renderProjectList(p); drawReturnChart(p);
}

function initialiseControls() {
  const slider = document.getElementById("budget-slider");
  slider.max = String(state.budgets.length - 1);
  slider.addEventListener("input", event => { state.budgetIndex = Number(event.target.value); render(); });
  document.querySelectorAll(".budget-presets button").forEach(button => button.addEventListener("click", () => {
    const index = state.budgets.indexOf(Number(button.dataset.budget));
    if (index < 0) return;
    state.budgetIndex = index;
    slider.value = String(index);
    render();
  }));
  document.querySelectorAll('input[name="scenario"]').forEach(input => input.addEventListener("change", event => { state.scenario = event.target.value; render(); }));
  document.querySelectorAll('input[name="objective"]').forEach(input => input.addEventListener("change", event => { state.objective = event.target.value; render(); }));
  document.getElementById("zoom-selected").addEventListener("click", () => { if (state.selectedBounds) map.fitBounds(state.selectedBounds, { padding: [35, 35], maxZoom: 14 }); });
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { map.invalidateSize(); drawReturnChart(getPortfolio()); }, 100); });
  const dialog = document.getElementById("about-dialog");
  document.getElementById("about-open").addEventListener("click", () => dialog.showModal());
  document.getElementById("about-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
}

async function fetchJson(path) {
  const response = await fetch(`${path}?v=${DATA_VERSION}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function loadDashboard() {
  try {
    // Load the controls and selected projects first. Context layers are added
    // afterwards so a slower SCC file or tile service cannot block the app.
    const [model, projects] = await Promise.all([fetchJson(DATA_FILES.model), fetchJson(DATA_FILES.projects)]);
    state.model = model; state.projects = projects; state.budgets = model.metadata.budgets_aud_m;
    model.portfolios.forEach(p => state.portfolioByKey.set(keyFor(p.scenario, p.objective, p.budget_aud_m), p));
    projects.features.forEach(feature => state.projectById.set(feature.properties.project_id, feature));

    const sccLayer = L.layerGroup().addTo(map);
    const protectedLayer = L.layerGroup().addTo(map);
    const paintedLayer = L.layerGroup().addTo(map);
    const candidateLayer = L.geoJSON(projects, {
      style: feature => projectStyle(feature, false),
      onEachFeature: (feature, layer) => layer.bindTooltip(`${feature.properties.project_id} · ${feature.properties.project_type}`)
    });
    L.control.layers({ "Pale street map": lightBase, "OpenStreetMap": streetBase }, {
      "Strategic Cycling Corridors": sccLayer,
      "Existing protected / off-road": protectedLayer,
      "Existing painted lanes": paintedLayer,
      "All candidate gaps": candidateLayer
    }, { position: "topright", collapsed: window.innerWidth < 760 }).addTo(map);

    const b = model.metadata.map_bounds;
    const melbourneBounds = L.latLngBounds([b.south, b.west], [b.north, b.east]);
    map.setMaxBounds(melbourneBounds.pad(.12));
    map.fitBounds(melbourneBounds, { padding: [8, 8] });
    initialiseControls();
    const generated = new Date(model.metadata.generated_at);
    document.getElementById("data-date").textContent = `Dashboard data generated ${generated.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}. Values are ${model.metadata.currency}.`;
    render();
    document.getElementById("loading").remove();

    // Add the heavier context layers after the interactive dashboard is ready.
    Promise.all([fetchJson(DATA_FILES.scc), fetchJson(DATA_FILES.facilities)]).then(([scc, facilities]) => {
      L.geoJSON(scc, {
        renderer: L.canvas({ padding: .35 }),
        style: { color: colours.scc, weight: 1.1, opacity: .58, dashArray: "5 5" },
        onEachFeature: (feature, layer) => layer.bindTooltip(`Strategic Cycling Corridor · ${feature.properties.scc_type || "type not recorded"}`)
      }).addTo(sccLayer);
      L.geoJSON(facilities, {
        renderer: L.canvas({ padding: .35 }),
        filter: f => f.properties.facility_class === "Protected or off-road facility",
        style: { color: colours.existing, weight: 2, opacity: .78 }
      }).addTo(protectedLayer);
      L.geoJSON(facilities, {
        renderer: L.canvas({ padding: .35 }),
        filter: f => f.properties.facility_class === "Painted bicycle lane",
        style: { color: colours.painted, weight: 1.35, opacity: .62 }
      }).addTo(paintedLayer);
      if (state.selectedLayer) state.selectedLayer.bringToFront();
    }).catch(error => {
      console.error("Context layer load failed", error);
      document.querySelector(".map-note").textContent = "Selected projects are available, but one or more background cycling layers could not be loaded.";
    });
  } catch (error) {
    console.error(error);
    const loading = document.getElementById("loading");
    loading.classList.add("error");
    loading.textContent = "The dashboard data could not be loaded. If viewing locally, serve this folder over HTTP rather than opening index.html directly.";
  }
}

loadDashboard();
