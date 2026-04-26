from __future__ import annotations

import hashlib

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

COLLECTION = "nidavellir_memories"
VECTOR_DIM  = 768


def _to_point_id(memory_id: str) -> int:
    """Convert any string memory ID to a stable uint64 Qdrant point ID.

    Qdrant accepts uint64 or UUID-string IDs. Memory IDs are UUIDs but hashing
    is simpler and works for all string formats including short test IDs.
    """
    return int(hashlib.sha256(memory_id.encode()).hexdigest()[:16], 16)


class VectorStore:
    """Thin wrapper around a local (path-based or in-memory) Qdrant client."""

    def __init__(self, path: str) -> None:
        self._client = QdrantClient(path=path)
        self._ensure_collection()

    def _ensure_collection(self) -> None:
        existing = {c.name for c in self._client.get_collections().collections}
        if COLLECTION not in existing:
            self._client.create_collection(
                collection_name=COLLECTION,
                vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE),
            )

    def upsert(self, memory_id: str, vector: list[float], payload: dict) -> None:
        """Store a vector point keyed by hashed memory_id; original ID in payload."""
        self._client.upsert(
            collection_name=COLLECTION,
            points=[
                PointStruct(
                    id=_to_point_id(memory_id),
                    vector=vector,
                    payload={**payload, "memory_id": memory_id},
                )
            ],
        )

    def search(self, query_embedding: list[float], limit: int = 20) -> list:
        """Return ScoredPoint list ordered by cosine similarity (descending).

        Uses query_points (qdrant-client >= 1.7; `search` was removed in 1.9+).
        with_payload=True is required — without it r.payload is empty and
        memory_id cannot be recovered.
        """
        response = self._client.query_points(
            collection_name=COLLECTION,
            query=query_embedding,
            limit=limit,
            with_payload=True,
        )
        return response.points

    def get_by_memory_id(self, memory_id: str) -> dict | None:
        """Retrieve a point by its original string memory_id."""
        results = self._client.retrieve(
            collection_name=COLLECTION,
            ids=[_to_point_id(memory_id)],
            with_payload=True,
        )
        return dict(results[0].payload) if results else None

    def is_ready(self) -> bool:
        try:
            self._client.get_collections()
            return True
        except Exception:
            return False
