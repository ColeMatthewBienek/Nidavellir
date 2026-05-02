from __future__ import annotations

import json
from datetime import datetime, UTC, timedelta

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from nidavellir.tokens.context_meter import compute_context_pressure
from nidavellir.tokens.anomaly import detect_anomalies

router = APIRouter(tags=["tokens"])


def _token_store(request: Request):
    try:
        return request.app.state.token_store
    except AttributeError:
        raise HTTPException(503, "Token store not initialized")


# ── /api/context/usage ────────────────────────────────────────────────────────

@router.get("/api/context/usage")
def context_usage(
    request:         Request,
    conversation_id: str = "",
    session_id:      str = "",   # kept for backward compat — ignored for pressure calc
    model:           str = "claude-sonnet-4-6",
    provider:        str = "anthropic",
):
    """Calculate context pressure from the next request payload.

    Uses conversation messages (the actual content that will be sent to the provider),
    NOT accumulated session token totals from historical records.
    """
    import logging
    from nidavellir.sessions.handoff import should_inject_seed
    from nidavellir.tokens.context_meter import estimate_payload_tokens

    _log = logging.getLogger(__name__)

    # conversation_id is required — reject empty or missing
    conv_id = (conversation_id or "").strip() or (session_id or "").strip()
    if not conv_id:
        _log.warning("context_usage_request_rejected", extra={"reason": "missing_conversation_id"})
        return JSONResponse(
            status_code=400,
            content={"error": "conversation_id_required",
                     "message": "conversation_id is required for context usage calculation"},
        )

    # Validate the conversation exists — reject phantom ids
    messages: list[dict] = []
    try:
        memory_store = request.app.state.memory_store
        conv = memory_store.get_conversation(conv_id)
        if not conv:
            return JSONResponse(
                status_code=404,
                content={"error": "conversation_not_found", "conversation_id": conv_id},
            )
        messages = memory_store.get_conversation_messages(conv_id)
    except Exception:
        return JSONResponse(
            status_code=404,
            content={"error": "conversation_not_found", "conversation_id": conv_id},
        )

    turn_number = len(messages) // 2
    seed = memory_store.get_conversation_seed(conv_id)
    seed_turn_start = int(conv.get("seed_turn_start") or 0)
    includes_seed = bool(seed and should_inject_seed(max(0, turn_number - seed_turn_start)))
    payload_messages = list(messages)
    if includes_seed:
        payload_messages.append({"role": "system", "content": seed})

    # Count tokens from the actual payload — this is what the context window evaluates.
    # Active working-set text files are sent in a dedicated file context block and
    # must contribute to the same pressure calculation.
    current = estimate_payload_tokens(payload_messages)
    try:
        current += memory_store.active_file_text_tokens(conv_id)
    except Exception:
        pass
    project_instruction_tokens = 0
    try:
        workdir = conv.get("working_directory")
        if workdir:
            from nidavellir.project_instructions.discovery import default_global_instruction_files, discover_project_instructions
            project_instruction_tokens = discover_project_instructions(
                cwd=workdir,
                provider=provider,
                global_instruction_files=default_global_instruction_files(),
            ).token_estimate
            current += project_instruction_tokens
    except Exception:
        project_instruction_tokens = 0
    accuracy = "estimated"  # local heuristic; becomes "accurate" when provider pre-counts

    pressure = compute_context_pressure(current, model, provider, accuracy=accuracy)

    return {
        "model":                pressure.model,
        "provider":             pressure.provider,
        "currentTokens":        pressure.current_tokens,
        "usableTokens":         pressure.usable_tokens,
        "percentUsed":          pressure.percent_used,
        "state":                pressure.state,
        "accuracy":             pressure.accuracy,
        "contextLimit":         pressure.context_limit,
        "reservedOutputTokens": pressure.reserved_output_tokens,
        "lastUpdatedAt":        pressure.last_updated_at,
        "includesHandoffSeed":  includes_seed,
        "projectInstructionTokens": project_instruction_tokens,
    }


# ── /api/tokens/dashboard ─────────────────────────────────────────────────────

@router.get("/api/tokens/dashboard")
def dashboard(request: Request):
    store = _token_store(request)

    provider_rows = store.provider_summary()
    rolling       = store.rolling_window(hours=5)
    daily         = store.daily_totals()

    # Group by provider with model breakdown
    providers_map: dict[str, dict] = {}
    for row in provider_rows:
        p = row["provider"]
        if p not in providers_map:
            providers_map[p] = {
                "provider":      p,
                "total_input":   0,
                "total_output":  0,
                "request_count": 0,
                "models":        [],
            }
        providers_map[p]["total_input"]   += row["total_input"]
        providers_map[p]["total_output"]  += row["total_output"]
        providers_map[p]["request_count"] += row["request_count"]
        providers_map[p]["models"].append({
            "model":         row["model"],
            "total_input":   row["total_input"],
            "total_output":  row["total_output"],
            "request_count": row["request_count"],
            "last_used":     row["last_used"],
        })

    # Sort providers by total usage desc
    sorted_providers = sorted(
        providers_map.values(),
        key=lambda p: p["total_input"] + p["total_output"],
        reverse=True,
    )

    # Anomalies from recent records
    recent = store.export_range(hours=24, limit=100)
    # Compute baseline from last 50 records
    input_vals  = [r["reported_input_tokens"] for r in recent if r.get("reported_input_tokens")]
    output_vals = [r["reported_output_tokens"] for r in recent if r.get("reported_output_tokens")]
    avg_input  = sum(input_vals)  / len(input_vals)  if input_vals  else None
    avg_output = sum(output_vals) / len(output_vals) if output_vals else None

    anomalies = []
    for rec in recent:
        found = detect_anomalies(rec, baseline_avg_input=avg_input, baseline_avg_output=avg_output)
        for a in found:
            anomalies.append({**a, "record_id": rec["id"], "created_at": rec["created_at"]})

    return {
        "providers":    sorted_providers,
        "rollingWindow": {
            "total_input":   rolling["total_input"],
            "total_output":  rolling["total_output"],
            "request_count": rolling["request_count"],
            "hours":         5,
        },
        "dailyTotals": {
            "total_input":   daily["total_input"],
            "total_output":  daily["total_output"],
            "request_count": daily["request_count"],
        },
        "anomalies":    anomalies[:20],
        "recentIssues": [],
        "generatedAt":  datetime.now(UTC).isoformat(),
    }


# ── /api/tokens/export ────────────────────────────────────────────────────────

_RANGE_HOURS = {
    "1h":        1,
    "6h":        6,
    "24h":       24,
    "today":     24,
    "yesterday": 48,
    "7d":        24 * 7,
    "all":       0,
}


@router.get("/api/tokens/export")
def export_usage(request: Request, range: str = "24h"):
    store = _token_store(request)

    hours = _RANGE_HOURS.get(range, 24)
    records = store.export_range(hours=hours, limit=10_000)

    ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    filename = f"usage_{range}_{ts}.json"

    body = json.dumps({"range": range, "records": records, "exported_at": datetime.now(UTC).isoformat()},
                      ensure_ascii=False, indent=2)

    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
