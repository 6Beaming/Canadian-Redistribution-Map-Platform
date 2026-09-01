from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


REUSABLE = Path(__file__).resolve().parents[1] / "reusable"
sys.path.insert(0, str(REUSABLE))

from map_release_utils import (  # noqa: E402
    canonical_pair,
    iter_feature_slices,
    simplify_line,
    vertex_id,
)


class MapReleaseUtilsTest(unittest.TestCase):
    def test_feature_scanner_preserves_utf8_byte_offsets(self):
        payload = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"DGUID": "a", "name": "Montréal"}, "geometry": None},
                {"type": "Feature", "properties": {"DGUID": "b", "text": "brace: }"}, "geometry": None},
            ],
        }
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        features = [json.loads(raw[start:end].decode("utf-8")) for start, end in iter_feature_slices(raw)]
        self.assertEqual(["a", "b"], [feature["properties"]["DGUID"] for feature in features])

    def test_simplification_preserves_endpoints(self):
        line = [(0.0, 0.0), (0.5, 0.001), (1.0, 0.0)]
        self.assertEqual([(0.0, 0.0), (1.0, 0.0)], simplify_line(line, 0.01))
        self.assertEqual(line, simplify_line(line, 0.0001))

    def test_pair_and_vertex_identity_are_order_independent(self):
        self.assertEqual(("a", "b"), canonical_pair("b", "a"))
        first = vertex_id("release", "a|b", "1.00000000,2.00000000")
        second = vertex_id("release", "a|b", "1.00000000,2.00000000")
        self.assertEqual(first, second)
        self.assertTrue(first.startswith("v1_"))


if __name__ == "__main__":
    unittest.main()
