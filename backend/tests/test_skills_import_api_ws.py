from __future__ import annotations

from pathlib import Path
import zipfile

import pytest
from httpx import ASGITransport, AsyncClient

from nidavellir.main import app
from nidavellir.memory.store import MemoryStore
from nidavellir.skills.importer import import_skill_from_path
from nidavellir.skills.store import SkillStore
from nidavellir.tokens.store import TokenUsageStore


def setup_app(tmp_path):
    app.state.memory_store = MemoryStore(str(tmp_path / "memory.db"))
    app.state.token_store = TokenUsageStore(str(tmp_path / "tokens.db"))
    app.state.skill_store = SkillStore(str(tmp_path / "skills.db"))
    return app.state.skill_store


def test_importer_normalizes_native_claude_and_plain_markdown_without_execution(tmp_path):
    native = tmp_path / "native"
    native.mkdir()
    (native / "skill.yaml").write_text(
        "id: native-review\nslug: native-review\nname: Native Review\nactivation_mode: automatic\ntriggers:\n  - type: keyword\n    value: review\nrequired_capabilities:\n  file_read: true\n",
        encoding="utf-8",
    )
    (native / "SKILL.md").write_text("# Native Review\n\nReview with rigor.", encoding="utf-8")
    (native / "script.sh").write_text("exit 99", encoding="utf-8")

    claude = tmp_path / "claude-skill"
    claude.mkdir()
    (claude / "SKILL.md").write_text("# Claude Skill\n\nClaude style body.", encoding="utf-8")

    plain = tmp_path / "plain.md"
    plain.write_text("# Plain Skill\n\nPlain markdown body.", encoding="utf-8")

    native_result = import_skill_from_path(native)
    claude_result = import_skill_from_path(claude)
    plain_result = import_skill_from_path(plain)

    assert native_result.ok is True
    assert native_result.detected_format == "native"
    assert native_result.skill.enabled is False
    assert native_result.skill.source.trust_status == "untrusted"
    assert native_result.skill.source.imported_at is not None
    assert native_result.skill.status == "validated"
    assert claude_result.detected_format == "claude_skill"
    assert claude_result.skill.activation_mode == "manual"
    assert claude_result.skill.source.import_path == str(claude / "SKILL.md")
    assert plain_result.detected_format == "markdown"
    assert plain_result.skill.activation_mode == "manual"
    assert plain_result.skill.source.source_type == "local_path"


def test_importer_resolves_windows_drive_paths_to_wsl_paths(tmp_path):
    native = tmp_path / "native"
    native.mkdir()
    (native / "skill.yaml").write_text("id: win-skill\nslug: win-skill\nname: Windows Path Skill\nactivation_mode: manual\n", encoding="utf-8")
    (native / "SKILL.md").write_text("# Windows Path Skill\n\nBody.", encoding="utf-8")
    windows_path = str(native).replace("/mnt/c/", "C:\\").replace("/", "\\")

    result = import_skill_from_path(windows_path)

    assert result.ok is True
    assert result.skill.id == "win-skill"


def test_importer_fails_cleanly_for_missing_skill_md_and_bad_yaml(tmp_path):
    missing = tmp_path / "missing"
    missing.mkdir()
    (missing / "skill.yaml").write_text("name: Missing", encoding="utf-8")
    bad = tmp_path / "bad"
    bad.mkdir()
    (bad / "skill.yaml").write_text("name: [", encoding="utf-8")
    (bad / "SKILL.md").write_text("# Bad", encoding="utf-8")

    assert import_skill_from_path(missing).ok is False
    assert import_skill_from_path(bad).ok is False


