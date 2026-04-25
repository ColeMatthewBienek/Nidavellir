from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, TYPE_CHECKING

if TYPE_CHECKING:
    from nidavellir.agents.base import CLIAgent

ProviderRole = Literal["planner", "em_reviewer", "executor", "chat", "qa_reviewer"]
CostTier     = Literal["local", "subscription", "api_metered", "free"]
LatencyTier  = Literal["low", "medium", "high"]
OutputFormat = Literal["ansi_rich", "ansi_simple", "markdown", "plain"]


@dataclass(frozen=True)
class ProviderManifest:
    # ── Identity ──────────────────────────────────────────────────────────────
    id:           str
    display_name: str
    binary:       str
    description:  str
    agent_class:  type  # type[CLIAgent] — untyped to avoid circular import

    # ── Roles ─────────────────────────────────────────────────────────────────
    roles: list[ProviderRole] = field(default_factory=list)

    # ── Session & Continuity ──────────────────────────────────────────────────
    supports_session_resume:     bool = False
    supports_persistent_context: bool = True

    # ── Input Capabilities ────────────────────────────────────────────────────
    supports_multiline_input: bool = True
    supports_file_context:    bool = False
    supports_image_input:     bool = False

    # ── Output & Streaming ────────────────────────────────────────────────────
    supports_interrupt:    bool         = True
    streams_incrementally: bool         = True
    emits_tool_use_blocks: bool         = False
    output_format:         OutputFormat = "plain"

    # ── Execution & Safety ────────────────────────────────────────────────────
    supports_bash_execution:    bool      = False
    supports_file_write:        bool      = False
    supports_worktree_isolation: bool     = False
    extra_flags:                list[str] = field(default_factory=list)

    # ── Cost & Resources ──────────────────────────────────────────────────────
    cost_tier:        CostTier    = "subscription"
    requires_network: bool        = True
    latency_tier:     LatencyTier = "medium"

    # ── Orchestration / Pool ──────────────────────────────────────────────────
    supports_parallel_slots: bool       = True
    max_concurrent_slots:    int | None = None

    def is_available(self) -> bool:
        return shutil.which(self.binary) is not None

    def to_api_dict(self) -> dict:
        return {
            "id":                          self.id,
            "display_name":                self.display_name,
            "description":                 self.description,
            "available":                   self.is_available(),
            "roles":                       list(self.roles),
            "supports_session_resume":     self.supports_session_resume,
            "supports_persistent_context": self.supports_persistent_context,
            "supports_multiline_input":    self.supports_multiline_input,
            "supports_file_context":       self.supports_file_context,
            "supports_image_input":        self.supports_image_input,
            "supports_interrupt":          self.supports_interrupt,
            "streams_incrementally":       self.streams_incrementally,
            "emits_tool_use_blocks":       self.emits_tool_use_blocks,
            "output_format":               self.output_format,
            "supports_bash_execution":     self.supports_bash_execution,
            "supports_file_write":         self.supports_file_write,
            "supports_worktree_isolation": self.supports_worktree_isolation,
            "cost_tier":                   self.cost_tier,
            "requires_network":            self.requires_network,
            "latency_tier":                self.latency_tier,
            "supports_parallel_slots":     self.supports_parallel_slots,
            "max_concurrent_slots":        self.max_concurrent_slots,
        }


