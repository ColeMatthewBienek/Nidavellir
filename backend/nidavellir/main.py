import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import health, agents, ws
from .routers import memory as memory_router
from .memory.store import MemoryStore

_DB_PATH     = Path(os.environ.get("NIDAVELLIR_DB_PATH",     "./data/nidavellir.db"))
_VECTOR_PATH = os.environ.get("NIDAVELLIR_VECTOR_PATH", "./data/qdrant") or None


@asynccontextmanager
async def lifespan(app: FastAPI):
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    app.state.memory_store = MemoryStore(str(_DB_PATH), vector_path=_VECTOR_PATH)
    yield
    # No explicit close needed — connections are per-operation


app = FastAPI(title="Nidavellir API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(agents.router)
app.include_router(ws.router)
app.include_router(memory_router.router)
