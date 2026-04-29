from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_WORKDIR = Path(
    os.environ.get("NIDAVELLIR_WORKDIR")
    or Path(__file__).resolve().parents[2]
)


@dataclass(frozen=True)
class NormalizedWorkingDirectory:
    path: str
    display: str
    exists: bool
    is_directory: bool
    writable: bool
    warning: str | None


def _strip_wrapping_quotes(value: str) -> str:
    text = value.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {"'", '"'}:
        return text[1:-1]
    return text


def _windows_to_wsl_path(value: str) -> str | None:
    match = re.match(r"^([A-Za-z]):[\\/](.*)$", value)
    if not match:
        return None
    drive = match.group(1).lower()
    rest = match.group(2).replace("\\", "/")
    return f"/mnt/{drive}/{rest}"


def normalize_working_directory(path_value: str, *, base_dir: str | Path | None = None) -> NormalizedWorkingDirectory:
    raw = _strip_wrapping_quotes(path_value)
    if "\x00" in raw:
        return NormalizedWorkingDirectory(raw, raw, False, False, False, "invalid_path")

    display = raw
    wsl_path = _windows_to_wsl_path(raw)
    candidate = Path(wsl_path or raw).expanduser()
    if not candidate.is_absolute():
        base = Path(base_dir).expanduser() if base_dir is not None else Path.cwd()
        candidate = base / candidate

    resolved = candidate.resolve(strict=False)
    exists = resolved.exists()
    is_directory = resolved.is_dir()
    writable = bool(exists and is_directory and os.access(resolved, os.W_OK))
    warning = None
    if exists and is_directory and not writable:
        warning = "directory_not_writable"

    return NormalizedWorkingDirectory(
        path=str(resolved),
        display=display if wsl_path else str(resolved),
        exists=exists,
        is_directory=is_directory,
        writable=writable,
        warning=warning,
    )


def effective_default_working_directory() -> str:
    return str(DEFAULT_WORKDIR.expanduser().resolve(strict=False))
