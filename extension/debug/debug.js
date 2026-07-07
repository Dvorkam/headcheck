let allEntries = [];
let activeFilter = "all";

function setFilter(type) {
  activeFilter = type;
  document.querySelectorAll(".filter-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.type === type)
  );
  render();
}

function render() {
  const entries = activeFilter === "all"
    ? allEntries
    : allEntries.filter(e => e.type === activeFilter);

  const tbody = document.getElementById("tbody");
  const empty = document.getElementById("empty");
  const table = document.getElementById("table");
  const count = document.getElementById("count");

  count.textContent = `${allEntries.length} entries`;

  if (entries.length === 0) {
    empty.style.display = "";
    table.style.display = "none";
    empty.textContent = allEntries.length === 0
      ? "No log entries yet. Browse a page with the extension active."
      : `No entries matching filter "${activeFilter}".`;
    return;
  }

  empty.style.display = "none";
  table.style.display = "";

  tbody.innerHTML = [...entries].reverse().map(e => {
    const t = e.ts ? e.ts.slice(11, 19) : "";
    const hasDetail = e.detail && e.detail.trim().length > 0;
    const uid = `d_${String(e.id).replace(".", "_")}`;
    return `<tr>
      <td class="ts">${t}</td>
      <td><span class="type-badge t-${e.type}">${e.type}</span></td>
      <td>
        <div class="headline">${esc(e.headline)}</div>
        ${hasDetail ? `<span class="detail-toggle" data-target="${uid}">show detail</span><div class="detail-box" id="${uid}">${esc(e.detail)}</div>` : ""}
      </td>
      <td class="url-cell" title="${esc(e.url)}">${esc(shortUrl(e.url))}</td>
      <td></td>
    </tr>`;
  }).join("");
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shortUrl(url) {
  try { const u = new URL(url); return u.hostname + u.pathname.slice(0, 40); }
  catch { return url.slice(0, 60); }
}

function load() {
  chrome.runtime.sendMessage({ type: "GET_DEBUG_LOG" }, r => {
    if (r?.log) { allEntries = r.log; render(); }
  });
}

// ── Wire up static buttons ───────────────────────────────────────────────────

document.getElementById("btn-copy").addEventListener("click", e => {
  navigator.clipboard.writeText(JSON.stringify(allEntries, null, 2));
  e.target.textContent = "Copied!";
  setTimeout(() => { e.target.textContent = "Copy JSON"; }, 1500);
});

document.getElementById("btn-clear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_DEBUG_LOG" }, () => {
    allEntries = [];
    render();
  });
});

document.getElementById("filters").addEventListener("click", e => {
  const btn = e.target.closest(".filter-btn");
  if (btn) setFilter(btn.dataset.type);
});

// Event delegation for detail toggles (generated inside innerHTML)
document.getElementById("tbody").addEventListener("click", e => {
  const toggle = e.target.closest(".detail-toggle");
  if (!toggle) return;
  const box = document.getElementById(toggle.dataset.target);
  if (!box) return;
  box.classList.toggle("open");
  toggle.textContent = box.classList.contains("open") ? "hide detail" : "show detail";
});

// Auto-refresh every 2 seconds
load();
setInterval(load, 2000);
