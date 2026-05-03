from __future__ import annotations

import json
import re
from typing import Any

TOOL_PROTOCOL_INSTRUCTIONS = """
Nidavellir tool protocol:
- Native provider file/shell tools may be unavailable in this session.
- When you need a workspace tool, do not claim you ran it.
- Instead emit one JSON object on its own line using this shape:
  {"nidavellir_tool_request":{"toolName":"Bash","action":"shell_command","command":"npm test","workspace":"<cwd>","arguments":{"timeoutSeconds":120}}}
- Supported actions: shell_command, file_read, file_write, file_delete.
- For file_write include arguments.content. For file_read/file_write/file_delete include path.
- After emitting a request, stop and wait for the user to approve it in Nidavellir.
""".strip()

_REQUEST_RE = re.compile(r"\{[^\n]*\"nidavellir_tool_request\"[^\n]*\}", re.MULTILINE)


def extract_tool_requests(text: str) -> list[dict[str, Any]]:
    requests: list[dict[str, Any]] = []
    seen: set[str] = set()
    for match in _REQUEST_RE.finditer(text):
        raw = match.group(0)
        if raw in seen:
            continue
        seen.add(raw)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        request = payload.get("nidavellir_tool_request")
        if isinstance(request, dict):
            requests.append(request)
    return requests
