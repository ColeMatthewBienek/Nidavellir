from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/refs", tags=["refs"])


def _normalize_path(raw: str, base: str | None = None) -> Path:
    path_text = raw.strip()
    if len(path_text) >= 3 and path_text[1:3] == ":\\":
        drive = path_text[0].lower()
        rest = path_text[3:].replace("\\", "/")
        path_text = f"/mnt/{drive}/{rest}"
    else:
        path_text = path_text.replace("\\", "/")

    path = Path(path_text)
    if not path.is_absolute():
        if not base:
            raise HTTPException(status_code=400, detail="relative_path_requires_base")
        path = _normalize_path(base) / path
    return path.resolve()


@router.get("/code")
def preview_code_ref(
    path: str = Query(..., min_length=1),
    start: int = Query(1, ge=1),
    end: int | None = Query(None, ge=1),
    base: str | None = Query(None),
) -> dict:
    target = _normalize_path(path, base)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file_not_found")

    end_line = end or start
    if end_line < start:
        raise HTTPException(status_code=400, detail="invalid_line_range")

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    all_lines = content.splitlines()
    if not all_lines:
        all_lines = [""]

    context = 4
    first = max(1, start - context)
    last = min(len(all_lines), end_line + context)
    lines = [
        {
            "number": line_no,
            "text": all_lines[line_no - 1],
            "highlighted": start <= line_no <= end_line,
        }
        for line_no in range(first, last + 1)
    ]
    return {
        "path": str(target),
        "fileName": target.name,
        "startLine": start,
        "endLine": end_line,
        "lineCount": len(all_lines),
        "lines": lines,
    }
