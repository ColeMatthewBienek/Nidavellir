from __future__ import annotations

import asyncio
from typing import Callable, TypeVar

T = TypeVar("T")


async def run_sync(fn: Callable[[], T]) -> T:
    """Run a blocking function in the default executor without blocking the event loop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, fn)
