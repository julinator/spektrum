/* Spektrum – vertikal durch Themen, horizontal durch Blickwinkel. Apple-Optik.
   Die Themen werden direkt im Browser gebildet; Cloudflare liefert nur die Feeds. */

import { buildSnapshot } from "./js/pipeline.js";
import { LEAN_LABEL, sourceById } from "./js/sources.js";

const $ = (id) => document.getElementById(id);
const feed = $("feed");
const counter = $("counter");
const notice = $("notice");
const ptr = $("ptr");
const refreshButton = $("refresh");
const topicsDialog = $("topics-dialog");
const topicsList = $("topics-list");
const savedSection = $("saved-section");
const statusLine = $("status-line");
const sourcesDialog = $("sources-dialog");
const sourcesForm = $("sources-form");
const savedDialog = $("saved-dialog");
const leanDialog = $("lean-dialog");
const welcome = $("welcome");

const LEAN_ORDER = ["links", "mitte-links", "mitte", "mitte-rechts", "rechts"];
const STALE_MINUTES = 10;
const SNAPSHOT_KEY = "spektrum-snapshot-v1";
const SEEN_KEY = "spektrum-seen-v1";
const OPENED_KEY = "spektrum-opened-v1";
const SAVED_KEY = "spektrum-saved-v1";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollBehavior = reducedMotion ? "auto" : "smooth";

let snapshot = null;
let refreshing = false;
let visible = [];
let activeTopicIndex = 0;
let seenTimer = null;

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
  bookmark: '<path d="M6.5 3.5h11v17L12 16.5l-5.5 4z"/>',
  bookmarkFill: '<path d="M6.5 3.5h11v17L12 16.5l-5.5 4z" fill="currentColor"/>',
  share: '<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M8.5 11H6v9.5h12V11h-2.5"/>',
  eyeSlash: '<path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.6"/><path d="M4.5 4.5l15 15"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  arrowDown: '<path d="M12 4v15M6 13l6 6 6-6"/>',
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

function sideOf(position) {
  return position < 45 ? "links" : position > 55 ? "rechts" : "mitte";
}

function poleColor(position) {
  const side = sideOf(position);
  return side === "links" ? "var(--left)" : side === "rechts" ? "var(--right)" : "var(--mid)";
}

/* ---------- Quellenfilter ---------- */

let hiddenSources = new Set(store("spektrum-hidden-sources") ?? []);

function applyFilter() {
  visible = (snapshot?.topics ?? [])
    .map((t) => ({ ...t, perspectives: t.perspectives.filter((p) => !hiddenSources.has(p.sourceId)) }))
    .filter((t) => t.perspectives.length >= 2);
}

/* ---------- Neu, gelesen, geöffnet ---------- */

function prune(map, days = 5) {
  const cut = Date.now() - days * 86_400_000;
  for (const key of Object.keys(map)) if (map[key] < cut) delete map[key];
  return map;
}

const seen = prune(store(SEEN_KEY) ?? {});
const opened = prune(store(OPENED_KEY) ?? {});
// Beim allerersten Öffnen ist alles neu; dann keine „Neu“-Marken zeigen
const firstUse = Object.keys(seen).length === 0;

function articleKey(a) {
  return a.id ?? a.link;
}

function articleKeys(topic) {
  return topic.perspectives.flatMap((p) => p.articles.map(articleKey));
}

function topicState(topic) {
  const keys = articleKeys(topic);
  const count = keys.filter((k) => seen[k]).length;
  return { isNew: !firstUse && count === 0, isRead: keys.length > 0 && count / keys.length >= 0.8 };
}

function markSeen(topic) {
  const now = Date.now();
  for (const key of articleKeys(topic)) seen[key] ??= now;
  store(SEEN_KEY, seen);
}

function newCount() {
  return visible.filter((t) => topicState(t).isNew).length;
}

/* ---------- Abdeckung und blinde Flecken ---------- */

function coverage(perspectives) {
  const c = { links: 0, mitte: 0, rechts: 0 };
  for (const p of perspectives) c[sideOf(p.position)]++;
  return c;
}

