import { callKobold, isKoboldReachable } from "./kobold.js";
import { SYSTEM_PROMPT, buildUserMessage, parseResponse } from "../shared/prompt.js";
import { logEvent, getLog, clearLog } from "./logger.js";

const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

// ─── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "EVALUATE_LINK") {
    handleEvaluate(msg.url, msg.headline, sender.tab?.id)
      .then(sendResponse)
      .catch(err => {
        logEvent("llm_error", msg.url, msg.headline, err.message);
        sendResponse({ error: err.message });
      });
    return true;
  }

  if (msg.type === "CHECK_KOBOLD") {
    isKoboldReachable().then(ok => sendResponse({ ok }));
    return true;
  }

  if (msg.type === "LINK_DETECTED") {
    logEvent("detected", msg.url, msg.headline).then(() => sendResponse({}));
    return true;
  }

  if (msg.type === "LINK_QUEUED") {
    logEvent("queued", msg.url, msg.headline).then(() => sendResponse({}));
    return true;
  }

  if (msg.type === "BADGE_SHOWN") {
    logEvent("badge_shown", msg.url, msg.headline, `classification: ${msg.classification}`).then(() => sendResponse({}));
    return true;
  }

  if (msg.type === "BADGE_SKIP") {
    logEvent("badge_skip", msg.url, msg.headline, `below threshold: ${msg.classification}`).then(() => sendResponse({}));
    return true;
  }

  if (msg.type === "GET_DEBUG_LOG") {
    getLog().then(log => sendResponse({ log }));
    return true;
  }

  if (msg.type === "CLEAR_DEBUG_LOG") {
    clearLog().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function handleEvaluate(url, headline, tabId) {
  const cached = await getCached(url);
  if (cached) {
    await logEvent("cache_hit", url, headline, `classification: ${cached.classification}`);
    return { ...cached, fromCache: true };
  }

  // Fetch article
  let body;
  try {
    body = await fetchArticleBody(url, tabId);
    await logEvent("fetch_ok", url, headline, body ? body.slice(0, 400) : "(empty)");
  } catch (err) {
    await logEvent("fetch_error", url, headline, err.message);
    return { error: `Fetch failed: ${err.message}` };
  }

  if (!body || body.length < 100) {
    await logEvent("fetch_error", url, headline, "Body too short or empty");
    return { error: "Could not extract article content" };
  }

  // LLM call
  const userMessage = buildUserMessage(headline, body);
  await logEvent("llm_input", url, headline, userMessage);

  let raw;
  try {
    raw = await callKobold(SYSTEM_PROMPT, userMessage);
    await logEvent("llm_output", url, headline, raw);
  } catch (err) {
    await logEvent("llm_error", url, headline, err.message);
    return { error: `KoboldCPP error: ${err.message}` };
  }

  // Parse
  const parsed = parseResponse(raw);
  if (!parsed) {
    await logEvent("parse_fail", url, headline, `Raw output: ${raw.slice(0, 500)}`);
    return { error: "Could not parse LLM response", raw };
  }

  await logEvent("parse_ok", url, headline, `classification: ${parsed.classification}`);
  await setCached(url, parsed);
  return parsed;
}

// ─── Article fetching ─────────────────────────────────────────────────────────

async function fetchArticleBody(url, tabId) {
  const u = new URL(url);
  if (u.hostname.includes("reddit.com")) return fetchRedditBody(u);

  const cookies = await getSessionCookies(u.hostname);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; clickbait-detector/0.1)",
      ...(cookies ? { Cookie: cookies } : {})
    }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return extractBody(html, url);
}

async function fetchRedditBody(u) {
  const jsonUrl = u.origin + u.pathname.replace(/\/?$/, ".json") + "?limit=1";
  const cookies = await getSessionCookies("reddit.com");

  const res = await fetch(jsonUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "clickbait-detector/0.1",
      ...(cookies ? { Cookie: cookies } : {})
    }
  });

  if (!res.ok) throw new Error(`Reddit API ${res.status}`);
  const data = await res.json();
  const post = data[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error("Unexpected Reddit JSON shape");

  if (post.selftext && post.selftext.length > 80) return post.selftext.slice(0, 2000);
  if (post.url && !post.url.includes("reddit.com")) return fetchArticleBody(post.url, null);
  return post.selftext || post.title;
}

// ─── Body extraction ──────────────────────────────────────────────────────────

function extractBody(html, sourceUrl) {
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{80,})["']/i)
    || html.match(/<meta[^>]+content=["']([^"']{80,})["'][^>]+name=["']description["']/i);

  const bodyMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

  let articleText = "";
  if (bodyMatch) articleText = stripTags(bodyMatch[1]).slice(0, 2000);

  const desc = descMatch ? stripTags(descMatch[1]) : "";
  const combined = [desc, articleText].filter(Boolean).join("\n\n");
  return combined.length > 80 ? combined : null;
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s{2,}/g, " ").trim();
}

// ─── Cookie helper ────────────────────────────────────────────────────────────

async function getSessionCookies(hostname) {
  try {
    const domain = hostname.replace(/^www\./, "");
    const cookies = await chrome.cookies.getAll({ domain });
    if (!cookies.length) return null;
    return cookies.map(c => `${c.name}=${c.value}`).join("; ");
  } catch (_) { return null; }
}

// ─── Cache ────────────────────────────────────────────────────────────────────

async function getCached(url) {
  const key = `cache:${url}`;
  return new Promise(resolve => {
    chrome.storage.local.get(key, r => {
      const entry = r[key];
      if (!entry || Date.now() - entry.ts > CACHE_TTL_MS) return resolve(null);
      resolve(entry.data);
    });
  });
}

async function setCached(url, data) {
  const key = `cache:${url}`;
  return new Promise(resolve => chrome.storage.local.set({ [key]: { ts: Date.now(), data } }, resolve));
}
