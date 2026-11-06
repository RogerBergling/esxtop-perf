"""Short-lived, on-disk series store for lazy chart loading.

The initial analysis response contains metadata, statistics and findings only.
Numeric sample arrays are packed as little-endian doubles in a temporary SQLite
database; the browser fetches only the series needed by the current view.
"""

from __future__ import annotations

import array
import atexit
import json
import math
import secrets
import shutil
import sqlite3
import tempfile
import threading
import time
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import config


class SessionError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class Session:
    id: str
    path: Path
    created: float
    last_access: float
    sample_count: int
    cells: int
    series_count: int


class SessionStore:
    def __init__(self) -> None:
        base = config.session_dir()
        if base:
            Path(base).mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix="esxtop-lens-sessions-", dir=base))
        self._sessions: dict[str, Session] = {}
        self._lock = threading.RLock()
        atexit.register(self.close)

    def create(self, document: dict[str, Any]) -> str:
        self._expire()
        with self._lock:
            while len(self._sessions) >= config.max_sessions():
                oldest = min(self._sessions.values(), key=lambda item: item.last_access)
                self._remove(oldest)

        session_id = secrets.token_urlsafe(18)
        path = self.root / f"{session_id}.sqlite3"
        sample_count = int(document.get("meta", {}).get("sampleCount") or 0)
        series_count = 0
        cells = 0
        now = time.time()
        try:
            connection = sqlite3.connect(str(path), timeout=15)
            try:
                connection.execute("PRAGMA journal_mode=OFF")
                connection.execute("PRAGMA synchronous=OFF")
                connection.execute(
                    "CREATE TABLE series_values ("
                    "id TEXT PRIMARY KEY, kind TEXT NOT NULL, "
                    "encoding TEXT NOT NULL, payload BLOB NOT NULL)"
                )
                # Insert one series at a time. Building a list of every packed
                # payload first doubles peak memory and is unnecessary: SQLite
                # copies each blob into the database immediately.
                for series in document.get("series", []):
                    kind = series.get("kind", "numeric")
                    values = series.get("values") or []
                    if kind == "numeric":
                        if isinstance(values, array.array) and values.typecode == "d":
                            payload = values.tobytes()
                        else:
                            payload = array.array(
                                "d",
                                (float(value) if isinstance(value, (int, float)) else math.nan for value in values),
                            ).tobytes()
                    else:
                        payload = json.dumps(
                            [value if isinstance(value, str) else None for value in values],
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ).encode("utf-8")
                    encoding = "raw"
                    # esxtop series are highly repetitive (many zeros and
                    # plateaued counters). Compression keeps the /tmp session
                    # small enough for multi-hundred-MB captures.
                    if len(payload) >= 1024:
                        compressed = zlib.compress(payload, 1)
                        if len(compressed) < len(payload):
                            payload = compressed
                            encoding = "zlib"
                    connection.execute(
                        "INSERT INTO series_values(id, kind, encoding, payload) VALUES (?, ?, ?, ?)",
                        (str(series["id"]), kind, encoding, payload),
                    )
                    series_count += 1
                    cells += len(values)
                    # The browser receives statistics immediately; sample arrays
                    # are fetched on demand and never duplicated in the JSON.
                    series.pop("values", None)
                    series["lazy"] = True
                connection.commit()
            finally:
                connection.close()
        except Exception:
            path.unlink(missing_ok=True)
            raise

        session = Session(
            id=session_id,
            path=path,
            created=now,
            last_access=now,
            sample_count=sample_count,
            cells=cells,
            series_count=series_count,
        )
        with self._lock:
            self._sessions[session_id] = session
            self._remove_expired_locked(now)
        return session_id

    def get_values(self, session_id: str, series_ids: list[str]) -> dict[str, list[Any]]:
        if not session_id or not isinstance(session_id, str):
            raise SessionError("A session ID is required.", 400)
        if not isinstance(series_ids, list) or not series_ids:
            raise SessionError("At least one series ID is required.", 400)
        if len(series_ids) > config.max_request_series():
            raise SessionError(
                f"At most {config.max_request_series():,} series can be requested at once.",
                413,
            )
        clean_ids = []
        for series_id in series_ids:
            if not isinstance(series_id, str) or not series_id or len(series_id) > 120:
                raise SessionError("Invalid series ID.", 400)
            if series_id not in clean_ids:
                clean_ids.append(series_id)

        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise SessionError("The analysis session has expired. Re-import the capture.", 410)
            if time.time() - session.last_access > config.session_ttl_seconds():
                self._remove(session)
                raise SessionError("The analysis session has expired. Re-import the capture.", 410)
            if len(clean_ids) * max(1, session.sample_count) > config.max_request_cells():
                raise SessionError(
                    "The requested series set is larger than the per-request value limit.",
                    413,
                )
            session.last_access = time.time()
            path = session.path

        if not path.exists():
            with self._lock:
                self._sessions.pop(session_id, None)
            raise SessionError("The analysis session data is no longer available. Re-import the capture.", 410)

        placeholders = ",".join("?" for _ in clean_ids)
        result: dict[str, list[Any]] = {}
        connection = sqlite3.connect(str(path), timeout=15)
        try:
            cursor = connection.execute(
                f"SELECT id, kind, encoding, payload FROM series_values WHERE id IN ({placeholders})",
                clean_ids,
            )
            for series_id, kind, encoding, payload in cursor.fetchall():
                if encoding == "zlib":
                    payload = zlib.decompress(payload)
                if kind == "numeric":
                    packed = array.array("d")
                    packed.frombytes(payload)
                    result[series_id] = [None if math.isnan(value) else value for value in packed]
                else:
                    result[series_id] = json.loads(payload.decode("utf-8"))
        finally:
            connection.close()
        return result

    def stats(self) -> dict[str, Any]:
        with self._lock:
            self._expire_locked(time.time())
            sessions = list(self._sessions.values())
            total_bytes = 0
            for session in sessions:
                try:
                    total_bytes += session.path.stat().st_size
                except OSError:
                    pass
            return {
                "active": len(sessions),
                "maxSessions": config.max_sessions(),
                "cells": sum(session.cells for session in sessions),
                "bytes": total_bytes,
                "ttlSeconds": config.session_ttl_seconds(),
            }

    def close(self) -> None:
        with self._lock:
            for session in list(self._sessions.values()):
                self._remove(session)
        shutil.rmtree(self.root, ignore_errors=True)

    def _expire(self) -> None:
        with self._lock:
            self._expire_locked(time.time())

    def _expire_locked(self, now: float) -> None:
        ttl = config.session_ttl_seconds()
        for session in list(self._sessions.values()):
            if now - session.last_access > ttl:
                self._remove(session)

    def _remove_expired_locked(self, now: float) -> None:
        self._expire_locked(now)

    def _remove(self, session: Session) -> None:
        self._sessions.pop(session.id, None)
        try:
            session.path.unlink(missing_ok=True)
        except OSError:
            pass
