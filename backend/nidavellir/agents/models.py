from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass, replace
from typing import Literal

CostTier = Literal["local", "subscription", "api_metered", "free"]


@dataclass(frozen=True)
class AgentModelDef:
    id:           str       # globally unique: "{provider_id}:{model_id}"
    provider_id:  str       # "claude" | "codex" | "ollama"
    model_id:     str       # value passed to the CLI --model flag
    display_name: str       # human-readable label shown in UI
    description:  str       # one-line description for tooltip / settings
    cost_tier:    CostTier  # "local" | "subscription" | ...
    available:    bool = False  # set at runtime by list_agent_models()

    def to_dict(self) -> dict:
        return {
            "id":           self.id,
            "provider_id":  self.provider_id,
            "model_id":     self.model_id,
            "display_name": self.display_name,
            "description":  self.description,
            "cost_tier":    self.cost_tier,
            "available":    self.available,
        }


# ── Claude models ─────────────────────────────────────────────────────────────
# Models are listed newest/most-capable first.
# display_name uses the Anthropic tier convention (Opus → Sonnet → Haiku).

CLAUDE_MODELS: list[AgentModelDef] = [
    AgentModelDef(
        id="claude:claude-opus-4-5",
        provider_id="claude",
        model_id="claude-opus-4-5",
        display_name="Claude Opus 4.5",
        description="Most capable Claude model. Best for complex planning and reasoning.",
        cost_tier="subscription",
    ),
    AgentModelDef(
        id="claude:claude-sonnet-4-6",
        provider_id="claude",
        model_id="claude-sonnet-4-6",
        display_name="Claude Sonnet 4.6",
        description="Balanced capability and speed. Best general-purpose coding agent.",
        cost_tier="subscription",
    ),
    AgentModelDef(
        id="claude:claude-haiku-4-5",
        provider_id="claude",
        model_id="claude-haiku-4-5",
        display_name="Claude Haiku 4.5",
        description="Fast and efficient. Best for quick edits and boilerplate tasks.",
        cost_tier="subscription",
    ),
]

# ── Codex models ──────────────────────────────────────────────────────────────
# Verified against `codex debug models` — these slugs work with ChatGPT accounts.
# o4-mini / o3 are API-key-only and return HTTP 400 for ChatGPT account users.

CODEX_MODELS: list[AgentModelDef] = [
    AgentModelDef(
        id="codex:gpt-5.4",
        provider_id="codex",
        model_id="gpt-5.4",
        display_name="GPT-5.4",
        description="Codex default — most capable model for complex coding tasks.",
        cost_tier="subscription",
    ),
    AgentModelDef(
        id="codex:gpt-5.4-mini",
        provider_id="codex",
        model_id="gpt-5.4-mini",
        display_name="GPT-5.4 Mini",
        description="Faster, lighter GPT-5.4 variant. Best for quick edits and boilerplate.",
        cost_tier="subscription",
    ),
    AgentModelDef(
        id="codex:gpt-5.3-codex",
        provider_id="codex",
        model_id="gpt-5.3-codex",
        display_name="GPT-5.3 Codex",
        description="Previous-generation coding model. Stable and well-tested.",
        cost_tier="subscription",
    ),
]


# ── Ollama helpers ────────────────────────────────────────────────────────────

def _parse_ollama_list(output: str) -> list[str]:
    """Parse `ollama list` stdout and return model names, excluding embedding models."""
    lines = output.strip().split("\n")
    if len(lines) < 2:
        return []
    models: list[str] = []
    for line in lines[1:]:  # skip header row
        parts = line.split()
        if not parts:
            continue
        name = parts[0]
        if "embed" in name.lower():
            continue
        models.append(name)
    return models


def _get_ollama_models() -> list[str]:
    """Run `ollama list` and return model names. Returns [] on any failure."""
    try:
        result = subprocess.run(
            ["ollama", "list"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return _parse_ollama_list(result.stdout)
    except Exception:
        pass
    return []


# ── Public API ────────────────────────────────────────────────────────────────

def list_agent_models() -> list[AgentModelDef]:
    """
    Returns a flat list of all agent model definitions with availability set.

    - Claude / Codex: hardcoded known models; available = binary on PATH
    - Ollama: dynamically discovered via `ollama list`; available = installed
    """
    models: list[AgentModelDef] = []

    claude_ok = shutil.which("claude") is not None
    for m in CLAUDE_MODELS:
        models.append(replace(m, available=claude_ok))

    codex_ok = shutil.which("codex") is not None
    for m in CODEX_MODELS:
        models.append(replace(m, available=codex_ok))

    if shutil.which("ollama") is not None:
        for name in _get_ollama_models():
            models.append(AgentModelDef(
                id=f"ollama:{name}",
                provider_id="ollama",
                model_id=name,
                display_name=name,
                description=f"Local Ollama model running on GPU.",
                cost_tier="local",
                available=True,
            ))

    return models
