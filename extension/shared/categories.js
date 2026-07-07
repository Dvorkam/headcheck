// Shared category definitions — used by both the extension UI and the bench eval runner.
// Keep this file in sync with bench/eval/categories.py

export const CATEGORIES = {
  BLATANT_BAIT: {
    label: "Blatant bait",
    color: "#2C2C2A",
    textColor: "#D3D1C7",
    description: "No information, pure curiosity gap",
    severity: 5
  },
  RAGEBAIT: {
    label: "Ragebait",
    color: "#FCEBEB",
    textColor: "#A32D2D",
    description: "Accurate facts, engineered emotional framing",
    severity: 4
  },
  CLICKBAIT: {
    label: "Clickbait",
    color: "#FAEEDA",
    textColor: "#854F0B",
    description: "Information present but scale wildly overstated",
    severity: 3
  },
  MISLEADING: {
    label: "Misleading",
    color: "#F1EFE8",
    textColor: "#5F5E5A",
    borderColor: "#B4B2A9",
    description: "Technically accurate, key context withheld",
    severity: 2
  },
  ACCURATE: {
    label: "Accurate",
    color: "#EAF3DE",
    textColor: "#3B6D11",
    description: "Fair representation of article content",
    severity: 0
  },
  UNDERSELLS: {
    label: "Undersells",
    color: "#F1EFE8",
    textColor: "#888780",
    description: "Buries genuinely important information",
    severity: 1
  }
};

// Only show badge if severity >= this threshold.
// Change in options to reduce noise.
export const DEFAULT_SEVERITY_THRESHOLD = 2;

// Category tokens the LLM is expected to output.
// Order matters: parser tries these in sequence.
export const VALID_TOKENS = Object.keys(CATEGORIES);
