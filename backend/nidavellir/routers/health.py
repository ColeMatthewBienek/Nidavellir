from fastapi import APIRouter
from datetime import datetime

router = APIRouter(prefix="/api", tags=["health"])

@router.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}
