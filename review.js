"use strict";

const REVIEW_DATA_VERSION = "2026-08-25-1";
const STORAGE_KEY = "melbourne-scc-practitioner-review-v1";
const REVIEW_EMAIL = "afshin.jafari@rmit.edu.au";
const statusLabels = {
  reasonable: "Reasonable",
  uncertain: "Uncertain / needs evidence",
  revise: "Revise",
  not_my_expertise: "Not my expertise"
};

let register;
let projects;
let projectById = new Map();
let selectedProjectId = "";
let saveTimer;
let reviewState = loadState();

function emptyState() {
  return {
    version: 1,
    reviewer: { name: "", organisation: "", role: "" },
    overall_comments: "",
    assumptions: {},
    corridors: {},
    updated_at: null
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && saved.version === 1 ? { ...emptyState(), ...saved } : emptyState();
  } catch (error) {
    console.warn("Could not read locally saved review", error);
    return emptyState();
  }
}

function saveState() {
  clearTimeout(saveTimer);
  document.getElementById("save-status").textContent = "Saving locally…";
  saveTimer = setTimeout(() => {
    reviewState.updated_at = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reviewState));
      document.getElementById("save-status").textContent = "Saved in this browser";
    } catch (error) {
      console.error(error);
      document.getElementById("save-status").textContent = "Could not save in this browser";
    }
    updateProgress();
  }, 180);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function assumptionResponse(id) {
  return reviewState.assumptions[id] || { status: "", suggested_value: "", comment: "" };
}

function renderNavigation(categories) {
  const nav = document.getElementById("review-nav");
  nav.innerHTML = categories.map(category => `<a href="#group-${slug(category)}">${escapeHtml(category)}</a>`).join("") + '<a href="#corridor-review">Corridor review</a>';
}

function renderAssumptions() {
  const container = document.getElementById("assumption-sections");
  const categories = [...new Set(register.assumptions.map(item => item.category))];
  renderNavigation(categories);
  container.innerHTML = categories.map(category => {
    const items = register.assumptions.filter(item => item.category === category);
    return `<section class="assumption-group" id="group-${slug(category)}">
      <div class="group-heading"><h2>${escapeHtml(category)}</h2><span>${items.length} assumptions</span></div>
      ${items.map(renderAssumptionCard).join("")}
    </section>`;
  }).join("");

  container.querySelectorAll(".assumption-card").forEach(card => {
    const id = card.dataset.assumptionId;
    card.querySelectorAll('input[type="radio"]').forEach(input => input.addEventListener("change", event => {
      const response = assumptionResponse(id);
      response.status = event.target.value;
      reviewState.assumptions[id] = response;
      card.classList.toggle("flagged", response.status === "revise");
      saveState();
    }));
    card.querySelector('[data-field="suggested_value"]').addEventListener("input", event => {
      const response = assumptionResponse(id);
      response.suggested_value = event.target.value;
      reviewState.assumptions[id] = response;
      saveState();
    });
    card.querySelector('[data-field="comment"]').addEventListener("input", event => {
      const response = assumptionResponse(id);
      response.comment = event.target.value;
      reviewState.assumptions[id] = response;
      saveState();
    });
  });
}

function renderAssumptionCard(item) {
  const response = assumptionResponse(item.id);
  const options = Object.entries(statusLabels).map(([value, label]) => `
    <label class="status-option ${value === "revise" ? "revise" : ""}">
      <input type="radio" name="status-${escapeHtml(item.id)}" value="${value}" ${response.status === value ? "checked" : ""}>
      <span>${label}</span>
    </label>`).join("");
  return `<article class="assumption-card ${response.status === "revise" ? "flagged" : ""}" data-assumption-id="${escapeHtml(item.id)}">
    <div class="assumption-head">
      <div><h3>${escapeHtml(item.title)}</h3><p class="current-value">${escapeHtml(item.current_value)}</p></div>
      <span class="basis-chip">${escapeHtml(item.basis)}</span>
    </div>
    <div class="assumption-evidence">
      <div class="evidence-block"><strong>How it is used</strong><p>${escapeHtml(item.explanation)}</p></div>
      <div class="evidence-block"><strong>Source</strong><p>${escapeHtml(item.source)}</p></div>
      <div class="evidence-block"><strong>Observed consequence</strong><p>${escapeHtml(item.observed_effect)}</p></div>
    </div>
    <div class="review-question"><strong>${escapeHtml(item.review_question)}</strong><div class="status-options">${options}</div></div>
    <div class="assumption-notes">
      <label>Suggested alternative value or treatment<input data-field="suggested_value" type="text" value="${escapeHtml(response.suggested_value)}" placeholder="Only if revision is suggested"></label>
      <label>Evidence, source or comment<textarea data-field="comment" rows="2" placeholder="Please include a source or practical example where possible">${escapeHtml(response.comment)}</textarea></label>
    </div>
  </article>`;
}

