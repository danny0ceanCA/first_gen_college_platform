"use strict";

// This workbench only reads local evidence and saves human review decisions.
// Source text is always inserted as text, never interpreted as HTML.
const ui = {
  refresh: document.querySelector("#refresh-button"),
  error: document.querySelector("#error-banner"),
  announcement: document.querySelector("#announcement"),
  list: document.querySelector("#episode-list"),
  detail: document.querySelector("#episode-detail"),
  count: document.querySelector("#result-count"),
  jobs: document.querySelector("#job-list"),
  search: document.querySelector("#search-input"),
  topic: document.querySelector("#topic-filter"),
  language: document.querySelector("#language-filter"),
  reporter: document.querySelector("#reporter-filter"),
  status: document.querySelector("#status-filter"),
};

let localState = null;
let selectedEpisodeId = null;
let loading = false;
let saving = false;
const reviewDrafts = new Map();
const topicLabels = {
  college_basics: "Understanding college", paths: "Exploring college paths", applications: "Applying to college",
  costs: "Understanding costs and aid", enrollment: "Getting ready to enroll", family_support: "Family questions and expectations",
  practical_needs: "Work, time, and transportation", finding_help: "Finding and asking for help", other: "Other college navigation",
};
const evidenceStatusLabels = {
  open: "Open question", partial: "Partly answered", resolved: "Reported resolved", unknown: "Unknown",
  offered: "Guidance recorded", reported: "Understanding reported", uncertain: "Understanding uncertain",
  intended: "Plans to act", attempted: "Attempt reported", completed: "Completion reported", declined: "Declined",
  postponed: "Postponed", pending: "Still pending", positive: "Positive result reported",
  unsuccessful: "Unsuccessful result reported", mixed: "Mixed result reported", exploring: "Still exploring",
  stated: "Stated preference", changed: "Preference changed", conflicting: "Conflicting reports",
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function display(value, fallback = "Not recorded") {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function readable(value) {
  return display(value).replace(/[_-]/g, " ");
}

function formatDate(value) {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return display(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

function languageName(value) {
  if (!value || value === "und") return "Language unknown";
  if (value === "mixed") return "Mixed languages";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(value) || value;
  } catch {
    return readable(value);
  }
}

function badge(text, kind = "") {
  const allowed = ["reviewed", "needs-review", "unreviewed", "completed", "failed", "running", "queued", "obsolete", "superseded", "synthetic", "source-basis"];
  return element("span", `badge${allowed.includes(kind) ? ` ${kind}` : ""}`, text);
}

function sourceFor(item) {
  const exactVersion = source => source.id === item.sourceId && String(source.version) === String(item.sourceVersion);
  return localState.sources.find(exactVersion) || (localState.sourceHistory || []).find(exactVersion) || null;
}

function topicLabel(value) {
  return topicLabels[value] || readable(value);
}

function evidenceStatus(value) {
  return evidenceStatusLabels[value] || readable(value);
}

function episodeItems(episode) {
  return Array.isArray(episode.items) ? episode.items : [];
}

function episodeLanguages(episode) {
  return [...new Set(episodeItems(episode).map(item => item.language).filter(Boolean))];
}

function episodeReporters(episode) {
  return [...new Set(episodeItems(episode).map(item => item.reportedBy).filter(Boolean))];
}

function episodeIsSynthetic(episode) {
  return episodeItems(episode).some(item => sourceFor(item)?.synthetic === true);
}

function episodeTitle(episode) {
  return readable(episode.episodeKey || episode.topic || episode.id);
}

function filteredEpisodes() {
  if (!localState) return [];
  const search = ui.search.value.trim().toLocaleLowerCase();
  return localState.episodes.filter(episode => {
    if (ui.topic.value && episode.topic !== ui.topic.value) return false;
    if (ui.language.value && !episodeLanguages(episode).includes(ui.language.value)) return false;
    if (ui.reporter.value && !episodeReporters(episode).includes(ui.reporter.value)) return false;
    if (ui.status.value && (episode.reviewState || "unreviewed") !== ui.status.value) return false;
    if (!search) return true;
    const searchable = [episode.id, episode.episodeKey, episode.topic, episode.studentId, episode.accountId,
      episode.questionState, episode.actionState, episode.outcomeState, ...(episode.barriers || []),
      ...episodeItems(episode).flatMap(item => [item.statement, item.quote, item.reportedBy, item.language, item.sourceId])];
    return searchable.filter(Boolean).join(" ").toLocaleLowerCase().includes(search);
  });
}

function setOptions(select, values, label) {
  const previous = select.value;
  const first = select.options[0].cloneNode(true);
  select.replaceChildren(first);
  [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b))).forEach(value => {
    const option = element("option", "", label(value));
    option.value = value;
    select.append(option);
  });
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function renderFilters() {
  setOptions(ui.topic, localState.episodes.map(episode => episode.topic), topicLabel);
  setOptions(ui.language, localState.episodes.flatMap(episodeLanguages), languageName);
  setOptions(ui.reporter, localState.episodes.flatMap(episodeReporters), readable);
}

function renderList() {
  const episodes = filteredEpisodes();
  ui.count.textContent = `${episodes.length} / ${localState.episodes.length}`;
  if (!episodes.some(episode => episode.id === selectedEpisodeId)) selectedEpisodeId = episodes[0]?.id || null;
  ui.list.replaceChildren();
  if (!episodes.length) {
    ui.list.append(element("p", "empty-message", localState.episodes.length
      ? "No concerns match these filters. Clear a filter to broaden the view."
      : "No concern episodes yet. Add sources and process the local queue to begin."));
  }
  episodes.forEach(episode => {
    const button = element("button", "episode-card");
    button.type = "button";
    button.dataset.episodeId = episode.id;
    button.setAttribute("aria-pressed", String(episode.id === selectedEpisodeId));
    const topline = element("span", "card-topline");
    topline.append(element("span", "topic-label", topicLabel(episode.topic)), badge(readable(episode.reviewState || "unreviewed"), episode.reviewState));
    button.append(topline, element("span", "episode-title", episodeTitle(episode)),
      element("span", "episode-context", `${display(episode.studentId, "Family or unspecified student")} · ${display(episode.accountId, "Account not recorded")}`));
    const currentItems = episodeItems(episode).filter(item => item.state !== "superseded");
    const question = currentItems.find(item => item.kind === "question") || currentItems[0];
    button.append(element("span", "card-preview", question?.statement || "No current evidence statement recorded."));
    const bottom = element("span", "card-bottom");
    bottom.append(element("span", "", `${episodeItems(episode).length} evidence items`), element("span", "", "·"),
      element("span", "", episodeLanguages(episode).map(languageName).join(", ") || "Language unknown"));
    if (episodeIsSynthetic(episode)) bottom.append(badge("Synthetic", "synthetic"));
    button.append(bottom);
    button.addEventListener("click", () => {
      selectedEpisodeId = episode.id;
      renderList();
      renderDetail();
      ui.announcement.textContent = `Selected ${episodeTitle(episode)}.`;
    });
    ui.list.append(button);
  });
  ui.list.setAttribute("aria-busy", "false");
}

function addMetadata(list, label, value) {
  list.append(element("dt", "", label), element("dd", "", display(value)));
}

function renderSource(item) {
  const source = sourceFor(item);
  const details = element("details", "source-details");
  details.dataset.sourceId = item.sourceId || "";
  details.append(element("summary", "", `Inspect original source · ${display(item.sourceId)} · v${display(item.sourceVersion)}`));
  const content = element("div", "source-content");
  if (!source) {
    content.append(element("p", "source-notice", "This source version is not available in the local state. The evidence quote above remains a derived record; verify it against the original before relying on it."));
    details.append(content);
    return details;
  }
  const labels = element("div", "source-labels");
  labels.append(badge(readable(source.kind), "source-basis"));
  if (source.synthetic) labels.append(badge("Synthetic fixture", "synthetic"));
  content.append(labels);
  const metadata = element("dl", "source-meta");
  addMetadata(metadata, "Reporter", readable(source.reporter));
  addMetadata(metadata, "Language", languageName(source.language));
  addMetadata(metadata, "Student", display(source.studentId, "Family or unspecified student"));
  addMetadata(metadata, "Account", source.accountId);
  addMetadata(metadata, "Recorded", formatDate(source.recordedAt));
  addMetadata(metadata, "Version", source.version);
  content.append(metadata);
  const sourceText = element("div", "source-text", display(source.text, "Source text is unavailable."));
  sourceText.lang = source.language || "und";
  sourceText.dir = "auto";
  content.append(sourceText);
  if (source.kind === "summary" || item.basis === "summary") {
    content.append(element("p", "source-notice", "Summary evidence: this text is a summary record, not a verbatim conversation transcript."));
  } else if (source.kind === "transcript" || item.basis === "transcript") {
    content.append(element("p", "source-notice", "Transcript evidence: inspect the original wording and speaker context above."));
  }
  details.append(content);
  return details;
}

function renderTimelineItem(item) {
  const article = element("article", `timeline-item${item.state === "superseded" ? " is-superseded" : ""}`);
  article.dataset.itemId = item.id;
  const topline = element("div", "timeline-topline");
  topline.append(element("span", "timeline-kind", readable(item.kind)), badge(evidenceStatus(item.status)));
  if (item.state === "superseded") topline.append(badge("Superseded", "superseded"));
  if (item.linkState === "unresolved") topline.append(badge("Link needs review", "needs-review"));
  topline.append(element("span", "", formatDate(item.occurredAt || item.recordedAt)));
  article.append(topline);
  const statement = element("p", "timeline-statement", item.statement);
  statement.dir = "auto";
  article.append(statement);
  const meta = element("div", "timeline-meta");
  meta.append(element("span", "", `Reported by ${readable(item.reportedBy)}`), element("span", "", languageName(item.language)),
    badge(`${readable(item.basis)} evidence`, "source-basis"));
  article.append(meta);
  if (item.quote) {
    const quote = element("blockquote", "evidence-quote", item.quote);
    quote.lang = item.language || "und";
    quote.dir = "auto";
    article.append(quote);
  } else {
    article.append(element("p", "source-notice", "No supporting quote recorded for this item."));
  }
  if (item.corrects?.length) article.append(element("p", "relation-note", `Corrects: ${Array.isArray(item.corrects) ? item.corrects.join(", ") : item.corrects}`));
  if (item.linksTo?.length) article.append(element("p", "relation-note", `${item.linkState === "unresolved" ? "Unresolved evidence link" : "Linked evidence"}: ${Array.isArray(item.linksTo) ? item.linksTo.join(", ") : item.linksTo}`));
  article.append(renderSource(item));
  return article;
}

function renderReview(episode) {
  const section = element("section", "review-section");
  section.setAttribute("aria-labelledby", "review-title");
  const heading = element("h3", "", "Human review");
  heading.id = "review-title";
  section.append(heading, element("p", "section-copy", "Check the original sources, then record your assessment of this concern’s evidence."));
  const form = element("form", "review-form");
  const field = element("div", "field");
  const label = element("label", "", "Review note");
  label.htmlFor = "review-note";
  const note = element("textarea");
  note.id = "review-note";
  note.name = "note";
  note.maxLength = 2000;
  note.placeholder = "What did you verify? What still needs clarification?";
  note.value = reviewDrafts.get(episode.id) || "";
  note.addEventListener("input", () => reviewDrafts.set(episode.id, note.value));
  field.append(label, note);
  const actions = element("div", "review-actions");
  const reviewed = element("button", "button primary", "Mark reviewed");
  reviewed.id = "mark-reviewed";
  reviewed.type = "submit";
  reviewed.value = "reviewed";
  const needsReview = element("button", "button secondary", "Needs another look");
  needsReview.id = "mark-needs-review";
  needsReview.type = "submit";
  needsReview.value = "needs-review";
  const canReview = typeof episode.revision === "string" && episode.revision.length > 0;
  reviewed.disabled = !canReview || saving;
  needsReview.disabled = !canReview || saving;
  actions.append(reviewed, needsReview);
  const feedback = element("p", "review-feedback");
  feedback.id = "review-feedback";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  form.append(field, actions, element("p", "review-hint", canReview
    ? "A review records your assessment. It does not establish that an action or outcome occurred."
    : "This episode has no revision identifier. Refresh the local state before reviewing."), feedback);
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!canReview || saving) return;
    const decision = event.submitter?.value;
    if (decision !== "reviewed" && decision !== "needs-review") return;
    saveReview(episode, decision, note.value, feedback);
  });
  section.append(form);
  const reviews = (localState.reviews || []).filter(review => review.episodeId === episode.id);
  if (reviews.length) {
    const history = element("details", "review-history");
    history.append(element("summary", "", `Review history · ${reviews.length}`));
    reviews.slice().reverse().forEach(review => {
      const entry = element("div", "review-entry");
      entry.append(badge(readable(review.decision), review.decision), element("p", "muted", formatDate(review.createdAt || review.recordedAt)),
        element("p", "", review.note || "No review note recorded."));
      history.append(entry);
    });
    section.append(history);
  }
  return section;
}

