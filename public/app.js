/* Spektrum – vertikal durch Themen, horizontal durch Blickwinkel. Apple-Optik.
   Die Themen werden direkt im Browser gebildet; Cloudflare liefert nur die Feeds. */

import { buildSnapshot } from "./js/pipeline.js";
import { LEAN_LABEL } from "./js/sources.js";

const $ = (id) => document.getElementById(id);
const feed = $("feed");
const counter = $("counter");
const notice = $("notice");
const refreshButton = $("refresh");
const topicsDialog = $("topics-dialog");
const topicsList = $("topics-list");
const statusLine = $("status-line");
const sourcesDialog = $("sources-dialog");
const sourcesForm = $("sources-form");
const welcome = $("welcome");

const LEAN_ORDER = ["links", "mitte-links", "mitte", "mitte-rechts", "rechts"];

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollBehavior = reducedMotion ? "auto" : "smooth";

let snapshot = null;
let refreshing = false;
const STALE_MINUTES = 10;
const SNAPSHOT_KEY = "spektrum-snapshot-v1";
let visible = [];
let activeTopicIndex = 0;

/* ---------- Symbole (an SF Symbols angelehnt) ---------- */

const ICONS = {
  list: '<circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none"/><path d="M9 6h11M9 12h11M9 18h11"/>',
  sliders: '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="15" cy="6" r="2.4" fill="var(--glass-solid, #fff)"/><circle cx="8" cy="12" r="2.4" fill="var(--glass-solid, #fff)"/><circle cx="16" cy="18" r="2.4" fill="var(--glass-solid, #fff)"/>',
  xmark: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  updown: '<path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5"/>',
  leftright: '<path d="M3 12h18M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
  spectrum: '<path d="M3 12h18"/><circle cx="9" cy="12" r="3.5" fill="currentColor"/>',
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] ?? "";
  return svg;
}

function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    if (!node.querySelector("svg")) node.prepend(icon(node.dataset.icon));
  });
}

/* ---------- Hilfen ---------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") node.setAttribute("style", value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

function formatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Heute, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Gestern, ${time}`;
  return `${d.toLocaleDateString("de-DE", { day: "numeric", month: "short" })}, ${time}`;
}

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) ?? "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}

function poleColor(position) {
  return position < 45 ? "var(--left)" : position > 55 ? "var(--right)" : "var(--mid)";
}

/* ---------- Quellenfilter ---------- */

let hiddenSources = new Set(store("spektrum-hidden-sources") ?? []);

function applyFilter() {
  visible = (snapshot?.topics ?? [])
    .map((t) => ({ ...t, perspectives: t.perspectives.filter((p) => !hiddenSources.has(p.sourceId)) }))
    .filter((t) => t.perspectives.length >= 2);
}

/* ---------- Karten ---------- */

function renderStory(a) {
  return el("a", { class: "story", href: a.link, target: "_blank", rel: "noopener noreferrer" }, [
    el("h4", { class: "story-title", text: a.title }),
    a.teaser ? el("p", { class: "story-teaser", text: a.teaser }) : null,
    el("p", { class: "story-meta" }, [
      el("time", { datetime: a.publishedAt, text: formatTime(a.publishedAt) }),
      el("span", { class: "story-cta" }, ["Artikel lesen", icon("chevronRight")]),
    ]),
  ]);
}

function renderPanel(p, index) {
  const card = el("div", { class: "card", style: `--pole: ${poleColor(p.position)}` }, [
    el("header", { class: "card-head" }, [
      el("h3", { class: "source", text: p.sourceName }),
      el("span", { class: "lean-tag", text: LEAN_LABEL[p.lean] ?? p.lean }),
    ]),
  ]);
  if (p.summary) {
    if (p.tone) card.append(el("p", { class: "tone", text: `Tonfall: ${p.tone}` }));
    card.append(el("div", { class: "summary" }, p.summary.split(/\n\s*\n/).filter(Boolean).map((t) => el("p", { text: t.trim() }))));
    if (p.emphasis.length) {
      card.append(el("h4", { class: "emphasis-title", text: "Was hier im Vordergrund steht" }));
      card.append(el("ul", { class: "emphasis" }, p.emphasis.map((e) => el("li", { text: e }))));
    }
  }
  card.append(...p.articles.map(renderStory));
  return el("article", { class: "panel", "data-index": String(index), "aria-label": `${p.sourceName}, ${LEAN_LABEL[p.lean] ?? p.lean}` }, [card]);
}

function contextLine(perspectives) {
  const first = perspectives[0];
  const last = perspectives[perspectives.length - 1];
  if (perspectives.length === 2) return `${first.sourceName} und ${last.sourceName}`;
  return `${perspectives.length} Quellen von ${first.sourceName} bis ${last.sourceName}`;
}

