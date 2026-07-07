// Shared category definitions — the single source of truth for the taxonomy.
// Mirrored in: content/scanner.js (inlined — MV3 content scripts can't import),
// popup/popup.js, bench/eval/runner.py, bench/eval/compare.py.
// This taxonomy feeds the training corpus (see .claude/Plan/01) — changing it
// after labeling starts means relabeling.

export const CATEGORIES = {
  RAGEBAIT: {
    label: "Ragebait",
    color: "#FCEBEB",
    textColor: "#A32D2D",
    description: "Designed to enrage; the article does not support the outrage",
    severity: 4
  },
  CLICKBAIT: {
    label: "Clickbait",
    color: "#FAEEDA",
    textColor: "#854F0B",
    description: "Intentionally provocative oversell of the actual content",
    severity: 3
  },
  INACCURATE: {
    label: "Inaccurate",
    color: "#FCF7DE",
    textColor: "#8A6D1D",
    description: "Slightly misleading; framing or emphasis distorts the article",
    severity: 2
  },
  UNDERDELIVERS: {
    label: "Underdelivers",
    color: "#F1EFE8",
    textColor: "#888780",
    borderColor: "#B4B2A9",
    description: "Headline undersells a genuinely interesting article",
    severity: 1
  },
  ACCURATE: {
    label: "Accurate",
    color: "#EAF3DE",
    textColor: "#3B6D11",
    description: "Headline represents the article fairly",
    severity: 0
  }
};

// Only show badge if severity >= this threshold.
// Change in options to reduce noise.
export const DEFAULT_SEVERITY_THRESHOLD = 2;

// Category tokens the LLM is expected to output.
export const VALID_TOKENS = Object.keys(CATEGORIES);
