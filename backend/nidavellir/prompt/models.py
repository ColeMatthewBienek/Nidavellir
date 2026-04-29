from __future__ import annotations

from pydantic import BaseModel, Field


class PromptSection(BaseModel):
    name: str
    content: str
    source: str
    token_estimate: int | None = None
    metadata: dict = Field(default_factory=dict)


class PromptAssemblyResult(BaseModel):
    sections: list[PromptSection]
    rendered_text: str
    injected_skill_ids: list[str] = Field(default_factory=list)
    suppressed_skill_ids: list[str] = Field(default_factory=list)
    estimated_tokens: int | None = None