function renderTopic(topic, index, total) {
  const perspectives = topic.perspectives;
  const panels = el("div", { class: "panels", role: "tabpanel" }, perspectives.map(renderPanel));

  const marks = perspectives.map((p, i) => {
    const edge = p.position < 14 ? " is-edge-left" : p.position > 86 ? " is-edge-right" : "";
    return el("button", {
      class: `mark${edge}`,
      type: "button",
      role: "tab",
      style: `--x: ${p.position}%`,
      "aria-selected": i === 0 ? "true" : "false",
      "aria-label": `${p.sourceName} (${LEAN_LABEL[p.lean] ?? p.lean})`,
      onclick: (event) => { event.stopPropagation(); scrollToPanel(panels, i); },
    }, [el("span", { class: "mark-name", text: p.sourceName })]);
  });

  const track = el("div", { class: "track", role: "tablist", "aria-label": "Quellen von links nach rechts" }, [
    el("div", { class: "track-line" }),
    el("span", { class: "pole pole-left", text: "Links" }),
    el("span", { class: "pole pole-mid", text: "Mitte" }),
    el("span", { class: "pole pole-right", text: "Rechts" }),
    ...marks,
  ]);
  track.addEventListener("click", (event) => {
    const rect = track.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    let best = 0;
    perspectives.forEach((p, i) => {
      if (Math.abs(p.position - x) < Math.abs(perspectives[best].position - x)) best = i;
    });
    scrollToPanel(panels, best);
  });

  const prev = el("button", { class: "glass-btn nav-arrow prev", type: "button", "aria-label": "Vorherige Quelle", onclick: () => scrollToPanel(panels, currentPanel(panels) - 1) }, [icon("chevronLeft")]);
  const next = el("button", { class: "glass-btn nav-arrow next", type: "button", "aria-label": "Nächste Quelle", onclick: () => scrollToPanel(panels, currentPanel(panels) + 1) }, [icon("chevronRight")]);

  const section = el("section", { class: "topic", "data-index": String(index), "aria-label": `Thema ${index + 1} von ${total}: ${topic.title}` }, [
    el("header", { class: "topic-head" }, [
      el("h2", { class: "topic-title", text: topic.title }),
      topic.neutralSummary ? el("p", { class: "topic-context", text: topic.neutralSummary }) : null,
      el("p", { class: "topic-context", text: contextLine(perspectives) }),
      track,
    ]),
    el("div", { class: "panels-wrap" }, [prev, panels, next]),
  ]);

  panels.addEventListener("scrollend", () => {
    clearTimeout(panels._targetTimer);
    delete panels.dataset.target;
  });
  let ticking = false;
  panels.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const i = Math.round(panels.scrollLeft / Math.max(1, panels.clientWidth));
      marks.forEach((m, j) => m.setAttribute("aria-selected", j === i ? "true" : "false"));
      prev.disabled = i <= 0;
      next.disabled = i >= perspectives.length - 1;
    });
  });
  prev.disabled = true;
  next.disabled = perspectives.length <= 1;
  return section;
}

function currentPanel(panels) {
  if (panels.dataset.target !== undefined) return Number(panels.dataset.target);
  return Math.round(panels.scrollLeft / Math.max(1, panels.clientWidth));
}

function scrollToPanel(panels, index) {
  const i = Math.max(0, Math.min(panels.children.length - 1, index));
  panels.dataset.target = String(i);
  clearTimeout(panels._targetTimer);
  panels._targetTimer = setTimeout(() => delete panels.dataset.target, 700);
  panels.scrollTo({ left: i * panels.clientWidth, behavior: scrollBehavior });
}

function scrollToTopic(index, behavior = scrollBehavior) {
  const sections = feed.querySelectorAll(".topic");
  const i = Math.max(0, Math.min(sections.length - 1, index));
  sections[i]?.scrollIntoView({ behavior, block: "start" });
}

function renderState(title, text) {
  feed.replaceChildren(el("div", { class: "state" }, [el("h2", { text: title }), el("p", { text })]));
  updateCounter(0);
}

function render() {
  applyFilter();
  if (!visible.length) {
    if (!snapshot?.generatedAt) renderState("Quellen werden gelesen", "Beim ersten Start werden alle Feeds abgerufen und zu Themen gebündelt. Das dauert einen Moment.");
    else if ((snapshot.topics ?? []).length && hiddenSources.size) renderState("Keine Themen mit diesen Quellen", "Schalte unter „Quellen“ mehr Medien ein, damit sich Themen vergleichen lassen.");
    else renderState("Noch keine gemeinsamen Themen", "Kein Thema wird gerade von mindestens drei Quellen aufgegriffen. Beim nächsten Aktualisieren wird es erneut versucht.");
    renderTopicList();
    return;
  }
  const keep = Math.min(activeTopicIndex, visible.length - 1);
  feed.replaceChildren(...visible.map((t, i) => renderTopic(t, i, visible.length)));
  observeTopics();
  updateCounter(keep);
  renderTopicList();
  if (keep > 0) requestAnimationFrame(() => scrollToTopic(keep, "auto"));
}

