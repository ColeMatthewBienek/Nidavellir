from __future__ import annotations

import httpx

OLLAMA_BASE         = "http://localhost:11434"
DEFAULT_EMBED_MODEL = "nomic-embed-text"
EMBED_DIM           = 768


def embed(text: str, model: str = DEFAULT_EMBED_MODEL) -> list[float]:
    """Generate an embedding vector via Ollama.

    Raises httpx.HTTPError or httpx.ConnectError on failure so callers can
    decide whether to log and continue or propagate.
    """
    resp = httpx.post(
        f"{OLLAMA_BASE}/api/embeddings",
        json={"model": model, "prompt": text},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]


def embed_query(text: str, model: str = DEFAULT_EMBED_MODEL) -> list[float]:
    """Embed a query string. Thin alias over embed() for semantic clarity."""
    return embed(text, model)