function renderDetail() {
  ui.detail.replaceChildren();
  ui.detail.setAttribute("aria-busy", "false");
  const episode = localState.episodes.find(candidate => candidate.id === selectedEpisodeId);
  if (!episode) {
    delete ui.detail.dataset.episodeId;
    const empty = element("div", "empty-detail");
    empty.append(element("span", "empty-symbol", "◎"), element("h2", "", "No concern selected"),
      element("p", "", "Select a concern from the list, or adjust the filters to see more evidence."));
    ui.detail.append(empty);
    return;
  }
  ui.detail.dataset.episodeId = episode.id;
  const header = element("header", "detail-heading");
  const topline = element("div", "detail-topline");
  topline.append(element("p", "eyebrow", `Concern / ${topicLabel(episode.topic)}`), badge(readable(episode.reviewState || "unreviewed"), episode.reviewState));
  const title = element("h2", "detail-title", episodeTitle(episode));
  title.id = "selected-episode-title";
  header.append(topline, title);
  const context = element("div", "detail-context");
  context.append(element("span", "", `Student: ${display(episode.studentId, "Family or unspecified student")}`), element("span", "", `Account: ${display(episode.accountId)}`),
    element("span", "", episodeLanguages(episode).map(languageName).join(" · ")));
  if (episodeIsSynthetic(episode)) context.append(badge("Contains synthetic evidence", "synthetic"));
  header.append(context, element("p", "detail-identity", `Episode ID: ${episode.id}`));
  const states = element("div", "state-grid");
  [["Question", episode.questionState, "Not recorded"], ["Action", episode.actionState, "No action recorded"], ["Outcome", episode.outcomeState, "No outcome recorded"]].forEach(([label, value, fallback]) => {
    const box = element("div", "state-box");
    box.append(element("span", "state-label", label), element("span", "state-value", value ? evidenceStatus(value) : fallback));
    states.append(box);
  });
  header.append(states);
  if (Array.isArray(episode.evidenceWarnings) && episode.evidenceWarnings.length) {
    const warnings = element("aside", "evidence-warnings");
    warnings.setAttribute("aria-label", "Evidence requiring attention");
    warnings.append(element("p", "evidence-warning-label", "Evidence needs attention"));
    episode.evidenceWarnings.forEach(warning => warnings.append(element("p", "evidence-warning", warning)));
    header.append(warnings);
  }
  if (episode.barriers?.length) {
    const barriers = element("div", "barriers");
    barriers.append(element("span", "barrier-label", "Reported barriers"));
    episode.barriers.forEach(barrier => barriers.append(element("span", "barrier-chip", readable(barrier))));
    header.append(barriers);
  }
  ui.detail.append(header);
  const evidence = element("section", "detail-section");
  const evidenceHeading = element("div", "section-heading");
  evidenceHeading.append(element("h3", "", "Evidence timeline"), element("span", "muted", `${episodeItems(episode).length} items`));
  evidence.append(evidenceHeading, element("p", "section-copy", "Oldest first. Corrections and superseded items remain visible for context."));
  const timeline = element("div", "timeline");
  const items = episodeItems(episode).slice().sort((a, b) => {
    const left = Date.parse(a.occurredAt || a.recordedAt) || 0;
    const right = Date.parse(b.occurredAt || b.recordedAt) || 0;
    return left - right;
  });
  items.forEach(item => timeline.append(renderTimelineItem(item)));
  if (!items.length) timeline.append(element("p", "empty-message", "No evidence items recorded in this episode."));
  evidence.append(timeline);
  ui.detail.append(evidence, renderReview(episode));
}

