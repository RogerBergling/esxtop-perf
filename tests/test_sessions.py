from __future__ import annotations

import math
import os
import time
import unittest
from array import array
from unittest.mock import patch

from esxtop_perf import config
from esxtop_perf.sessions import SessionStore


class SessionStoreTests(unittest.TestCase):
    def test_values_are_packed_and_removed_from_initial_document(self) -> None:
        store = SessionStore()
        document = {
            "meta": {"sampleCount": 3},
            "series": [
                {"id": "s1", "kind": "numeric", "values": [1.5, None, 3]},
                {"id": "s2", "kind": "text", "values": ["Y", "N", None]},
            ],
        }
        try:
            session_id = store.create(document)
            self.assertNotIn("values", document["series"][0])
            self.assertNotIn("values", document["series"][1])
            self.assertTrue(document["series"][0]["lazy"])
            values = store.get_values(session_id, ["s1", "s2"])
            self.assertEqual(values["s1"], [1.5, None, 3.0])
            self.assertEqual(values["s2"], ["Y", "N", None])
            stats = store.stats()
            self.assertEqual(stats["active"], 1)
            self.assertEqual(stats["cells"], 6)
            self.assertGreater(stats["bytes"], 0)
        finally:
            store.close()

    def test_compact_numeric_arrays_and_compressed_payloads_round_trip(self) -> None:
        store = SessionStore()
        values = array("d", (float(index % 7) if index != 10 else math.nan for index in range(2_000)))
        document = {
            "meta": {"sampleCount": len(values)},
            "series": [{"id": "s1", "kind": "numeric", "values": values}],
        }
        try:
            session_id = store.create(document)
            self.assertNotIn("values", document["series"][0])
            loaded = store.get_values(session_id, ["s1"])["s1"]
            self.assertEqual(len(loaded), 2_000)
            self.assertEqual(loaded[:8], [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 0.0])
            self.assertIsNone(loaded[10])
        finally:
            store.close()

    def test_unknown_session_is_rejected(self) -> None:
        from esxtop_perf.sessions import SessionError

        store = SessionStore()
        try:
            with self.assertRaises(SessionError):
                store.get_values("not-a-session", ["s1"])
        finally:
            store.close()

    def _document(self, value: float = 1.0) -> dict:
        return {
            "meta": {"sampleCount": 1},
            "series": [{"id": "s1", "kind": "numeric", "values": [value]}],
        }

    def test_protected_demo_session_never_evicts_a_user_session(self) -> None:
        with patch.dict(os.environ, {"ESXTOP_MAX_SESSIONS": "1"}):
            store = SessionStore()
            try:
                user_session = store.create(self._document())
                demo_session = store.create(self._document(2.0), protected=True)
                self.assertTrue(store.has(user_session))
                self.assertTrue(store.has(demo_session))
                replacement = store.create(self._document(3.0))
                self.assertTrue(store.has(replacement))
                self.assertTrue(store.has(demo_session))
                self.assertFalse(store.has(user_session))
            finally:
                store.close()

    def test_background_sweeper_removes_expired_sessions(self) -> None:
        with patch.object(config, "session_ttl_seconds", return_value=0.2), patch.object(
            config, "session_sweep_seconds", return_value=0.05
        ), patch.object(config, "session_max_lifetime_seconds", return_value=30):
            store = SessionStore()
            try:
                session_id = store.create(self._document())
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    with store._lock:
                        if session_id not in store._sessions:
                            break
                    time.sleep(0.05)
                with store._lock:
                    self.assertNotIn(session_id, store._sessions)
                self.assertFalse(store.has(session_id))
            finally:
                store.close()

    def test_absolute_lifetime_expires_an_active_session(self) -> None:
        with patch.object(config, "session_ttl_seconds", return_value=30), patch.object(
            config, "session_sweep_seconds", return_value=0.05
        ), patch.object(config, "session_max_lifetime_seconds", return_value=0.4):
            store = SessionStore()
            try:
                session_id = store.create(self._document())
                time.sleep(0.2)
                self.assertTrue(store.has(session_id, touch=True))
                time.sleep(0.3)
                self.assertFalse(store.has(session_id))
            finally:
                store.close()


if __name__ == "__main__":
    unittest.main()