def _build_registry() -> dict[str, ProviderManifest]:
    from nidavellir.agents.claude_agent import ClaudeAgent
    from nidavellir.agents.codex_agent import CodexAgent
    from nidavellir.agents.gemini_agent import GeminiAgent
    from nidavellir.agents.ollama_cli_agent import OllamaCliAgent

    return {
        m.id: m for m in [
            ProviderManifest(
                id="claude",
                display_name="Claude Code",
                binary="claude",
                description="Anthropic Claude Code CLI — autonomous coding agent with "
                            "full tool use, session resume, and vision input.",
                agent_class=ClaudeAgent,
                roles=["planner", "em_reviewer", "executor", "chat", "qa_reviewer"],
                supports_session_resume=True,
                supports_persistent_context=True,
                supports_multiline_input=True,
                supports_file_context=True,
                supports_image_input=True,
                supports_interrupt=True,
                streams_incrementally=True,
                emits_tool_use_blocks=True,
                output_format="ansi_rich",
                supports_bash_execution=True,
                supports_file_write=True,
                supports_worktree_isolation=True,
                extra_flags=["--dangerously-skip-permissions"],
                cost_tier="subscription",
                requires_network=True,
                latency_tier="medium",
                supports_parallel_slots=True,
                max_concurrent_slots=None,
            ),
            ProviderManifest(
                id="codex",
                display_name="Codex CLI",
                binary="codex",
                description="OpenAI Codex CLI — code-focused agent with diff-style "
                            "output and file operations.",
                agent_class=CodexAgent,
                roles=["executor", "chat", "qa_reviewer"],
                supports_session_resume=False,
                supports_persistent_context=True,
                supports_multiline_input=True,
                supports_file_context=True,
                supports_image_input=False,
                supports_interrupt=True,
                streams_incrementally=True,
                emits_tool_use_blocks=False,
                output_format="ansi_simple",
                supports_bash_execution=True,
                supports_file_write=True,
                supports_worktree_isolation=True,
                extra_flags=[],
                cost_tier="subscription",
                requires_network=True,
                latency_tier="medium",
                supports_parallel_slots=True,
                max_concurrent_slots=None,
            ),
            ProviderManifest(
                id="gemini",
                display_name="Gemini CLI",
                binary="gemini",
                description="Google Gemini CLI — large context window, markdown-heavy "
                            "output, strong at review and analysis tasks.",
                agent_class=GeminiAgent,
                roles=["executor", "chat", "qa_reviewer"],
                supports_session_resume=False,
                supports_persistent_context=True,
                supports_multiline_input=True,
                supports_file_context=True,
                supports_image_input=True,
                supports_interrupt=True,
                streams_incrementally=True,
                emits_tool_use_blocks=False,
                output_format="markdown",
                supports_bash_execution=True,
                supports_file_write=True,
                supports_worktree_isolation=True,
                extra_flags=[],
                cost_tier="subscription",
                requires_network=True,
                latency_tier="medium",
                supports_parallel_slots=True,
                max_concurrent_slots=None,
            ),
            ProviderManifest(
                id="ollama",
                display_name="Ollama (Qwen)",
                binary="ollama",
                description="Local Ollama — runs qwen3-coder:30b on local GPU. "
                            "Fast, free, no network required. Best for boilerplate "
                            "and low-complexity tasks.",
                agent_class=OllamaCliAgent,
                roles=["executor", "chat"],
                supports_session_resume=False,
                supports_persistent_context=True,
                supports_multiline_input=True,
                supports_file_context=False,
                supports_image_input=False,
                supports_interrupt=True,
                streams_incrementally=True,
                emits_tool_use_blocks=False,
                output_format="plain",
                supports_bash_execution=False,
                supports_file_write=False,
                supports_worktree_isolation=False,
                extra_flags=[],
                cost_tier="local",
                requires_network=False,
                latency_tier="low",
                supports_parallel_slots=False,
                max_concurrent_slots=1,
            ),
        ]
    }


PROVIDER_REGISTRY: dict[str, ProviderManifest] = _build_registry()
VALID_PROVIDERS:   list[str]                    = list(PROVIDER_REGISTRY.keys())


def make_agent(provider_type: str, slot_id: int, workdir: Path) -> "CLIAgent":
    manifest = PROVIDER_REGISTRY.get(provider_type)
    if manifest is None:
        raise ValueError(
            f"Unknown provider: {provider_type!r}. Valid: {VALID_PROVIDERS}"
        )
    return manifest.agent_class(slot_id=slot_id, workdir=workdir)
