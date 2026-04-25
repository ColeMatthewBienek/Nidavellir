// UI-only metadata for providers. Backend manifest handles capabilities.
// This file is the single source of truth for provider visual identity.

export interface ProviderTheme {
  color:        string;
  colorClass:   string;
  borderClass:  string;
  bgClass:      string;
  icon:         string;
  shortName:    string;
}

export const PROVIDER_THEME: Record<string, ProviderTheme> = {
  claude: {
    color:       "#d97706",
    colorClass:  "text-amber-500",
    borderClass: "border-amber-500/40",
    bgClass:     "bg-amber-500/10",
    icon:        "◆",
    shortName:   "Claude",
  },
  codex: {
    color:       "#3b82f6",
    colorClass:  "text-blue-400",
    borderClass: "border-blue-400/40",
    bgClass:     "bg-blue-400/10",
    icon:        "⬡",
    shortName:   "Codex",
  },
  gemini: {
    color:       "#8b5cf6",
    colorClass:  "text-violet-400",
    borderClass: "border-violet-400/40",
    bgClass:     "bg-violet-400/10",
    icon:        "✦",
    shortName:   "Gemini",
  },
  ollama: {
    color:       "#3fb950",
    colorClass:  "text-[#3fb950]",
    borderClass: "border-[#3fb950]/40",
    bgClass:     "bg-[#3fb950]/10",
    icon:        "⬢",
    shortName:   "Qwen",
  },
};

// Tier badge colors — used in Kanban, task cards, agent status
export const TIER_THEME: Record<string, { label: string; colorClass: string; borderClass: string }> = {
  qwen:   { label: "Qwen",   colorClass: "text-[#8b949e]",  borderClass: "border-[#30363d]" },
  haiku:  { label: "Haiku",  colorClass: "text-blue-400",   borderClass: "border-blue-500/40" },
  sonnet: { label: "Sonnet", colorClass: "text-green-400",  borderClass: "border-green-500/40" },
  opus:   { label: "Opus",   colorClass: "text-purple-400", borderClass: "border-purple-500/40" },
};

// Role badge display config
export const ROLE_THEME: Record<string, { label: string; colorClass: string }> = {
  planner:     { label: "Planner",    colorClass: "text-amber-400" },
  em_reviewer: { label: "EM Review",  colorClass: "text-violet-400" },
  executor:    { label: "Executor",   colorClass: "text-[#3fb950]" },
  chat:        { label: "Chat",       colorClass: "text-[#8b949e]" },
  qa_reviewer: { label: "QA Review", colorClass: "text-blue-400" },
};

export function getProviderTheme(id: string): ProviderTheme {
  return PROVIDER_THEME[id] ?? {
    color:       "#8b949e",
    colorClass:  "text-[#8b949e]",
    borderClass: "border-[#30363d]",
    bgClass:     "bg-[#21262d]",
    icon:        "?",
    shortName:   id,
  };
}
