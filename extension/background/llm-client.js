// OpenAI-compatible chat client — works against llama.cpp llama-server
// (see server/ scripts), and equally LM Studio / Ollama / KoboldCPP.
// Responses are grammar-constrained via response_format json_schema.

import { RESPONSE_SCHEMA } from "../shared/prompt.js";

const DEFAULT_ENDPOINT = "http://localhost:5001";

export async function getEndpoint() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ serverEndpoint: DEFAULT_ENDPOINT }, r =>
      resolve(r.serverEndpoint.replace(/\/$/, ""))
    );
  });
}

export async function callLLM(systemPrompt, userMessage) {
  const endpoint = await getEndpoint();

  const res = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "headcheck",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      max_tokens: 600,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name: "headline_verdict", strict: true, schema: RESPONSE_SCHEMA }
      }
    })
  });

  if (!res.ok) throw new Error(`LLM server error: HTTP ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

/**
 * Health check via the standard models endpoint.
 * Returns { ok, model } — model is the served model id when available.
 */
export async function checkServer() {
  const endpoint = await getEndpoint();
  try {
    const res = await fetch(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false, model: null };
    const data = await res.json();
    return { ok: true, model: data.data?.[0]?.id ?? null };
  } catch (_) {
    return { ok: false, model: null };
  }
}
