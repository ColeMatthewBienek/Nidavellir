from __future__ import annotations

from fastapi.testclient import TestClient

from nidavellir.main import app


def test_code_ref_preview_returns_highlighted_range(tmp_path):
    source = tmp_path / "src" / "App.tsx"
    source.parent.mkdir()
    source.write_text("\n".join([f"line {i}" for i in range(1, 12)]), encoding="utf-8")

    client = TestClient(app)
    response = client.get("/api/refs/code", params={
        "path": "src/App.tsx",
        "base": str(tmp_path),
        "start": 4,
        "end": 6,
    })

    assert response.status_code == 200
    body = response.json()
    assert body["path"] == str(source.resolve())
    assert body["startLine"] == 4
    assert body["endLine"] == 6
    highlighted = [line["number"] for line in body["lines"] if line["highlighted"]]
    assert highlighted == [4, 5, 6]


def test_code_ref_preview_rejects_missing_file(tmp_path):
    client = TestClient(app)
    response = client.get("/api/refs/code", params={
        "path": "missing.py",
        "base": str(tmp_path),
        "start": 1,
    })

    assert response.status_code == 404


def test_code_ref_preview_normalizes_windows_paths(tmp_path):
    from nidavellir.routers.link_refs import _normalize_path

    assert str(_normalize_path(r"C:\Users\colebienek\project\file.ts")) == "/mnt/c/Users/colebienek/project/file.ts"
