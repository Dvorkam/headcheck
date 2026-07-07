// Popup script

const CATEGORIES = {
  BLATANT_BAIT: { label: "Blatant bait", color: "#2C2C2A", textColor: "#D3D1C7", barColor: "#2C2C2A" },
  RAGEBAIT:     { label: "Ragebait",     color: "#FCEBEB", textColor: "#A32D2D", barColor: "#E24B4A" },
  CLICKBAIT:    { label: "Clickbait",    color: "#FAEEDA", textColor: "#854F0B", barColor: "#EF9F27" },
  MISLEADING:   { label: "Misleading",   color: "#F1EFE8", textColor: "#5F5E5A", barColor: "#888780", borderColor: "#B4B2A9" },
  ACCURATE:     { label: "Accurate",     color: "#EAF3DE", textColor: "#3B6D11", barColor: "#97C459" },
  UNDERSELLS:   { label: "Undersells",   color: "#F1EFE8", textColor: "#888780", barColor: "#B4B2A9" }
};

// ─── Init ──────────────────────────────────────────────────────────────────

async function init() {
  // Current tab domain
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const domain = tab?.url ? new URL(tab.url).hostname.replace("www.", "") : "—";
  document.getElementById("page-domain").textContent = domain;

  // KoboldCPP status
  const { ok } = await chrome.runtime.sendMessage({ type: "CHECK_KOBOLD" });
  const dot = document.getElementById("status-dot");
  dot.classList.add(ok ? "ok" : "err");
  dot.title = ok ? "KoboldCPP connected" : "KoboldCPP unreachable — check Settings";

  // Site toggle state
  chrome.storage.sync.get({ disabledSites: [] }, r => {
    const toggle = document.getElementById("site-toggle");
    toggle.checked = !r.disabledSites.includes(domain);
    toggle.addEventListener("change", () => {
      chrome.storage.sync.get({ disabledSites: [] }, r2 => {
        const sites = new Set(r2.disabledSites);
        toggle.checked ? sites.delete(domain) : sites.add(domain);
        chrome.storage.sync.set({ disabledSites: [...sites] });
      });
    });
  });

  // Ask content script for current page stats
  if (tab?.id) {
    try {
      const stats = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_STATS" });
      renderStats(stats);
    } catch (_) {
      // Content script not injected on this page (e.g. new tab)
    }
  }
}

// ─── Stats rendering ───────────────────────────────────────────────────────

function renderStats(stats) {
  if (!stats || stats.total === 0) return;

  const container = document.getElementById("stats-rows");
  const total = stats.total;

  const order = ["BLATANT_BAIT", "RAGEBAIT", "CLICKBAIT", "MISLEADING", "ACCURATE", "UNDERSELLS"];
  const rows = order
    .filter(k => stats.byCategory[k])
    .map(k => {
      const cat = CATEGORIES[k];
      const count = stats.byCategory[k] || 0;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;

      return `
        <div class="cat-row">
          <span class="cat-badge" style="background:${cat.color};color:${cat.textColor};${cat.borderColor ? `border:0.5px solid ${cat.borderColor};` : ""}">${cat.label}</span>
          <div class="cat-bar-wrap">
            <div class="cat-bar" style="width:${pct}%;background:${cat.barColor};"></div>
          </div>
          <span class="cat-count">${count}</span>
        </div>
      `;
    });

  if (rows.length === 0) return;

  container.innerHTML = rows.join("") +
    `<div style="text-align:right;font-size:10px;color:#bbb;margin-top:6px;">${total} link${total !== 1 ? "s" : ""} evaluated</div>`;
}

// ─── Live updates from content script ─────────────────────────────────────

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === "PAGE_STATS") renderStats(msg.stats);
});

// ─── Footer buttons ────────────────────────────────────────────────────────

document.getElementById("btn-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

document.getElementById("btn-debug").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("debug/debug.html") });
  window.close();
});

document.getElementById("btn-clear").addEventListener("click", () => {
  chrome.storage.local.get(null, items => {
    const cacheKeys = Object.keys(items).filter(k => k.startsWith("cache:"));
    chrome.storage.local.remove(cacheKeys, () => {
      const btn = document.getElementById("btn-clear");
      btn.textContent = `Cleared ${cacheKeys.length}`;
      setTimeout(() => { btn.textContent = "Clear cache"; }, 1500);
    });
  });
});

init();
