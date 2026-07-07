// Content script — scans headline links, queues them for evaluation,
// and injects result badges inline next to the link text.
//
// NOTE: MV3 content scripts do not support ES module imports.
// Category definitions are inlined here. Keep in sync with shared/categories.js.
// If you add a build step (see package.json), the import version in the src/ folder
// will be used instead and this file becomes the bundle output.

// ─── Inlined category definitions ────────────────────────────────────────────

const CATEGORIES = {
  BLATANT_BAIT: { label: "Blatant bait", color: "#2C2C2A", textColor: "#D3D1C7", severity: 5 },
  RAGEBAIT:     { label: "Ragebait",     color: "#FCEBEB", textColor: "#A32D2D", severity: 4 },
  CLICKBAIT:    { label: "Clickbait",    color: "#FAEEDA", textColor: "#854F0B", severity: 3 },
  MISLEADING:   { label: "Misleading",   color: "#F1EFE8", textColor: "#5F5E5A", borderColor: "#B4B2A9", severity: 2 },
  ACCURATE:     { label: "Accurate",     color: "#EAF3DE", textColor: "#3B6D11", severity: 0 },
  UNDERSELLS:   { label: "Undersells",   color: "#F1EFE8", textColor: "#888780", severity: 1 }
};

// ─── Config ───────────────────────────────────────────────────────────────────

const HOVER_DELAY_MS = 400;
const MAX_CONCURRENT = 2;
const MIN_HEADLINE_CHARS = 30;
const DEFAULT_SEVERITY_THRESHOLD = 2;

// ─── State ────────────────────────────────────────────────────────────────────

const evaluated = new Set();
const queue = [];
let running = 0;
let _threshold = null;

// Per-page stats — reported to popup on request
const pageStats = { total: 0, byCategory: {} };

function recordStat(classification) {
  pageStats.total++;
  pageStats.byCategory[classification] = (pageStats.byCategory[classification] || 0) + 1;
  // Notify popup if it happens to be open
  chrome.runtime.sendMessage({ type: "PAGE_STATS", stats: pageStats }).catch(() => {});
}

// ─── Link detection ───────────────────────────────────────────────────────────

function isHeadlineLink(a) {
  const text = a.textContent.trim();
  if (text.length < MIN_HEADLINE_CHARS) return false;
  if (!a.href || a.href.startsWith("javascript") || a.href.includes("#")) return false;
  if (a.dataset.cbdProcessed) return false;
  const fontSize = parseFloat(window.getComputedStyle(a).fontSize);
  if (fontSize > 0 && fontSize < 12) return false;
  return true;
}

// ─── Threshold (cached after first storage read) ──────────────────────────────

function getThreshold(cb) {
  if (_threshold !== null) return cb(_threshold);
  chrome.storage.sync.get({ severityThreshold: DEFAULT_SEVERITY_THRESHOLD }, r => {
    _threshold = r.severityThreshold;
    cb(_threshold);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && "severityThreshold" in changes) {
    _threshold = changes.severityThreshold.newValue;
  }
});

// ─── Badge injection ──────────────────────────────────────────────────────────

