from __future__ import annotations

from pydantic import BaseModel, Field


class ProjectInstruction(BaseModel):
    name: str
    path: str
    content: str
    scope: str
    token_estimate: int
    metadata: dict = Field(default_factory=dict)


class ProjectInstructionDiscoveryResult(BaseModel):
    instructions: list[ProjectInstruction]
    rendered_text: str
    token_estimate: int
