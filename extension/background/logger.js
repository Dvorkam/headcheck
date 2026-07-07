// Debug logger — stores evaluation events in chrome.storage.session.
// session storage is cleared on browser close, so no persistent clutter.
// Max LOG_LIMIT entries, rotating (oldest dropped first).
//
// Entry shape:
// {
//   id: number,
//   ts: ISO string,
//   type: "detected"|"queued"|"fetch_ok"|"fetch_error"|"llm_input"|"llm_output"|"llm_error"|"parse_ok"|"parse_fail"|"badge_shown"|"badge_skip"|"cache_hit",
//   url: string,
//   headline: string,
//   detail: string   (truncated body, raw LLM input/output, error message, etc.)
// }

const LOG_KEY = "cbd_debug_log";
const LOG_LIMIT = 300;

export async function logEvent(type, url, headline, detail = "") {
  return new Promise(resolve => {
    const storage = chrome.storage.local;
    storage.get(LOG_KEY, r => {
      const log = r[LOG_KEY] || [];
      log.push({
        id: Date.now() + Math.random(),
        ts: new Date().toISOString(),
        type,
        url: url || "",
        headline: (headline || "").slice(0, 120),
        detail: (detail || "").slice(0, 2000)
      });
      // Rotate
      if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
      storage.set({ [LOG_KEY]: log }, resolve);
    });
  });
}

export async function getLog() {
  return new Promise(resolve => {
    chrome.storage.local.get(LOG_KEY, r => resolve(r[LOG_KEY] || []));
  });
}

export async function clearLog() {
  return new Promise(resolve => {
    chrome.storage.local.remove(LOG_KEY, resolve);
  });
}
