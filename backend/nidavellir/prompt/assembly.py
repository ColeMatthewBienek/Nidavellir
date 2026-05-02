from __future__ import annotations

from .models import PromptAssemblyResult, PromptSection

SECTION_ORDER = [
    "system/app instructions",
    "provider/tool instructions",
    "project instructions",
    "conversation/session context",
    "handoff seed",
    "memory retrieval",
    "command output attachments",
    "activated skills",
    "working set files",
    "recent messages",
    "user message",
]


def _section_key(name: str) -> str:
    return " ".join(name.strip().lower().split())


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4) if text.strip() else 0


def assemble_prompt(sections: list[PromptSection]) -> PromptAssemblyResult:
    indexed_order = {name: index for index, name in enumerate(SECTION_ORDER)}
    filtered = [section for section in sections if section.content.strip()]
    ordered = sorted(
        enumerate(filtered),
        key=lambda pair: (indexed_order.get(_section_key(pair[1].name), len(SECTION_ORDER)), pair[0]),
    )
    rendered_sections = [section for _, section in ordered]

    parts: list[str] = []
    injected: list[str] = []
    suppressed: list[str] = []
    token_total = 0
    for section in rendered_sections:
        title = section.name.strip().title()
        parts.append(f"## {title}\n\n{section.content.strip()}")
        if section.token_estimate is not None:
            token_total += section.token_estimate
        else:
            token_total += _estimate_tokens(section.content)
        injected.extend(str(s) for s in section.metadata.get("injected_skill_ids", []) if s)
        suppressed.extend(str(s) for s in section.metadata.get("suppressed_skill_ids", []) if s)

    return PromptAssemblyResult(
        sections=rendered_sections,
        rendered_text="\n\n".join(parts).strip(),
        injected_skill_ids=injected,
        suppressed_skill_ids=suppressed,
        estimated_tokens=token_total,
    )