@pytest.mark.asyncio
async def test_skills_api_list_enable_import_compile_preview_and_compatibility(tmp_path):
    setup_app(tmp_path)
    md = tmp_path / "review.md"
    md.write_text("# Review Helper\n\nReview the code when asked.", encoding="utf-8")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        imported = await c.post("/api/skills/import/local", json={"path": str(md)})
        assert imported.status_code == 200
        body = imported.json()
        assert body["ok"] is True
        skill_id = body["skill"]["id"]

        listed = await c.get("/api/skills")
        assert listed.status_code == 200
        assert listed.json()[0]["enabled"] is False

        enabled = await c.post(f"/api/skills/{skill_id}/enabled", json={"enabled": True})
        assert enabled.status_code == 200
        assert enabled.json()["enabled"] is True

        slash = await c.post(f"/api/skills/{skill_id}/slash", json={"showInSlash": True})
        assert slash.status_code == 200
        assert slash.json()["showInSlash"] is True

        edited = await c.patch(f"/api/skills/{skill_id}", json={
            "name": "Review Helper Edited",
            "slug": "review-helper-edited",
            "instructions": "Review the code with edited instructions.",
            "scope": "project",
            "activationMode": "automatic",
            "triggers": [{"type": "keyword", "value": "review-edited", "weight": 1}],
        })
        assert edited.status_code == 200
        assert edited.json()["name"] == "Review Helper Edited"
        assert edited.json()["slug"] == "review-helper-edited"
        assert edited.json()["scope"] == "project"
        assert edited.json()["activationMode"] == "automatic"
        assert edited.json()["triggers"][0]["value"] == "review-edited"
        assert edited.json()["instructions"]["core"] == "Review the code with edited instructions."
        assert edited.json()["version"] == 2

        deleted = await c.delete(f"/api/skills/{skill_id}")
        assert deleted.status_code == 200
        assert deleted.json()["deletedSkillId"] == skill_id

        missing = await c.get(f"/api/skills/{skill_id}")
        assert missing.status_code == 404

        reimported = await c.post("/api/skills/import/local", json={"path": str(md)})
        assert reimported.status_code == 200
        skill_id = reimported.json()["skill"]["id"]
        await c.post(f"/api/skills/{skill_id}/enabled", json={"enabled": True})

        compat = await c.get(f"/api/skills/{skill_id}/compatibility?provider=codex&model=gpt-5.5")
        assert compat.status_code == 200
        assert compat.json()["provider"] == "codex"

        preview = await c.post("/api/skills/compile-preview", json={
            "provider": "codex",
            "model": "gpt-5.5",
            "user_message": "use the Review Helper Edited skill to review-edited this",
        })
        assert preview.status_code == 200
        assert "## Activated Skills" in preview.json()["prompt_fragment"]

        activations = await c.get("/api/skills/activations")
        assert activations.status_code == 200

        flagged = await c.post("/api/skills/import/markdown", json={
            "name": "Flagged Skill",
            "markdown": "# Flagged Skill\n\nUse flags.",
            "slug": "flagged-skill",
            "scope": "project",
            "activationMode": "automatic",
            "triggers": [{"type": "keyword", "value": "flagged", "weight": 1}],
            "enabled": True,
            "showInSlash": True,
        })
        assert flagged.status_code == 200
        flagged_skill = flagged.json()["skill"]
        assert flagged_skill["slug"] == "flagged-skill"
        assert flagged_skill["scope"] == "project"
        assert flagged_skill["activationMode"] == "automatic"
        assert flagged_skill["enabled"] is True
        assert flagged_skill["showInSlash"] is True

        validation = await c.post("/api/skills/validate/markdown", json={
            "name": "Validation Only",
            "markdown": "# Validation Only\n\nValidate but do not store.",
            "slug": "validation-only",
            "enabled": True,
            "showInSlash": True,
        })
        assert validation.status_code == 200
        assert validation.json()["ok"] is True
        assert validation.json()["skill"]["slug"] == "validation-only"
        listed_after_validation = await c.get("/api/skills/validation-only")
        assert listed_after_validation.status_code == 404


@pytest.mark.asyncio
async def test_skills_api_imports_pasted_markdown_upload_file_and_upload_package(tmp_path):
    setup_app(tmp_path)
    package = tmp_path / "skill-package.zip"
    with zipfile.ZipFile(package, "w") as zf:
        zf.writestr("skill.yaml", "id: package-skill\nslug: package-skill\nname: Package Skill\nactivation_mode: manual\n")
        zf.writestr("SKILL.md", "# Package Skill\n\nPackaged body.")
        zf.writestr("scripts/install.sh", "exit 99")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        pasted = await c.post("/api/skills/import/markdown", json={
            "name": "Pasted Claude Skill",
            "markdown": "# Pasted Claude Skill\n\nUse this skill carefully.",
        })
        assert pasted.status_code == 200
        assert pasted.json()["ok"] is True
        assert pasted.json()["detectedFormat"] == "markdown"
        assert pasted.json()["skill"]["enabled"] is False

        uploaded_md = await c.post(
            "/api/skills/import/upload",
            files={"file": ("upload.md", b"# Upload Skill\n\nUploaded body.", "text/markdown")},
        )
        assert uploaded_md.status_code == 200
        assert uploaded_md.json()["ok"] is True
        assert uploaded_md.json()["skill"]["name"] == "Upload Skill"

        uploaded_package = await c.post(
            "/api/skills/import/upload",
            files={"file": ("skill-package.zip", package.read_bytes(), "application/zip")},
        )
        assert uploaded_package.status_code == 200
        assert uploaded_package.json()["ok"] is True
        assert uploaded_package.json()["detectedFormat"] == "native"
        assert uploaded_package.json()["skill"]["id"] == "package-skill"


@pytest.mark.asyncio
async def test_ws_message_path_sends_prompt_assembly_output(monkeypatch, tmp_path):
    skill_store = setup_app(tmp_path)
    store = app.state.memory_store
    store.create_conversation("conv", provider_id="codex", model_id="gpt-5.5")
    imported = import_skill_from_path(_write_review_skill(tmp_path))
    skill_store.create_skill(imported.skill)
    skill_store.set_enabled(imported.skill.id, True)

    sent_prompts: list[str] = []

    class FakeAgent:
        provider_type = "codex"

        async def start(self): ...
        async def kill(self): ...
        async def send(self, text: str):
            sent_prompts.append(text)
        async def stream(self):
            yield "done"

    async def no_extract(**kwargs):
        return None

    monkeypatch.setattr("nidavellir.agents.registry.make_agent", lambda *args, **kwargs: FakeAgent())
    monkeypatch.setattr("nidavellir.routers.ws._extract_and_store", no_extract)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        async with c.stream("GET", "/api/health") as _:
            pass

    from nidavellir.routers.ws import handle_message_with_identity

    class FakeWs:
        app = app
        async def send_json(self, data): ...

    await handle_message_with_identity(
        ws=FakeWs(),
        content="use the Review Helper skill to review this file",
        conversation_id="conv",
        provider_id="codex",
        model_id="gpt-5.5",
        store=store,
        token_store=app.state.token_store,
    )

    assert sent_prompts
    assert "## Activated Skills" in sent_prompts[0]
    assert "## User Message" in sent_prompts[0]
    assert sent_prompts[0].index("## Activated Skills") < sent_prompts[0].index("## User Message")


def _write_review_skill(tmp_path: Path) -> Path:
    path = tmp_path / "review.md"
    path.write_text("# Review Helper\n\nReview the code when asked.", encoding="utf-8")
    return path
