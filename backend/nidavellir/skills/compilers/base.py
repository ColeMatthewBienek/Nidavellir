from __future__ import annotations

from pydantic import BaseModel, Field


class SkillCompileResult(BaseModel):
    prompt_fragment: str
    injected_skill_ids: list[str]
    suppressed: list[dict] = Field(default_factory=list)
    estimated_tokens: int