function injectBadge(a, result) {
  if (!result?.classification) return;
  const cat = CATEGORIES[result.classification];
  if (!cat) return;

  getThreshold(threshold => {
    if (cat.severity < threshold) {
      chrome.runtime.sendMessage({ type: "BADGE_SKIP", url: a.href, headline: a.textContent.trim(), classification: result.classification }).catch(() => {});
      return;
    }

    const badge = document.createElement("span");
    badge.className = "cbd-badge";
    badge.style.cssText = [
      "display:inline-block", "margin-left:6px", "padding:1px 7px",
      "border-radius:10px", "font-size:11px", "font-weight:500",
      "line-height:1.6", "vertical-align:middle", "cursor:help",
      `background:${cat.color}`, `color:${cat.textColor}`,
      cat.borderColor ? `border:0.5px solid ${cat.borderColor}` : "",
      "font-family:-apple-system,BlinkMacSystemFont,sans-serif"
    ].filter(Boolean).join(";");

    badge.textContent = cat.label;
    if (result.rewrite) badge.title = `Better headline: ${result.rewrite}`;
    badge.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); showDetail(a, result); });

    a.dataset.cbdProcessed = "1";
    a.insertAdjacentElement("afterend", badge);
    recordStat(result.classification);
    chrome.runtime.sendMessage({ type: "BADGE_SHOWN", url: a.href, headline: a.textContent.trim(), classification: result.classification }).catch(() => {});
  });
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function showDetail(anchor, result) {
  document.querySelectorAll(".cbd-detail").forEach(el => el.remove());
  const cat = CATEGORIES[result.classification];

  const panel = document.createElement("div");
  panel.className = "cbd-detail";
  panel.style.cssText = "position:absolute;z-index:999999;max-width:340px;background:#fff;border:0.5px solid #ccc;border-radius:8px;padding:12px;font-size:12px;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.12);color:#333;";

  panel.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px;font-size:13px;">${cat.label}</div>
    ${result.reason    ? `<div style="margin-bottom:6px;color:#555;">${escHtml(result.reason)}</div>` : ""}
    ${result.rewrite   ? `<div style="margin-bottom:4px;"><strong>Better headline:</strong><br>${escHtml(result.rewrite)}</div>` : ""}
    ${result.gapAnalysis ? `<div style="margin-top:6px;font-size:11px;color:#777;border-top:1px solid #eee;padding-top:6px;">${escHtml(result.gapAnalysis)}</div>` : ""}
    <div style="text-align:right;margin-top:8px;"><a href="#" class="cbd-close" style="font-size:11px;color:#999;text-decoration:none;">close</a></div>
  `;

  panel.querySelector(".cbd-close").addEventListener("click", e => { e.preventDefault(); panel.remove(); });

  const rect = anchor.getBoundingClientRect();
  panel.style.top  = `${window.scrollY + rect.bottom + 4}px`;
  panel.style.left = `${Math.min(window.scrollX + rect.left, window.innerWidth - 360)}px`;
  document.body.appendChild(panel);
  setTimeout(() => document.addEventListener("click", () => panel.remove(), { once: true }), 10);
}

// ─── Queue + worker ───────────────────────────────────────────────────────────

function enqueue(a) {
  const url = a.href;
  if (evaluated.has(url)) return;
  evaluated.add(url);
  // Log both detection and queuing to the debug log via service worker
  chrome.runtime.sendMessage({ type: "LINK_QUEUED", url, headline: a.textContent.trim() }).catch(() => {});
  queue.push({ url, headline: a.textContent.trim(), anchor: a });
  drain();
}

function drain() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift();
    running++;
    evaluate(item).finally(() => { running--; drain(); });
  }
}

async function evaluate({ url, headline, anchor }) {
  try {
    const result = await chrome.runtime.sendMessage({ type: "EVALUATE_LINK", url, headline });
    if (result && !result.error) injectBadge(anchor, result);
  } catch (_) {}
}

// ─── IntersectionObserver + hover ────────────────────────────────────────────

const observer = new IntersectionObserver(
  entries => entries.forEach(e => { if (e.isIntersecting) { observer.unobserve(e.target); enqueue(e.target); } }),
  { rootMargin: "200px" }
);

function attachHover(a) {
  let timer;
  a.addEventListener("mouseenter", () => { timer = setTimeout(() => enqueue(a), HOVER_DELAY_MS); });
  a.addEventListener("mouseleave", () => clearTimeout(timer));
}

// ─── DOM scanning ─────────────────────────────────────────────────────────────

function scanLinks() {
  document.querySelectorAll("a[href]").forEach(a => {
    if (!isHeadlineLink(a)) return;
    observer.observe(a);
    attachHover(a);
  });
}

scanLinks();

// Handle popup asking for current stats
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_PAGE_STATS") sendResponse(pageStats);
});

// Watch for dynamically loaded content (Reddit infinite scroll, HN lazy loading, etc.)
new MutationObserver(() => scanLinks()).observe(document.body, { childList: true, subtree: true });
