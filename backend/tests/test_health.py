import pytest
from httpx import AsyncClient, ASGITransport

# This import will fail (red) until main.py exists
from nidavellir.main import app

@pytest.mark.asyncio
async def test_health_returns_200():
    """GET /api/health must return HTTP 200."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health")
    assert response.status_code == 200

@pytest.mark.asyncio
async def test_health_returns_status_ok():
    """Response body must contain status: ok."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health")
    data = response.json()
    assert data["status"] == "ok"

@pytest.mark.asyncio
async def test_health_returns_timestamp():
    """Response body must contain an ISO 8601 timestamp string."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health")
    data = response.json()
    assert "timestamp" in data
    assert isinstance(data["timestamp"], str)
    assert len(data["timestamp"]) > 0

@pytest.mark.asyncio
async def test_health_content_type_is_json():
    """Response Content-Type must be application/json."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health")
    assert "application/json" in response.headers["content-type"]

@pytest.mark.asyncio
async def test_cors_header_present_for_vite_origin():
    """CORS header must allow the Vite dev server origin."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/health",
            headers={"Origin": "http://localhost:5173"}
        )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"

@pytest.mark.asyncio
async def test_unknown_route_returns_404():
    """Non-existent routes must return 404."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/does-not-exist")
    assert response.status_code == 404