function availability() {
  const a = { links: 0, mitte: 0, rechts: 0 };
  for (const s of snapshot?.sources ?? []) if (!hiddenSources.has(s.id) && !s.error && !s.pending) a[sideOf(s.position)]++;
  return a;
}

/** Hinweis, wenn eine Seite ein Thema kaum oder gar nicht aufgreift (gemessen an ihren verfügbaren Quellen). */
function blindspot(perspectives) {
  const c = coverage(perspectives);
  const av = availability();
  if (!av.links || !av.rechts) return null;
  const l = c.links / av.links;
  const r = c.rechts / av.rechts;
  if (c.links === 0 && r >= 0.25) return "Nicht von links aufgegriffen";
  if (c.rechts === 0 && l >= 0.25) return "Nicht von rechts aufgegriffen";
  if (l <= 0.2 && r >= 0.5) return "Kaum von links aufgegriffen";
  if (r <= 0.2 && l >= 0.5) return "Kaum von rechts aufgegriffen";
  return null;
}

/* ---------- Merken ---------- */

let saved = store(SAVED_KEY) ?? [];

function overlapShare(keySet, keys) {
  if (!keys.length || !keySet.size) return 0;
  return keys.filter((k) => keySet.has(k)).length / Math.min(keySet.size, keys.length);
}

function savedEntryFor(topic) {
  const keys = new Set(articleKeys(topic));
  return saved.find((s) => s.topic.id === topic.id || overlapShare(keys, articleKeys(s.topic)) >= 0.5);
}

function toggleSaved(topic) {
  const entry = savedEntryFor(topic);
  if (entry) saved = saved.filter((s) => s !== entry);
  else saved.unshift({ savedAt: new Date().toISOString(), topic: structuredClone(topic) });
  saved = saved.slice(0, 50);
  store(SAVED_KEY, saved);
  renderSavedSection();
  return !entry;
}

function updateBookmarkButton(button, isSaved) {
  button.replaceChildren(icon(isSaved ? "bookmarkFill" : "bookmark"));
  button.setAttribute("aria-pressed", isSaved ? "true" : "false");
  button.setAttribute("aria-label", isSaved ? "Nicht mehr merken" : "Thema merken");
}

/* ---------- Teilen ---------- */

