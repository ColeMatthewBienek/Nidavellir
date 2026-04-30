import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import health, agents, ws
from .routers import git as git_router
from .routers import conversations as conversations_router
from .routers import memory as memory_router
from .routers import tokens as tokens_router
from .routers import sessions as sessions_router
from .routers import link_refs as link_refs_router
from .routers import skills as skills_router
from .routers import permissions as permissions_router
from .routers import project_instructions as project_instructions_router
from .memory.store import MemoryStore
from .permissions import PermissionAuditStore, PermissionEvaluator
from .skills.store import SkillStore
from .tokens.store import TokenUsageStore

_DB_PATH      = Path(os.environ.get("NIDAVELLIR_DB_PATH",      "./data/nidavellir.db"))
_TOKEN_DB     = Path(os.environ.get("NIDAVELLIR_TOKEN_DB",     "./data/tokens.db"))
_SKILL_DB     = Path(os.environ.get("NIDAVELLIR_SKILL_DB",     "./data/skills.db"))
_PERMISSION_DB = Path(os.environ.get("NIDAVELLIR_PERMISSION_DB", "./data/permissions.db"))
_VECTOR_PATH  = os.environ.get("NIDAVELLIR_VECTOR_PATH", "./data/qdrant") or None


@asynccontextmanager
async def lifespan(app: FastAPI):
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    app.state.memory_store = MemoryStore(str(_DB_PATH), vector_path=_VECTOR_PATH)
    app.state.token_store  = TokenUsageStore(str(_TOKEN_DB))
    app.state.skill_store  = SkillStore(str(_SKILL_DB))
    app.state.permission_evaluator = PermissionEvaluator()
    app.state.permission_audit_store = PermissionAuditStore(str(_PERMISSION_DB))
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
app.include_router(conversations_router.router)
app.include_router(memory_router.router)
app.include_router(tokens_router.router)
app.include_router(sessions_router.router)
app.include_router(link_refs_router.router)
app.include_router(skills_router.router)
app.include_router(git_router.router)
app.include_router(permissions_router.router)
app.include_router(project_instructions_router.router)