function formatDuration(milliseconds) {
  if (milliseconds === null || milliseconds === undefined) return "—";
  const duration = Number(milliseconds);
  if (!Number.isFinite(duration)) return "—";
  return duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(1)} s`;
}

function renderJobs() {
  ui.jobs.replaceChildren();
  const failed = localState.jobs.filter(job => job.status === "failed").length;
  document.querySelector("#job-summary").textContent = `${localState.jobs.length} jobs · ${failed} failed`;
  if (!localState.jobs.length) {
    ui.jobs.append(element("p", "empty-message", "No extraction jobs recorded. The queue is empty."));
    return;
  }
  const table = element("table", "jobs-table");
  table.setAttribute("aria-label", "Local extraction job history");
  const head = element("thead");
  const header = element("tr");
  ["Job / Source version", "Status", "Attempts", "Created", "Completed", "Duration"].forEach(label => {
    const cell = element("th", "", label);
    cell.scope = "col";
    header.append(cell);
  });
  head.append(header);
  const body = element("tbody");
  localState.jobs.slice().sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).forEach(job => {
    const row = element("tr");
    row.dataset.jobId = job.id;
    const source = element("td", "job-id", job.id);
    source.append(element("span", "job-source", `${display(job.sourceId)} · v${display(job.sourceVersion)}`));
    const status = element("td");
    status.append(badge(readable(job.status), job.status));
    if (job.error) status.append(element("p", "job-error", typeof job.error === "string" ? job.error : JSON.stringify(job.error)));
    row.append(source, status, element("td", "", job.attempts ?? 0), element("td", "", formatDate(job.createdAt)),
      element("td", "", job.completedAt ? formatDate(job.completedAt) : "—"), element("td", "", formatDuration(job.durationMs)));
    body.append(row);
  });
  table.append(head, body);
  ui.jobs.append(table);
}

function validateState(state) {
  if (!state || state.mode !== "isolated-local" || !Array.isArray(state.sources) || !Array.isArray(state.episodes) || !Array.isArray(state.jobs)) {
    throw new Error("The server did not return a valid isolated local evidence state.");
  }
  return state;
}

function applyState(state) {
  localState = validateState(state);
  const metrics = localState.metrics || {};
  ["sources", "episodes", "items", "pending"].forEach(key => {
    document.querySelector(`#metric-${key}`).textContent = display(metrics[key], "—");
  });
  renderFilters();
  renderList();
  renderDetail();
  renderJobs();
  document.querySelector("#last-updated").textContent = `Loaded ${formatDate(new Date().toISOString())}`;
}