function initialiseReviewerFields() {
  const fields = {
    "reviewer-name": "name",
    "reviewer-organisation": "organisation",
    "reviewer-role": "role"
  };
  Object.entries(fields).forEach(([elementId, key]) => {
    const element = document.getElementById(elementId);
    element.value = reviewState.reviewer[key] || "";
    element.addEventListener("input", event => {
      reviewState.reviewer[key] = event.target.value;
      saveState();
    });
  });
  const overall = document.getElementById("overall-comments");
  overall.value = reviewState.overall_comments || "";
  overall.addEventListener("input", event => {
    reviewState.overall_comments = event.target.value;
    saveState();
  });
}

function initialiseProjectPicker() {
  const datalist = document.getElementById("project-options");
  datalist.innerHTML = projects.features.map(feature => {
    const p = feature.properties;
    return `<option value="${escapeHtml(p.project_id)}">${escapeHtml(p.project_type)} · ${p.length_km} km · ${escapeHtml(p.scc_type)}</option>`;
  }).join("");
  const search = document.getElementById("project-search");
  search.addEventListener("change", () => selectProject(search.value));
  search.addEventListener("input", () => {
    const id = search.value.trim().toUpperCase();
    if (projectById.has(id)) selectProject(id);
  });
  document.getElementById("save-corridor").addEventListener("click", saveCorridorReview);

  const requested = new URLSearchParams(window.location.search).get("project");
  if (requested && projectById.has(requested.toUpperCase())) {
    search.value = requested.toUpperCase();
    selectProject(requested.toUpperCase());
    setTimeout(() => document.getElementById("corridor-review").scrollIntoView({ behavior: "smooth" }), 200);
  }
  renderCorridorList();
}

function selectProject(rawId) {
  const id = rawId.trim().toUpperCase();
  const feature = projectById.get(id);
  const summary = document.getElementById("project-summary");
  selectedProjectId = feature ? id : "";
  document.getElementById("save-corridor").disabled = !feature;
  if (!feature) {
    summary.className = "project-summary empty";
    summary.textContent = rawId ? "No matching project ID was found." : "Select a project to see its modelled status and length.";
    clearCorridorFields();
    return;
  }
  const p = feature.properties;
  summary.className = "project-summary";
  summary.innerHTML = `<h3>${escapeHtml(p.project_id)}</h3><dl>
    <dt>Modelled treatment</dt><dd>${escapeHtml(p.project_type)}</dd>
    <dt>SCC class</dt><dd>${escapeHtml(p.scc_type)}</dd>
    <dt>Length</dt><dd>${Number(p.length_km).toFixed(2)} km</dd>
    <dt>Mean LTS</dt><dd>${escapeHtml(p.mean_lts)}</dd>
  </dl>`;
  populateCorridorFields(reviewState.corridors[id] || {});
}

function corridorElements() {
  return {
    status: document.getElementById("corridor-status"),
    feasibility: document.getElementById("corridor-feasibility"),
    delivery_status: document.getElementById("corridor-delivery"),
    cost_treatment: document.getElementById("corridor-cost"),
    comment: document.getElementById("corridor-comment")
  };
}

function populateCorridorFields(record) {
  Object.entries(corridorElements()).forEach(([key, element]) => { element.value = record[key] || ""; });
}