async function shareTopic(topic) {
  const lines = topic.perspectives.map((p) => `${p.sourceName}: ${p.articles[0]?.title ?? ""}`);
  const text = `${topic.title}\n\nSo berichten die Medien, von links nach rechts:\n${lines.join("\n")}`;
  const url = location.origin + location.pathname;
  if (navigator.share) {
    try {
      await navigator.share({ title: topic.title, text, url });
    } catch {
      /* abgebrochen */
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n\n${url}`);
    flash("Vergleich in die Zwischenablage kopiert.");
  } catch {
    flash("Teilen ist auf diesem Gerät nicht möglich.");
  }
}

/* ---------- Karten ---------- */

function renderImage(src, className) {
  if (!src) return null;
  return el("img", {
    class: className,
    src,
    alt: "",
    loading: "lazy",
    decoding: "async",
    referrerpolicy: "no-referrer",
    onerror: (event) => {
      const story = event.target.closest(".story");
      event.target.remove();
      story?.classList.remove("has-thumb");
    },
  });
}

function renderStory(a, index) {
  const key = articleKey(a);
  const large = index === 0 && a.image;
  const thumb = index > 0 && a.image;
  const node = el("a", {
    class: `story${opened[key] ? " is-read" : ""}${thumb ? " has-thumb" : ""}`,
    href: a.link,
    target: "_blank",
    rel: "noopener noreferrer",
    onclick: () => {
      opened[key] = Date.now();
      store(OPENED_KEY, opened);
      node.classList.add("is-read");
    },
  }, [
    large ? renderImage(a.image, "story-image") : null,
    el("div", { class: "story-body" }, [
      el("div", { class: "story-text" }, [
        el("h4", { class: "story-title", text: a.title }),
        a.teaser ? el("p", { class: "story-teaser", text: a.teaser }) : null,
      ]),
      thumb ? renderImage(a.image, "story-thumb") : null,
    ]),
    el("p", { class: "story-meta" }, [
      el("time", { datetime: a.publishedAt, text: formatTime(a.publishedAt) }),
      el("span", { class: "story-cta" }, [opened[key] ? "Gelesen" : "Artikel lesen", icon("chevronRight")]),
    ]),
  ]);
  return node;
}

function renderPanel(p, index) {
  const card = el("div", { class: "card", style: `--pole: ${poleColor(p.position)}` }, [
    el("header", { class: "card-head" }, [
      el("h3", { class: "source", text: p.sourceName }),
      el("button", {
        class: "lean-tag",
        type: "button",
        "aria-label": `${LEAN_LABEL[p.lean] ?? p.lean}: Einordnung von ${p.sourceName} erklären`,
        onclick: () => openLean(p),
      }, [LEAN_LABEL[p.lean] ?? p.lean]),
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

function renderCoverage(perspectives) {
  const c = coverage(perspectives);
  const parts = [["links", "var(--left)", `${c.links} links`], ["mitte", "var(--mid)", `${c.mitte} Mitte`], ["rechts", "var(--right)", `${c.rechts} rechts`]];
  return [
    el("div", {
      class: "coverage-bar",
      role: "img",
      "aria-label": `Abdeckung: ${c.links} Quellen links, ${c.mitte} in der Mitte, ${c.rechts} rechts`,
    }, parts.filter(([side]) => c[side] > 0).map(([side, color]) => el("span", { class: "coverage-seg", style: `flex-grow: ${c[side]}; --pole: ${color}` }))),
    el("p", { class: "coverage-legend", "aria-hidden": "true" }, parts.map(([, color, label]) => el("span", { style: `--pole: ${color}` }, [label]))),
  ];
}

/** Schlagzeilen von links nach rechts. Mit `onPick` springt ein Tipp zur Quelle, sonst öffnet er den Artikel. */
function renderHeadlines(perspectives, onPick) {
  return el("ul", { class: "headlines" }, perspectives.map((p, i) => {
    const a = p.articles[0];
    const content = [
      el("span", { class: "hl-dot", style: `--pole: ${poleColor(p.position)}` }),
      el("span", { class: "hl-text" }, [
        el("span", { class: "hl-source", text: p.sourceName }),
        el("span", { class: "hl-title", text: a?.title ?? "" }),
      ]),
      el("span", { class: "row-chevron" }, [icon(onPick ? "chevronRight" : "external")]),
    ];
    const item = onPick
      ? el("button", { class: "hl-row", type: "button", onclick: () => onPick(i) }, content)
      : el("a", { class: "hl-row", href: a?.link, target: "_blank", rel: "noopener noreferrer" }, content);
    return el("li", {}, [item]);
  }));
}

function renderOverview(topic, panels) {
  const spot = blindspot(topic.perspectives);
  const card = el("div", { class: "card overview" }, [
    el("header", { class: "card-head" }, [
      el("h3", { class: "source", text: "Überblick" }),
      spot ? el("span", { class: "badge badge-blind" }, [icon("eyeSlash"), spot]) : null,
    ]),
    el("p", { class: "section-label", text: "Wer berichtet" }),
    ...renderCoverage(topic.perspectives),
    el("p", { class: "section-label", text: "Schlagzeilen von links nach rechts" }),
    renderHeadlines(topic.perspectives, (i) => scrollToPanel(panels, i + 1)),
  ]);
  return el("article", { class: "panel", "data-index": "0", "aria-label": "Überblick" }, [card]);
}

function contextLine(perspectives) {
  const first = perspectives[0];
  const last = perspectives[perspectives.length - 1];
  if (perspectives.length === 2) return `${first.sourceName} und ${last.sourceName}`;
  return `${perspectives.length} Quellen von ${first.sourceName} bis ${last.sourceName}`;
}

function renderTopic(topic, index, total) {
  const perspectives = topic.perspectives;
  const panels = el("div", { class: "panels", role: "tabpanel" });
  panels.append(renderOverview(topic, panels), ...perspectives.map((p, i) => renderPanel(p, i + 1)));

  const marks = perspectives.map((p, i) => {
    const edge = p.position < 14 ? " is-edge-left" : p.position > 86 ? " is-edge-right" : "";
    return el("button", {
      class: `mark${edge}`,
      type: "button",
      role: "tab",
      style: `--x: ${p.position}%`,
      "aria-selected": "false",
      "aria-label": `${p.sourceName} (${LEAN_LABEL[p.lean] ?? p.lean})`,
      onclick: (event) => { event.stopPropagation(); scrollToPanel(panels, i + 1); },
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
    scrollToPanel(panels, best + 1);
  });

  const state = topicState(topic);
  const spot = blindspot(perspectives);
  const badges = [
    state.isNew ? el("span", { class: "badge badge-new", text: "Neu" }) : null,
    spot ? el("span", { class: "badge badge-blind" }, [icon("eyeSlash"), spot]) : null,
  ].filter(Boolean);

  const bookmark = el("button", { class: "icon-btn", type: "button" });
  updateBookmarkButton(bookmark, Boolean(savedEntryFor(topic)));
  bookmark.addEventListener("click", () => {
    const isSaved = toggleSaved(topic);
    updateBookmarkButton(bookmark, isSaved);
    flash(isSaved ? "Thema gemerkt. Du findest es in der Themenliste." : "Thema nicht mehr gemerkt.");
  });
  const share = el("button", { class: "icon-btn", type: "button", "aria-label": "Vergleich teilen", onclick: () => shareTopic(topic) }, [icon("share")]);

  const prev = el("button", { class: "glass-btn nav-arrow prev", type: "button", "aria-label": "Vorherige Karte", onclick: () => scrollToPanel(panels, currentPanel(panels) - 1) }, [icon("chevronLeft")]);
  const next = el("button", { class: "glass-btn nav-arrow next", type: "button", "aria-label": "Nächste Karte", onclick: () => scrollToPanel(panels, currentPanel(panels) + 1) }, [icon("chevronRight")]);

  const section = el("section", { class: "topic", "data-index": String(index), "aria-label": `Thema ${index + 1} von ${total}: ${topic.title}` }, [
    el("header", { class: "topic-head" }, [
      badges.length ? el("div", { class: "badges" }, badges) : null,
      el("h2", { class: "topic-title", text: topic.title }),
      topic.neutralSummary ? el("p", { class: "topic-context", text: topic.neutralSummary }) : null,
      el("div", { class: "context-row" }, [
        el("p", { class: "topic-context", text: contextLine(perspectives) }),
        bookmark,
        share,
      ]),
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
      const i = panelIndexFromScroll(panels);
      marks.forEach((m, j) => m.setAttribute("aria-selected", j === i - 1 ? "true" : "false"));
      prev.disabled = i <= 0;
      next.disabled = i >= perspectives.length;
    });
  });
  prev.disabled = true;
  next.disabled = false;
  return section;
}

function panelStep(panels) {
  const first = panels.firstElementChild;
  const gap = parseFloat(getComputedStyle(panels).columnGap) || 0;
  return Math.max(1, (first?.offsetWidth ?? panels.clientWidth) + gap);
}

function panelIndexFromScroll(panels) {
  return Math.round(panels.scrollLeft / panelStep(panels));
}

function currentPanel(panels) {
  if (panels.dataset.target !== undefined) return Number(panels.dataset.target);
  return panelIndexFromScroll(panels);
}

function scrollToPanel(panels, index) {
  const count = panels.querySelectorAll(":scope > .panel").length;
  const i = Math.max(0, Math.min(count - 1, index));
  panels.dataset.target = String(i);
  clearTimeout(panels._targetTimer);
  panels._targetTimer = setTimeout(() => delete panels.dataset.target, 700);
  panels.scrollTo({ left: i * panelStep(panels), behavior: scrollBehavior });
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

function renderCounter() {
  if (!visible.length) {
    counter.textContent = "";
    return;
  }
  const fresh = newCount();
  counter.textContent = `Thema ${activeTopicIndex + 1} von ${visible.length}${fresh ? `, ${fresh} neu` : ""}`;
}

function updateCounter(index) {
  activeTopicIndex = index;
  renderCounter();
  topicsList.querySelectorAll(".row").forEach((b, i) => b.setAttribute("aria-current", i === index ? "true" : "false"));
  // Wer ein Thema 1,5 Sekunden ansieht, hat es gesehen
  clearTimeout(seenTimer);
  const topic = visible[index];
  if (!topic) return;
  seenTimer = setTimeout(() => {
    markSeen(topic);
    feed.querySelectorAll(".topic")[index]?.querySelector(".badge-new")?.remove();
    renderCounter();
    // Liste nicht unter dem Finger umbauen, solange das Sheet offen ist
    if (!topicsDialog.open) renderTopicList();
  }, 1500);
}

/* ---------- Themenliste und Merkliste ---------- */

function renderTopicList() {
  topicsList.replaceChildren(...visible.map((t, i) => {
    const state = topicState(t);
    const spot = blindspot(t.perspectives);
    return el("li", {}, [
      el("button", {
        class: `row${state.isRead && !state.isNew ? " is-read" : ""}`,
        type: "button",
        style: "--inset: 50px",
        "aria-current": i === activeTopicIndex ? "true" : "false",
        onclick: () => { closeSheet(topicsDialog); scrollToTopic(i, "auto"); },
      }, [
        el("span", { class: "row-num" }, [state.isNew ? el("span", { class: "unread-dot", "aria-label": "Neu" }) : String(i + 1)]),
        el("span", { class: "row-label" }, [
          t.title,
          el("span", { class: "row-sub", text: contextLine(t.perspectives) }),
          spot ? el("span", { class: "row-sub is-blind", text: spot }) : null,
        ]),
        el("span", { class: "row-chevron" }, [icon("chevronRight")]),
      ]),
    ]);
  }));
  renderSavedSection();
  renderStatusLine();
}

function renderSavedSection() {
  if (!saved.length) {
    savedSection.replaceChildren();
    return;
  }
  savedSection.replaceChildren(
    el("p", { class: "group-header", text: "Gemerkt" }),
    el("ul", { class: "group" }, saved.map((entry) =>
      el("li", {}, [
        el("button", { class: "row", type: "button", style: "--inset: 50px", onclick: () => openSaved(entry) }, [
          el("span", { class: "row-num saved-icon" }, [icon("bookmarkFill")]),
          el("span", { class: "row-label" }, [
            entry.topic.title,
            el("span", { class: "row-sub", text: `Gemerkt ${formatTime(entry.savedAt)}` }),
          ]),
          el("span", { class: "row-chevron" }, [icon("chevronRight")]),
        ]),
      ]),
    )),
    el("p", { class: "group-header", text: "Aktuelle Themen" }),
  );
}

function openSaved(entry) {
  // Ist das Thema noch aktuell, direkt dorthin springen
  const keys = new Set(articleKeys(entry.topic));
  const index = visible.findIndex((t) => t.id === entry.topic.id || overlapShare(keys, articleKeys(t)) >= 0.5);
  if (index >= 0) {
    closeSheet(topicsDialog);
    scrollToTopic(index, "auto");
    return;
  }
  const body = savedDialog.querySelector(".sheet-body");
  const remove = el("button", { class: "row row-action is-destructive", type: "button" }, [el("span", { class: "row-label", text: "Nicht mehr merken" })]);
  remove.addEventListener("click", () => {
    saved = saved.filter((s) => s !== entry);
    store(SAVED_KEY, saved);
    renderSavedSection();
    renderTopicList();
    closeSheet(savedDialog);
  });
  body.replaceChildren(
    el("h3", { class: "saved-title", text: entry.topic.title }),
    el("p", { class: "group-footer saved-meta", text: `Gemerkt ${formatTime(entry.savedAt)}. ${contextLine(entry.topic.perspectives)}.` }),
    el("div", { class: "card overview" }, [
      el("p", { class: "section-label", text: "Wer berichtet" }),
      ...renderCoverage(entry.topic.perspectives),
      el("p", { class: "section-label", text: "Schlagzeilen von links nach rechts" }),
      renderHeadlines(entry.topic.perspectives, null),
    ]),
    el("ul", { class: "group saved-actions" }, [
      el("li", {}, [el("button", { class: "row row-action", type: "button", onclick: () => shareTopic(entry.topic) }, [el("span", { class: "row-icon" }, [icon("share")]), el("span", { class: "row-label", text: "Vergleich teilen" })])]),
      el("li", {}, [remove]),
    ]),
  );
  closeSheet(topicsDialog);
  setTimeout(() => openSheet(savedDialog), reducedMotion ? 0 : 260);
}

function renderStatusLine() {
  const parts = [];
  if (snapshot?.generatedAt) parts.push(`Stand: ${formatTime(snapshot.generatedAt)}.`);
  const total = (snapshot?.topics ?? []).length;
  if (total) parts.push(`${total} Themen aus ${(snapshot.sources ?? []).filter((s) => !s.error && !s.pending).length} Quellen.`);
  parts.push("Originaltexte der Medien, ohne KI.");
  parts.push(`Neue Themen werden beim Öffnen geladen, wenn der Stand älter als ${STALE_MINUTES} Minuten ist. Zum sofortigen Aktualisieren die Themen nach unten ziehen.`);
  statusLine.textContent = parts.join(" ");
}

/* ---------- Einordnung erklären ---------- */

function openLean(p) {
  const src = sourceById(p.sourceId);
  const body = leanDialog.querySelector(".sheet-body");
  leanDialog.querySelector("#lean-title").textContent = p.sourceName;
  body.replaceChildren(
    el("div", { class: "card lean-card", style: `--pole: ${poleColor(p.position)}` }, [
      el("p", { class: "lean-label", text: LEAN_LABEL[p.lean] ?? p.lean }),
      el("div", { class: "lean-meter", "aria-hidden": "true" }, [
        el("span", { class: "lean-meter-line" }),
        el("span", { class: "lean-meter-dot", style: `--x: ${p.position}%` }),
      ]),
      el("p", { class: "lean-poles", "aria-hidden": "true" }, [el("span", { text: "Links" }), el("span", { text: "Mitte" }), el("span", { text: "Rechts" })]),
      src?.note ? el("p", { class: "lean-note", text: src.note }) : null,
    ]),
    el("p", { class: "group-footer lean-disclaimer", text: "Die Einordnung ist eine grobe redaktionelle Näherung auf Basis gängiger Einschätzungen der Medienlandschaft, keine wissenschaftliche Messung. Unter „Quellen“ kannst du Medien ein- und ausschalten." }),
    src?.site ? el("ul", { class: "group" }, [
      el("li", {}, [el("a", { class: "row row-action", href: src.site, target: "_blank", rel: "noopener noreferrer" }, [
        el("span", { class: "row-icon" }, [icon("external")]),
        el("span", { class: "row-label", text: `${p.sourceName} öffnen` }),
      ])]),
    ]) : null,
  );
  openSheet(leanDialog);
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
          el("span", { class: "row-label" }, [s.name, el("span", { class: `row-sub${s.error ? " is-error" : ""}`, text: s.error ? "Gerade nicht erreichbar" : s.pending ? "Wird geladen …" : `${s.articles} aktuelle Artikel` })]),
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
function enableDragToClose(dialog) {
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
      setTimeout(() => { dialog.style.transition = ""; dialog.style.transform = ""; dialog.close(); }, 240);
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

for (const dialog of [topicsDialog, sourcesDialog, savedDialog, leanDialog]) {
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

let flashTimer = null;

function showNotice(text, progress = false) {
  notice.hidden = !text;
  notice.textContent = text || "";
  notice.classList.toggle("is-progress", progress);
}

/** Kurzer Hinweis, danach wieder der normale Zustand */
function flash(text) {
  clearTimeout(flashTimer);
  showNotice(text);
  flashTimer = setTimeout(() => { if (!refreshing) showNotice(noticeFromSnapshot()); }, 3000);
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
  // Fehlten beim letzten Mal Quellen (z. B. App mitten im Laden verlassen), früher erneut versuchen
  const minutes = snapshot.errors?.length ? 1 : STALE_MINUTES;
  return Date.now() - new Date(snapshot.generatedAt).getTime() > minutes * 60_000;
}

function setRefreshLabel(text, disabled) {
  refreshButton.disabled = disabled;
  refreshButton.querySelector(".row-label").textContent = text;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  clearTimeout(flashTimer);
  setRefreshLabel("Wird aktualisiert …", true);
  try {
    snapshot = await buildSnapshot(snapshot, (done, total) => {
      showNotice(done < total ? `Quellen werden gelesen … ${done} von ${total}` : "Themen werden gebündelt …", true);
    }, {
      // Beim ersten Laden nicht auf langsame Feeds warten: vorläufigen Stand schon zeigen
      onPartial: (partial) => {
        if (snapshot?.topics?.length) return;
        snapshot = partial;
        render();
        renderSources();
      },
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
    endPull();
  }
}

refreshButton.addEventListener("click", () => refresh());

/* ---------- Herunterziehen zum Aktualisieren ---------- */

const PULL_TRIGGER = 64;
let pullStartY = null;
let pullStartX = 0;
let pullDy = 0;
let pulling = false;

function setPull(dy, mode) {
  feed.style.transform = dy ? `translateY(${dy}px)` : "";
  ptr.style.setProperty("--pull", String(Math.min(1, dy / PULL_TRIGGER)));
  ptr.dataset.mode = mode;
  ptr.querySelector(".ptr-label").textContent =
    mode === "loading" ? "Wird aktualisiert …" : mode === "ready" ? "Loslassen zum Aktualisieren" : "Zum Aktualisieren ziehen";
}

function endPull() {
  feed.classList.remove("is-dragging");
  setPull(0, "idle");
}

feed.addEventListener("touchstart", (event) => {
  if (refreshing || feed.scrollTop > 0 || event.touches.length !== 1) return;
  const panel = event.target.closest(".panel");
  if (panel && panel.scrollTop > 0) return;
  pullStartY = event.touches[0].clientY;
  pullStartX = event.touches[0].clientX;
  pullDy = 0;
  pulling = false;
}, { passive: true });

feed.addEventListener("touchmove", (event) => {
  if (pullStartY === null) return;
  const dy = event.touches[0].clientY - pullStartY;
  const dx = Math.abs(event.touches[0].clientX - pullStartX);
  if (!pulling) {
    if (dy > 8 && dy > dx * 1.5) {
      pulling = true;
      feed.classList.add("is-dragging");
    } else if (dy < -4 || dx > 10) {
      pullStartY = null;
      return;
    } else {
      return;
    }
  }
  event.preventDefault();
  pullDy = Math.min(110, dy * 0.5);
  setPull(pullDy, pullDy >= PULL_TRIGGER ? "ready" : "pull");
}, { passive: false });

function finishTouch() {
  if (pullStartY === null) return;
  pullStartY = null;
  if (!pulling) return;
  pulling = false;
  feed.classList.remove("is-dragging");
  if (pullDy >= PULL_TRIGGER) {
    setPull(52, "loading");
    refresh();
  } else {
    endPull();
  }
}
feed.addEventListener("touchend", finishTouch);
feed.addEventListener("touchcancel", finishTouch);

/* ---------- Tastatur ---------- */

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if ([topicsDialog, sourcesDialog, savedDialog, leanDialog, welcome].some((d) => d.open)) return;
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
