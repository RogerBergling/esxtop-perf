from __future__ import annotations

import math
import unittest
from array import array

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


if __name__ == "__main__":
    unittest.main()
