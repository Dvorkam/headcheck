// Single source of truth for the evaluation prompt and response schema.
// bench/eval/runner.py mirrors both — keep them in sync manually.
// The response is grammar-constrained via response_format json_schema
// (llama-server enforces it), so parse failures should not occur.

import { VALID_TOKENS } from "./categories.js";

export const SYSTEM_PROMPT = `You are a headline accuracy evaluator. Assess whether a news or article headline fairly represents the actual content of the article. Headlines and articles may be in English or Czech; always answer in the language of the headline.

You will be given:
- HEADLINE: the title shown to readers before clicking
- BODY: the first part of the actual article

Classify the headline as exactly one of:
- RAGEBAIT: designed to enrage the reader; the article does not support the outrage the headline manufactures
- CLICKBAIT: intentionally provocative oversell — the article exists but is far tamer or thinner than the headline implies
- INACCURATE: slightly misleading; the framing, emphasis, or a withheld detail distorts what the article actually says
- ACCURATE: the headline represents the article fairly
- UNDERDELIVERS: the headline undersells an article that is genuinely more interesting or significant than it sounds

Respond with a JSON object with these fields, in this order:
- reader_expectation: what a typical reader would expect from the headline alone — be specific about implied scale, subject, or drama
- article_reality: what the article actually describes, noting key facts that differ from that expectation
- gap_analysis: the most important information missing or misrepresented in the headline, and whether the omission looks deliberate
- classification: one of the category tokens above
- reason: one sentence explaining the classification
- rewrite: a replacement headline that is accurate, specific, and still engaging — name the actual subject, no vague language`;

// JSON schema enforced server-side. Field order matters: the reasoning
// fields precede classification so the model commits to analysis first.
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reader_expectation: { type: "string" },
    article_reality: { type: "string" },
    gap_analysis: { type: "string" },
    classification: { enum: VALID_TOKENS },
    reason: { type: "string" },
    rewrite: { type: "string" }
  },
  required: ["reader_expectation", "article_reality", "gap_analysis", "classification", "reason", "rewrite"],
  additionalProperties: false
};

/**
 * Build the user message for a given headline + article body.
 * Truncates body to ~500 tokens (~2000 chars) — enough context, cheap to run.
 */
export function buildUserMessage(headline, body) {
  const truncated = body.length > 2000 ? body.slice(0, 2000) + "…" : body;
  return `HEADLINE: ${headline}\n\nBODY:\n${truncated}`;
}

/**
 * Parse LLM output into structured fields.
 * Lenient: tolerates text around the JSON object (thinking remnants, fences).
 * Returns null if no valid JSON with a recognised classification is found.
 */
export function parseResponse(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let obj;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch (_) {
    return null;
  }

  const classification = String(obj.classification || "").toUpperCase();
  if (!VALID_TOKENS.includes(classification)) return null;

  return {
    readerExpectation: obj.reader_expectation ?? null,
    articleReality: obj.article_reality ?? null,
    gapAnalysis: obj.gap_analysis ?? null,
    classification,
    reason: obj.reason ?? null,
    rewrite: obj.rewrite ?? null,
    raw
  };
}