async function readResponse(response) {
  let body;
  try { body = await response.json(); } catch { throw new Error(`The local server returned an unreadable response (${response.status}).`); }
  if (!response.ok) {
    const error = new Error(typeof body.error === "string" ? body.error : body.error?.message || body.message || `Local request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function loadState() {
  if (loading || saving) return;
  loading = true;
  ui.refresh.disabled = true;
  ui.list.setAttribute("aria-busy", "true");
  try {
    const response = await fetch("/api/state", { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
    applyState(await readResponse(response));
    ui.error.hidden = true;
    ui.announcement.textContent = "Local evidence refreshed.";
  } catch (error) {
    ui.error.textContent = `${localState ? "Refresh failed. The evidence below may be out of date." : "Local evidence could not be loaded."} ${error.message}`;
    ui.error.hidden = false;
    if (!localState) {
      ui.list.replaceChildren(element("p", "empty-message", "Evidence unavailable. Check that the local review server is running, then refresh."));
      ui.jobs.replaceChildren(element("p", "empty-message", "Job history is unavailable until the local API responds."));
      ui.detail.setAttribute("aria-busy", "false");
    }
  } finally {
    loading = false;
    ui.refresh.disabled = false;
    ui.list.setAttribute("aria-busy", "false");
  }
}

async function saveReview(episode, decision, note, feedback) {
  saving = true;
  ui.refresh.disabled = true;
  ui.detail.querySelectorAll("button[type='submit']").forEach(button => { button.disabled = true; });
  feedback.textContent = "Saving local review…";
  feedback.classList.remove("error");
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (localState.reviewToken) headers["X-Review-Token"] = localState.reviewToken;
  try {
    const response = await fetch("/api/review", {
      method: "POST", credentials: "same-origin", headers,
      body: JSON.stringify({ episodeId: episode.id, expectedRevision: episode.revision, note, decision }),
    });
    const nextState = await readResponse(response);
    validateState(nextState);
    reviewDrafts.delete(episode.id);
    saving = false;
    applyState(nextState);
    ui.error.hidden = true;
    const message = `Local review saved: ${readable(decision)}.`;
    const nextFeedback = document.querySelector("#review-feedback");
    if (nextFeedback) nextFeedback.textContent = message;
    ui.announcement.textContent = message;
  } catch (error) {
    feedback.classList.add("error");
    feedback.textContent = error.status === 409
      ? "This episode changed since it was loaded. Your note is preserved. Refresh the evidence, check the changes, then submit your review again."
      : `Review was not saved. ${error.message}`;
    ui.announcement.textContent = feedback.textContent;
  } finally {
    saving = false;
    ui.refresh.disabled = false;
    ui.detail.querySelectorAll("button[type='submit']").forEach(button => { button.disabled = false; });
  }
}

function onFilterChange() {
  if (!localState) return;
  renderList();
  renderDetail();
  ui.announcement.textContent = `${filteredEpisodes().length} matching concern episodes.`;
}

ui.search.addEventListener("input", onFilterChange);
[ui.topic, ui.language, ui.reporter, ui.status].forEach(select => select.addEventListener("change", onFilterChange));
document.querySelector("#clear-filters").addEventListener("click", () => {
  [ui.search, ui.topic, ui.language, ui.reporter, ui.status].forEach(input => { input.value = ""; });
  onFilterChange();
});
ui.refresh.addEventListener("click", loadState);
loadState();
