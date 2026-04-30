from __future__ import annotations

from pydantic import BaseModel, Field


class ProjectInstruction(BaseModel):
    name: str
    path: str
    content: str
    scope: str
    token_estimate: int
    metadata: dict = Field(default_factory=dict)


class ProjectInstructionSuppression(BaseModel):
    name: str
    path: str
    scope: str
    reason: str
    duplicate_of: str | None = None
    metadata: dict = Field(default_factory=dict)


class ProjectInstructionDiscoveryResult(BaseModel):
    instructions: list[ProjectInstruction]
    discovered: list[ProjectInstruction] = Field(default_factory=list)
    suppressed: list[ProjectInstructionSuppression] = Field(default_factory=list)
    rendered_text: str
    token_estimate: int
    provider: str | None = None