let observer = null;
function observeTopics() {
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) updateCounter(Number(entry.target.dataset.index));
    }
  }, { root: feed, threshold: [0.6] });
  feed.querySelectorAll(".topic").forEach((s) => observer.observe(s));
}

function updateCounter(index) {
  activeTopicIndex = index;
  counter.textContent = visible.length ? `Thema ${index + 1} von ${visible.length}` : "";
  topicsList.querySelectorAll(".row").forEach((b, i) => b.setAttribute("aria-current", i === index ? "true" : "false"));
}

/* ---------- Themenliste ---------- */

function renderTopicList() {
  topicsList.replaceChildren(...visible.map((t, i) =>
    el("li", {}, [
      el("button", { class: "row", type: "button", style: "--inset: 50px", "aria-current": i === activeTopicIndex ? "true" : "false", onclick: () => { closeSheet(topicsDialog); scrollToTopic(i, "auto"); } }, [
        el("span", { class: "row-num", text: String(i + 1) }),
        el("span", { class: "row-label" }, [t.title, el("span", { class: "row-sub", text: contextLine(t.perspectives) })]),
        el("span", { class: "row-chevron" }, [icon("chevronRight")]),
      ]),
    ]),
  ));
  renderStatusLine();
}

function renderStatusLine() {
  const parts = [];
  if (snapshot?.generatedAt) parts.push(`Stand: ${formatTime(snapshot.generatedAt)}.`);
  const total = (snapshot?.topics ?? []).length;
  if (total) parts.push(`${total} Themen aus ${(snapshot.sources ?? []).filter((s) => !s.error).length} Quellen.`);
  parts.push("Originaltexte der Medien, ohne KI.");
  parts.push(`Neue Themen werden beim Öffnen geladen, wenn der Stand älter als ${STALE_MINUTES} Minuten ist.`);
  statusLine.textContent = parts.join(" ");
}

/* ---------- Quellen ---------- */

function renderSources() {
  const sources = (snapshot?.sources ?? []).slice().sort((a, b) => a.position - b.position);
  const groups = new Map(LEAN_ORDER.map((l) => [l, []]));
  for (const s of sources) groups.get(s.lean)?.push(s);
  const children = [];
  for (const [lean, list] of groups) {
    if (!list.length) continue;
    const color = lean === "mitte" ? "var(--label-2)" : lean.includes("links") ? "var(--left)" : "var(--right)";
    children.push(el("p", { class: "group-header is-tinted", style: `--pole: ${color}`, text: LEAN_LABEL[lean] }));
    children.push(el("ul", { class: "group" }, list.map((s) =>
      el("li", {}, [
        el("label", { class: "row" }, [
          el("span", { class: "row-label" }, [s.name, el("span", { class: `row-sub${s.error ? " is-error" : ""}`, text: s.error ? "Gerade nicht erreichbar" : `${s.articles} aktuelle Artikel` })]),
          el("input", {
            class: "switch",
            type: "checkbox",
            role: "switch",
            name: s.id,
            "aria-label": s.name,
            checked: !hiddenSources.has(s.id),
            onchange: (e) => {
              if (e.target.checked) hiddenSources.delete(s.id); else hiddenSources.add(s.id);
              store("spektrum-hidden-sources", [...hiddenSources]);
              render();
            },
          }),
        ]),
      ]),
    )));
  }
  sourcesForm.replaceChildren(...children);
}

/* ---------- Sheets ---------- */

function openSheet(dialog) {
  if (dialog.open) return;
  dialog.classList.remove("is-closing");
  dialog.style.transform = "";
  dialog.showModal();
}

function closeSheet(dialog) {
  if (!dialog.open || dialog.classList.contains("is-closing")) return;
  if (reducedMotion) { dialog.close(); return; }
  dialog.classList.add("is-closing");
  dialog.addEventListener("animationend", () => {
    dialog.classList.remove("is-closing");
    dialog.style.transform = "";
    dialog.close();
  }, { once: true });
}

