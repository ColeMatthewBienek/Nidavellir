from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field, field_validator


class SkillScope(str, Enum):
    GLOBAL = "global"
    PROJECT = "project"
    REPO = "repo"
    CONVERSATION = "conversation"
    AGENT_ROLE = "agent_role"


class SkillTriggerType(str, Enum):
    KEYWORD = "keyword"
    FILE_PATTERN = "file_pattern"
    REPO = "repo"
    AGENT_ROLE = "agent_role"
    CONVERSATION_CONTEXT = "conversation_context"
    EXPLICIT_USER_REQUEST = "explicit_user_request"
    INTENT = "intent"


class SkillActivationMode(str, Enum):
    AUTOMATIC = "automatic"
    MANUAL = "manual"
    EXPLICIT_ONLY = "explicit_only"


class SkillSourceFormat(str, Enum):
    NATIVE = "native"
    CLAUDE_SKILL = "claude_skill"
    MARKDOWN = "markdown"
    IMPORTED_REPO = "imported_repo"


class SkillTrustStatus(str, Enum):
    UNTRUSTED = "untrusted"
    REVIEWED = "reviewed"
    TRUSTED = "trusted"
    DISABLED = "disabled"
    FAILED_IMPORT = "failed_import"


class SkillStatus(str, Enum):
    DRAFT = "draft"
    VALIDATED = "validated"
    FAILED_IMPORT = "failed_import"


class SkillTrigger(BaseModel):
    type: SkillTriggerType
    value: str
    weight: float = Field(default=1.0, ge=0.0, le=10.0)

    @field_validator("value")
    @classmethod
    def value_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("trigger value is required")
        return value


class SkillInstructions(BaseModel):
    core: str
    constraints: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)
    examples: list[dict] = Field(default_factory=list)
    anti_patterns: list[str] = Field(default_factory=list)

    @field_validator("core")
    @classmethod
    def core_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("core instructions are required")
        return value


class SkillCapabilityRequirements(BaseModel):
    file_read: bool = False
    file_write: bool = False
    shell: bool = False
    browser: bool = False
    vision: bool = False
    code_execution: bool = False
    network: bool = False
    long_context: bool = False


class SkillSource(BaseModel):
    format: SkillSourceFormat
    origin: str | None = None
    source_type: str | None = None
    import_path: str | None = None
    repository_url: str | None = None
    package_id: str | None = None
    package_name: str | None = None
    package_version: str | None = None
    package_scope: str | None = None
    trust_status: SkillTrustStatus = SkillTrustStatus.UNTRUSTED
    imported_at: str | None = None


class NidavellirSkill(BaseModel):
    id: str
    slug: str
    name: str
    description: str = ""
    scope: SkillScope = SkillScope.GLOBAL
    activation_mode: SkillActivationMode = SkillActivationMode.AUTOMATIC
    triggers: list[SkillTrigger] = Field(default_factory=list)
    instructions: SkillInstructions
    required_capabilities: SkillCapabilityRequirements = Field(default_factory=SkillCapabilityRequirements)
    priority: int = Field(default=50, ge=0, le=100)
    enabled: bool = False
    show_in_slash: bool = False
    version: int = Field(default=1, ge=1)
    status: SkillStatus = SkillStatus.DRAFT
    source: SkillSource
    created_at: str | None = None
    updated_at: str | None = None

    @field_validator("id", "slug", "name")
    @classmethod
    def required_text_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("required text field is blank")
        return value


class SkillTaskContext(BaseModel):
    conversation_id: str | None = None
    session_id: str | None = None
    user_message: str
    project_id: str | None = None
    repo_path: str | None = None
    selected_files: list[str] = Field(default_factory=list)
    provider: str
    model: str | None = None
