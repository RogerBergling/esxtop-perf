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
    protected: bool = False


class SessionStore:
    def __init__(self) -> None:
        base = config.session_dir()
        if base:
            Path(base).mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix="esxtop-lens-sessions-", dir=base))
        self._sessions: dict[str, Session] = {}
        self._lock = threading.RLock()
        self._closed = False
        self._stop_event = threading.Event()
        self._sweeper = threading.Thread(
            target=self._sweep_loop,
            name="esxtop-session-sweeper",
            daemon=True,
        )
        self._sweeper.start()
        atexit.register(self.close)

    def create(self, document: dict[str, Any], *, protected: bool = False) -> str:
        self._expire()
        if not protected:
            with self._lock:
                # Protected demo sessions never consume a user session slot and
                # are skipped by eviction, so a demo request cannot displace an
                # active upload.
                while True:
                    evictable = [
                        session
                        for session in self._sessions.values()
                        if not session.protected
                    ]
                    if len(evictable) < config.max_sessions():
                        break
                    oldest = min(evictable, key=lambda item: item.last_access)
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
            protected=protected,
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
            now = time.time()
            if self._is_expired_locked(session, now):
                self._remove(session)
                raise SessionError("The analysis session has expired. Re-import the capture.", 410)
            if len(clean_ids) * max(1, session.sample_count) > config.max_request_cells():
                raise SessionError(
                    "The requested series set is larger than the per-request value limit.",
                    413,
                )
            session.last_access = now
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

    def has(self, session_id: str, *, touch: bool = False) -> bool:
        """Return whether a live session exists without raising on expiry."""

        if not session_id or not isinstance(session_id, str):
            return False
        now = time.time()
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return False
            if self._is_expired_locked(session, now):
                self._remove(session)
                return False
            if touch:
                session.last_access = now
            return True

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
                "maxLifetimeSeconds": config.session_max_lifetime_seconds(),
            }

    def close(self) -> None:
        self._stop_event.set()
        sweeper = getattr(self, "_sweeper", None)
        if sweeper is not None and sweeper.is_alive() and sweeper is not threading.current_thread():
            sweeper.join(timeout=2)
        with self._lock:
            if self._closed and not self._sessions:
                return
            self._closed = True
            for session in list(self._sessions.values()):
                self._remove(session)
        shutil.rmtree(self.root, ignore_errors=True)

    def _sweep_loop(self) -> None:
        while not self._stop_event.is_set():
            ttl = max(0.1, float(config.session_ttl_seconds()))
            interval = max(0.1, min(float(config.session_sweep_seconds()), ttl / 2))
            if self._stop_event.wait(interval):
                return
            try:
                self._expire()
            except Exception:
                # The sweeper must never terminate because one cleanup raised.
                continue

    def _expire(self) -> None:
        with self._lock:
            self._expire_locked(time.time())

    def _is_expired_locked(self, session: Session, now: float) -> bool:
        ttl = config.session_ttl_seconds()
        max_lifetime = config.session_max_lifetime_seconds()
        return (
            now - session.last_access > ttl
            or now - session.created > max_lifetime
        )

    def _expire_locked(self, now: float) -> None:
        for session in list(self._sessions.values()):
            if self._is_expired_locked(session, now):
                self._remove(session)

    def _remove_expired_locked(self, now: float) -> None:
        self._expire_locked(now)

    def _remove(self, session: Session) -> None:
        self._sessions.pop(session.id, None)
        try:
            session.path.unlink(missing_ok=True)
        except OSError:
            pass
