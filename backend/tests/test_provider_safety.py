from fastapi.testclient import TestClient


def test_provider_safety_store_downgrades_unmediated_ask_mode(tmp_path):
    from nidavellir.agents.safety import ProviderSafetyStore

    store = ProviderSafetyStore(str(tmp_path / "safety.db"))
    policy = store.set_policy("claude", "ask")

    assert policy.dangerousness == "ask"
    assert policy.effective_dangerousness == "restricted"
    assert "not yet mediated" in (policy.warning or "")


def test_provider_safety_store_allows_explicit_free_rein(tmp_path):
    from nidavellir.agents.safety import ProviderSafetyStore

    store = ProviderSafetyStore(str(tmp_path / "safety.db"))
    policy = store.set_policy("codex", "free_rein")

    assert policy.dangerousness == "free_rein"
    assert policy.effective_dangerousness == "free_rein"


def test_provider_policy_api_updates_provider_payload(tmp_path, monkeypatch):
    monkeypatch.setenv("NIDAVELLIR_PROVIDER_SAFETY_DB", str(tmp_path / "provider-safety.db"))
    monkeypatch.setenv("NIDAVELLIR_DB_PATH", str(tmp_path / "memory.db"))
    monkeypatch.setenv("NIDAVELLIR_TOKEN_DB", str(tmp_path / "tokens.db"))
    monkeypatch.setenv("NIDAVELLIR_SKILL_DB", str(tmp_path / "skills.db"))
    monkeypatch.setenv("NIDAVELLIR_PERMISSION_DB", str(tmp_path / "permissions.db"))
    monkeypatch.setenv("NIDAVELLIR_TOOL_REQUEST_DB", str(tmp_path / "tool-requests.db"))
    monkeypatch.setenv("NIDAVELLIR_COMMAND_DB", str(tmp_path / "commands.db"))
    monkeypatch.setenv("NIDAVELLIR_ORCHESTRATION_DB", str(tmp_path / "orchestration.db"))
    monkeypatch.setenv("NIDAVELLIR_VECTOR_PATH", "")

    from nidavellir.main import app

    with TestClient(app) as client:
        response = client.put("/api/agents/provider-policies/claude", json={"dangerousness": "free_rein"})
        assert response.status_code == 200
        assert response.json()["effective_dangerousness"] == "free_rein"

        providers = client.get("/api/agents/providers").json()["providers"]
        claude = next(provider for provider in providers if provider["id"] == "claude")
        assert claude["dangerousness"] == "free_rein"
        assert claude["effective_dangerousness"] == "free_rein"

        workspace = tmp_path / "repo"
        workspace.mkdir()
        target = workspace / ".env"
        created = client.post("/api/tool-requests", json={
            "conversationId": "conv-tools",
            "provider": "claude",
            "toolName": "Write",
            "action": "file_write",
            "path": str(target),
            "workspace": str(workspace),
            "arguments": {"content": "TOKEN=redacted\n"},
        })
        assert created.status_code == 200
        request_id = created.json()["id"]
        assert created.json()["status"] == "pending"

        approved = client.post(f"/api/tool-requests/{request_id}/approve", json={"reason": "test approval"})
        assert approved.status_code == 200
        body = approved.json()
        assert body["status"] == "executed"
        assert body["execution"]["type"] == "file_write"
        assert target.read_text(encoding="utf-8") == "TOKEN=redacted\n"

        continuation = client.get(f"/api/tool-requests/{request_id}/continuation")
        assert continuation.status_code == 200
        assert "Nidavellir-mediated tool result" in continuation.json()["content"]
        assert request_id in continuation.json()["content"]

        continued = client.post(f"/api/tool-requests/{request_id}/continued", json={"markContinued": True})
        assert continued.status_code == 200
        assert continued.json()["continued_at"] is not None


def test_tool_request_store_round_trips_pending_request(tmp_path):
    from nidavellir.permissions.tool_requests import ToolRequestStore

    store = ToolRequestStore(str(tmp_path / "tools.db"))
    item = store.create(
        conversation_id="conv",
        provider="claude",
        tool_name="Bash",
        action="shell_command",
        status="pending",
        command="rm -rf build",
        arguments={"raw": "x"},
    )

    assert item["status"] == "pending"
    assert item["arguments"]["raw"] == "x"

    updated = store.resolve(item["id"], "denied", "nope")
    assert updated is not None
    assert updated["status"] == "denied"
    assert updated["reason"] == "nope"


def test_tool_protocol_extracts_json_request():
    from nidavellir.permissions.tool_protocol import extract_tool_requests

    text = """
    Need a command.
    {"nidavellir_tool_request":{"toolName":"Bash","action":"shell_command","command":"npm test","arguments":{"timeoutSeconds":30}}}
    """

    requests = extract_tool_requests(text)
    assert requests == [{
        "toolName": "Bash",
        "action": "shell_command",
        "command": "npm test",
        "arguments": {"timeoutSeconds": 30},
    }]