function clearCorridorFields() {
  populateCorridorFields({});
}

function saveCorridorReview() {
  if (!selectedProjectId) return;
  const feature = projectById.get(selectedProjectId);
  const values = Object.fromEntries(Object.entries(corridorElements()).map(([key, element]) => [key, element.value]));
  reviewState.corridors[selectedProjectId] = {
    project_id: selectedProjectId,
    modelled_status: feature.properties.status,
    project_type: feature.properties.project_type,
    scc_type: feature.properties.scc_type,
    length_km: feature.properties.length_km,
    ...values,
    updated_at: new Date().toISOString()
  };
  saveState();
  renderCorridorList();
  showToast(`${selectedProjectId} review saved on this device.`);
}

function renderCorridorList() {
  const list = document.getElementById("corridor-list");
  const records = Object.values(reviewState.corridors).sort((a, b) => a.project_id.localeCompare(b.project_id));
  if (!records.length) {
    list.innerHTML = '<p class="empty-state">No corridor reviews saved yet.</p>';
    updateProgress();
    return;
  }
  list.innerHTML = records.map(record => `<div class="corridor-review-row">
    <div><strong>${escapeHtml(record.project_id)}</strong><p>${escapeHtml(labelValue(record.status))} · ${escapeHtml(labelValue(record.feasibility))} · ${escapeHtml(record.comment || "No comment")}</p></div>
    <div><button type="button" data-edit="${escapeHtml(record.project_id)}">Edit</button><button type="button" data-delete="${escapeHtml(record.project_id)}">Delete</button></div>
  </div>`).join("");
  list.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => {
    const id = button.dataset.edit;
    document.getElementById("project-search").value = id;
    selectProject(id);
    document.getElementById("project-search").focus();
  }));
  list.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", () => {
    delete reviewState.corridors[button.dataset.delete];
    saveState(); renderCorridorList();
  }));
  updateProgress();
}

function labelValue(value) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase()) : "Not answered";
}

function updateProgress() {
  const responses = Object.values(reviewState.assumptions);
  document.getElementById("progress-reviewed").textContent = responses.filter(r => r.status).length;
  document.getElementById("progress-flagged").textContent = responses.filter(r => r.status === "revise").length;
  document.getElementById("progress-corridors").textContent = Object.keys(reviewState.corridors).length;
}

function exportPayload() {
  return {
    export_type: "Melbourne SCC practitioner assumptions review",
    exported_at: new Date().toISOString(),
    register_generated_at: register.metadata.generated_at,
    ...reviewState,
    assumptions: register.assumptions.map(item => ({
      id: item.id,
      category: item.category,
      title: item.title,
      current_value: item.current_value,
      ...assumptionResponse(item.id)
    })),
    corridors: Object.values(reviewState.corridors)
  };
}