/* Herunterziehen am Griff oder Kopf schließt das Sheet */
function enableDragToClose(dialog, onClose = () => closeSheet(dialog)) {
  const handle = dialog.querySelector(".sheet-head") ?? dialog;
  const grabber = dialog.querySelector(".grabber");
  let startY = null;
  let dy = 0;
  const down = (event) => {
    if (event.target.closest("button")) return;
    startY = event.clientY;
    dy = 0;
    dialog.style.transition = "none";
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* z. B. synthetische Ereignisse */ }
  };
  const move = (event) => {
    if (startY === null) return;
    dy = Math.max(0, event.clientY - startY);
    dialog.style.transform = `translateY(${dy}px)`;
  };
  const up = () => {
    if (startY === null) return;
    startY = null;
    dialog.style.transition = "transform 260ms cubic-bezier(0.32, 0.72, 0, 1)";
    if (dy > 110) {
      dialog.style.transform = "translateY(105%)";
      setTimeout(() => { dialog.style.transition = ""; dialog.style.transform = ""; dialog.close(); onClose(true); }, 240);
    } else {
      dialog.style.transform = "";
      setTimeout(() => { dialog.style.transition = ""; }, 260);
    }
  };
  for (const target of [handle, grabber].filter(Boolean)) {
    target.addEventListener("pointerdown", down);
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }
}

for (const dialog of [topicsDialog, sourcesDialog]) {
  dialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeSheet(dialog)));
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeSheet(dialog); });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeSheet(dialog); });
  enableDragToClose(dialog);
}

function finishWelcome() {
  store("spektrum-welcome", 1);
  closeSheet(welcome);
}
$("welcome-ok").addEventListener("click", finishWelcome);
welcome.addEventListener("cancel", (event) => { event.preventDefault(); finishWelcome(); });

$("topics-btn").addEventListener("click", () => { renderTopicList(); openSheet(topicsDialog); });
$("sources-btn").addEventListener("click", () => { renderSources(); openSheet(sourcesDialog); });

/* ---------- Hinweise, Speichern, Aktualisieren ---------- */

function showNotice(text, progress = false) {
  notice.hidden = !text;
  notice.textContent = text || "";
  notice.classList.toggle("is-progress", progress);
}

function noticeFromSnapshot() {
  const errors = snapshot?.errors ?? [];
  if (!errors.length) return "";
  const feedErrors = errors.filter((e) => e.includes("Feed nicht lesbar"));
  const other = errors.filter((e) => !e.includes("Feed nicht lesbar"));
  if (other.length) return other[0];
  return feedErrors.length === 1 ? feedErrors[0] : `${feedErrors.length} Quellen konnten gerade nicht gelesen werden.`;
}

function isStale() {
  if (!snapshot?.generatedAt) return true;
  return Date.now() - new Date(snapshot.generatedAt).getTime() > STALE_MINUTES * 60_000;
}

function setRefreshLabel(text, disabled) {
  refreshButton.disabled = disabled;
  refreshButton.querySelector(".row-label").textContent = text;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  setRefreshLabel("Wird aktualisiert …", true);
  try {
    snapshot = await buildSnapshot(snapshot, (done, total) => {
      showNotice(done < total ? `Quellen werden gelesen … ${done} von ${total}` : "Themen werden gebündelt …", true);
    });
    store(SNAPSHOT_KEY, snapshot);
    render();
    renderSources();
    showNotice(noticeFromSnapshot());
  } catch (err) {
    showNotice(`Aktualisierung fehlgeschlagen: ${err?.message || err}`);
    if (!snapshot) renderState("Keine Verbindung", "Die Quellen konnten nicht geladen werden. Prüfe die Internetverbindung und öffne die App erneut.");
  } finally {
    refreshing = false;
    setRefreshLabel("Jetzt aktualisieren", false);
    renderStatusLine();
  }
}

refreshButton.addEventListener("click", () => refresh());

/* ---------- Tastatur ---------- */

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (topicsDialog.open || sourcesDialog.open || welcome.open) return;
  const panels = feed.querySelectorAll(".topic")[activeTopicIndex]?.querySelector(".panels");
  switch (event.key) {
    case "ArrowRight": if (panels) { scrollToPanel(panels, currentPanel(panels) + 1); event.preventDefault(); } break;
    case "ArrowLeft": if (panels) { scrollToPanel(panels, currentPanel(panels) - 1); event.preventDefault(); } break;
    case "ArrowDown": case "PageDown": case "j": scrollToTopic(activeTopicIndex + 1); event.preventDefault(); break;
    case "ArrowUp": case "PageUp": case "k": scrollToTopic(activeTopicIndex - 1); event.preventDefault(); break;
    case "r": refresh(); break;
  }
});

/* ---------- Start ---------- */

hydrateIcons();
snapshot = store(SNAPSHOT_KEY);
render();
renderSources();
showNotice(noticeFromSnapshot());
if (!store("spektrum-welcome")) openSheet(welcome);
if (isStale()) refresh();
// Beim Zurückkehren in die App (z. B. vom Home-Bildschirm) neue Themen holen
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isStale()) refresh();
});
if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch(() => {});
