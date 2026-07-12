"""Per-review SSE broadcast hub."""

import asyncio
import contextlib
import json
from typing import Any


class Hub:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue[str]]] = {}

    def subscribe(self, key: str) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
        self._subs.setdefault(key, set()).add(q)
        return q

    def unsubscribe(self, key: str, q: asyncio.Queue[str]) -> None:
        self._subs.get(key, set()).discard(q)

    def publish(self, key: str, event: dict[str, Any]) -> None:
        payload = json.dumps(event)
        for q in list(self._subs.get(key, set())):
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(payload)


hub = Hub()