function textSummary() {
  const payload = exportPayload();
  const reviewer = [payload.reviewer.name, payload.reviewer.organisation, payload.reviewer.role].filter(Boolean).join(" · ") || "Not provided";
  const answered = payload.assumptions.filter(item => item.status);
  const flagged = answered.filter(item => item.status === "revise" || item.status === "uncertain");
  const lines = [
    "MELBOURNE SCC PRIORITISATION — PRACTITIONER REVIEW",
    `Reviewer: ${reviewer}`,
    `Assumptions reviewed: ${answered.length}/${payload.assumptions.length}`,
    `Corridors reviewed: ${payload.corridors.length}`,
    "",
    `Overall comments: ${payload.overall_comments || "None"}`,
    "",
    "ASSUMPTIONS FLAGGED OR COMMENTED"
  ];
  payload.assumptions.filter(item => item.status === "revise" || item.status === "uncertain" || item.suggested_value || item.comment).forEach(item => {
    lines.push(`- ${item.title} [${statusLabels[item.status] || "No status"}]`);
    if (item.suggested_value) lines.push(`  Suggested: ${item.suggested_value}`);
    if (item.comment) lines.push(`  Comment: ${item.comment}`);
  });
  if (!flagged.length && !payload.assumptions.some(item => item.comment || item.suggested_value)) lines.push("- None recorded");
  lines.push("", "CORRIDOR COMMENTS");
  if (!payload.corridors.length) lines.push("- None recorded");
  payload.corridors.forEach(record => {
    lines.push(`- ${record.project_id}: status ${labelValue(record.status)}, feasibility ${labelValue(record.feasibility)}, delivery ${labelValue(record.delivery_status)}, cost ${labelValue(record.cost_treatment)}`);
    if (record.comment) lines.push(`  ${record.comment}`);
  });
  lines.push("", "The complete structured review can be attached as the downloaded JSON or CSV file.");
  return lines.join("\n");
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function reviewCsv() {
  const payload = exportPayload();
  const rows = [["record_type", "id", "category", "title", "current_value", "response", "suggested_value", "comment", "existing_status", "feasibility", "delivery_status", "cost_treatment"]];
  payload.assumptions.forEach(item => rows.push(["assumption", item.id, item.category, item.title, item.current_value, item.status, item.suggested_value, item.comment, "", "", "", ""]));
  payload.corridors.forEach(item => rows.push(["corridor", item.project_id, item.scc_type, item.project_type, `${item.length_km} km`, "", "", item.comment, item.status, item.feasibility, item.delivery_status, item.cost_treatment]));
  return rows.map(row => row.map(csvCell).join(",")).join("\n");
}

function initialiseExportActions() {
  const stamp = () => new Date().toISOString().slice(0, 10);
  document.getElementById("download-json").addEventListener("click", () => {
    download(`scc-practitioner-review-${stamp()}.json`, JSON.stringify(exportPayload(), null, 2), "application/json");
    showToast("Complete review downloaded.");
  });
  document.getElementById("download-csv").addEventListener("click", () => {
    download(`scc-practitioner-review-${stamp()}.csv`, reviewCsv(), "text/csv;charset=utf-8");
    showToast("Review table downloaded.");
  });
  document.getElementById("copy-review").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(textSummary());
      showToast("Email summary copied.");
    } catch {
      const area = document.createElement("textarea");
      area.value = textSummary(); document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove();
      showToast("Email summary copied.");
    }
  });
  document.getElementById("email-review").addEventListener("click", () => {
    const reviewerName = reviewState.reviewer.name ? ` — ${reviewState.reviewer.name}` : "";
    const subject = `SCC prioritisation assumptions review${reviewerName}`;
    let body = textSummary();
    if (body.length > 6500) body = `${body.slice(0, 6200)}\n\n[Summary shortened for email. Please attach the downloaded complete review.]`;
    window.location.href = `mailto:${REVIEW_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });
  document.getElementById("print-review").addEventListener("click", () => window.print());
  document.getElementById("clear-review").addEventListener("click", () => {
    if (!window.confirm("Clear all locally saved assumption and corridor responses on this device?")) return;
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  });
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message; toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

async function initialiseReview() {
  try {
    const [registerResponse, projectResponse] = await Promise.all([
      fetch(`data/assumption_review.json?v=${REVIEW_DATA_VERSION}`),
      fetch(`data/candidate_projects.geojson?v=${REVIEW_DATA_VERSION}`)
    ]);
    if (!registerResponse.ok || !projectResponse.ok) throw new Error("Review data could not be loaded");
    register = await registerResponse.json();
    projects = await projectResponse.json();
    projects.features.forEach(feature => projectById.set(feature.properties.project_id, feature));
    initialiseReviewerFields();
    renderAssumptions();
    initialiseProjectPicker();
    initialiseExportActions();
    updateProgress();
    document.getElementById("save-status").textContent = reviewState.updated_at ? "Restored from this browser" : "Ready — responses save automatically";
  } catch (error) {
    console.error(error);
    document.getElementById("assumption-sections").innerHTML = '<div class="review-loading">The assumptions register could not be loaded. Please refresh after the dashboard deployment completes.</div>';
    document.getElementById("save-status").textContent = "Review unavailable";
  }
}

initialiseReview();
