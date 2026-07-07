// Single source of truth for the evaluation prompt.
// The bench runner imports a copy of this logic (bench/eval/prompt.py mirrors it).

export const SYSTEM_PROMPT = `You are a headline accuracy evaluator. Your job is to assess whether a news or article headline fairly represents the actual content of the article.

You will be given:
- HEADLINE: the title shown to readers before clicking
- BODY: the first few paragraphs of the actual article

Generate response in following format. Follow this structure exactly:

READER EXPECTATION: What would a typical reader expect to find, based on the headline alone? Be specific about implied scale, subject, or drama.

ARTICLE REALITY: What does the article actually describe? Note any key facts that differ from expectations.

GAP ANALYSIS: What is the most important information missing from or misrepresented in the headline? Is the omission likely deliberate?

CLASSIFICATION: One of: BLATANT_BAIT / RAGEBAIT / CLICKBAIT / MISLEADING / ACCURATE / UNDERSELLS

REASON: One sentence explaining the classification.

REWRITE: A replacement headline that is accurate, specific, and still engaging. Do not use vague language. Name the actual subject if relevant.`;

/**
 * Build the user message for a given headline + article body.
 * Truncates body to ~500 tokens (~2000 chars) — enough context, cheap to run.
 */
export function buildUserMessage(headline, body) {
  const truncated = body.length > 2000 ? body.slice(0, 2000) + "…" : body;
  return `HEADLINE: ${headline}\n\nBODY:\n${truncated}`;
}

/**
 * Parse raw LLM output into structured fields.
 * Returns null if the output does not contain a recognisable CLASSIFICATION line.
 */
export function parseResponse(raw) {
  const result = {
    readerExpectation: extract(raw, "READER EXPECTATION"),
    articleReality: extract(raw, "ARTICLE REALITY"),
    gapAnalysis: extract(raw, "GAP ANALYSIS"),
    classification: null,
    reason: extract(raw, "REASON"),
    rewrite: extract(raw, "REWRITE"),
    raw
  };

  // Robust classification extraction — handles spacing and lowercase variants
  const classMatch = raw.match(
    /CLASSIFICATION\s*:\s*(BLATANT_BAIT|RAGEBAIT|CLICKBAIT|MISLEADING|ACCURATE|UNDERSELLS)/i
  );
  if (classMatch) {
    result.classification = classMatch[1].toUpperCase();
  }

  return result.classification ? result : null;
}

function extract(text, field) {
  const pattern = new RegExp(`${field}\\s*:\\s*([\\s\\S]*?)(?=\\n[A-Z _]+:|$)`, "i");
  const m = text.match(pattern);
  return m ? m[1].trim() : null;
}
