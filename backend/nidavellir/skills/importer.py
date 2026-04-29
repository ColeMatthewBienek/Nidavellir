from __future__ import annotations

import re
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel

from .models import (
    NidavellirSkill,
    SkillActivationMode,
    SkillCapabilityRequirements,
    SkillInstructions,
    SkillSource,
    SkillSourceFormat,
    SkillStatus,
    SkillTrigger,
)
from .validator import validate_skill


class SkillImportResult(BaseModel):
    ok: bool
    import_id: str
    detected_format: Literal["native", "claude_skill", "markdown", "imported_repo"]
    skill: NidavellirSkill | None = None
    warnings: list[str] = []
    errors: list[str] = []


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or f"skill-{uuid.uuid4().hex[:8]}"


def _title_from_markdown(text: str, fallback: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip() or fallback
    return fallback


def _fail(fmt: str, error: str) -> SkillImportResult:
    return SkillImportResult(ok=False, import_id=str(uuid.uuid4()), detected_format=fmt, errors=[error])


def _resolve_import_path(path_value: str | Path) -> Path:
    raw = str(path_value)
    match = re.match(r"^([A-Za-z]):[\\/](.*)$", raw)
    if match:
        drive = match.group(1).lower()
        rest = match.group(2).replace("\\", "/")
        wsl_path = Path(f"/mnt/{drive}/{rest}")
        if wsl_path.exists():
            return wsl_path
    return Path(raw).expanduser()


def import_skill_from_path(path_value: str | Path) -> SkillImportResult:
    path = _resolve_import_path(path_value)
    try:
        if path.is_dir():
            yaml_path = path / "skill.yaml"
            skill_md = path / "SKILL.md"
            if yaml_path.exists():
                return _import_native(path, yaml_path, skill_md)
            if skill_md.exists():
                return _import_markdown(skill_md, SkillSourceFormat.CLAUDE_SKILL, fallback_name=path.name)
            return _fail("imported_repo", "Missing SKILL.md")
        if path.suffix.lower() == ".zip":
            return import_skill_from_zip(path)
        if path.suffix.lower() == ".md":
            return _import_markdown(path, SkillSourceFormat.MARKDOWN, fallback_name=path.stem)
        return _fail("markdown", "Unsupported skill path")
    except yaml.YAMLError as exc:
        return _fail("native", f"Malformed skill.yaml: {exc}")
    except Exception as exc:
        return _fail("markdown", str(exc))


def import_skill_from_markdown(markdown: str, *, name: str | None = None, origin: str = "pasted") -> SkillImportResult:
    try:
        fallback = name or "Pasted Skill"
        title = _title_from_markdown(markdown, fallback)
        slug = _slugify(title)
        skill = NidavellirSkill(
            id=slug,
            slug=slug,
            name=title,
            description="",
            activation_mode=SkillActivationMode.MANUAL,
            triggers=[],
            instructions=SkillInstructions(core=markdown),
            required_capabilities=SkillCapabilityRequirements(),
            enabled=False,
            status=SkillStatus.VALIDATED,
            source=SkillSource(format=SkillSourceFormat.MARKDOWN, origin=origin),
        )
        return _finish(skill, SkillSourceFormat.MARKDOWN.value)
    except Exception as exc:
        return _fail("markdown", str(exc))


def import_skill_from_zip(path: Path) -> SkillImportResult:
    if not zipfile.is_zipfile(path):
        return _fail("imported_repo", "Uploaded package is not a valid zip archive")
    with tempfile.TemporaryDirectory(prefix="nid-skill-") as tmp:
        root = Path(tmp)
        with zipfile.ZipFile(path) as zf:
            for info in zf.infolist():
                target = root / info.filename
                resolved = target.resolve()
                if not str(resolved).startswith(str(root.resolve())):
                    return _fail("imported_repo", "Unsafe zip path")
                if info.is_dir():
                    resolved.mkdir(parents=True, exist_ok=True)
                    continue
                resolved.parent.mkdir(parents=True, exist_ok=True)
                resolved.write_bytes(zf.read(info.filename))
        return import_skill_from_path(root)


def _import_native(root: Path, yaml_path: Path, skill_md: Path) -> SkillImportResult:
    if not skill_md.exists():
        return _fail("native", "Missing SKILL.md")
    metadata = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    if not isinstance(metadata, dict):
        return _fail("native", "skill.yaml must contain an object")
    body = skill_md.read_text(encoding="utf-8")
    name = str(metadata.get("name") or _title_from_markdown(body, root.name))
    slug = str(metadata.get("slug") or _slugify(name))
    triggers = [SkillTrigger(**item) for item in metadata.get("triggers", [])]
    capabilities = SkillCapabilityRequirements(**(metadata.get("required_capabilities") or {}))
    skill = NidavellirSkill(
        id=str(metadata.get("id") or slug),
        slug=slug,
        name=name,
        description=str(metadata.get("description") or ""),
        activation_mode=metadata.get("activation_mode", SkillActivationMode.MANUAL),
        triggers=triggers,
        instructions=SkillInstructions(core=body),
        required_capabilities=capabilities,
        priority=int(metadata.get("priority", 50)),
        enabled=False,
        status=SkillStatus.VALIDATED,
        source=SkillSource(format=SkillSourceFormat.NATIVE, import_path=str(root)),
    )
    return _finish(skill, "native")


def _import_markdown(path: Path, fmt: SkillSourceFormat, *, fallback_name: str) -> SkillImportResult:
    if not path.exists():
        return _fail(fmt.value, "Markdown skill file not found")
    body = path.read_text(encoding="utf-8")
    name = _title_from_markdown(body, fallback_name)
    slug = _slugify(name)
    skill = NidavellirSkill(
        id=slug,
        slug=slug,
        name=name,
        description="",
        activation_mode=SkillActivationMode.MANUAL,
        triggers=[],
        instructions=SkillInstructions(core=body),
        required_capabilities=SkillCapabilityRequirements(),
        enabled=False,
        status=SkillStatus.VALIDATED,
        source=SkillSource(format=fmt, import_path=str(path)),
    )
    return _finish(skill, fmt.value)


def _finish(skill: NidavellirSkill, fmt: str) -> SkillImportResult:
    report = validate_skill(skill)
    warnings = [d.message for d in report.diagnostics if d.level == "warning"]
    errors = [d.message for d in report.diagnostics if d.level == "error"]
    if errors:
        skill = skill.model_copy(update={"status": SkillStatus.FAILED_IMPORT})
    return SkillImportResult(
        ok=not errors,
        import_id=str(uuid.uuid4()),
        detected_format=fmt,
        skill=skill,
        warnings=warnings,
        errors=errors,
    )
