"""Unit tests for the lightweight IoU tracker."""
import unittest

from backend.tracker import SimpleTracker, _iou, assign_fallback_track_ids


class TestIoU(unittest.TestCase):
    def test_identical_boxes(self):
        a = {"x": 0, "y": 0, "w": 10, "h": 10}
        self.assertAlmostEqual(_iou(a, a), 1.0)

    def test_no_overlap(self):
        a = {"x": 0, "y": 0, "w": 10, "h": 10}
        b = {"x": 100, "y": 100, "w": 10, "h": 10}
        self.assertEqual(_iou(a, b), 0.0)

    def test_partial_overlap(self):
        a = {"x": 0, "y": 0, "w": 10, "h": 10}
        b = {"x": 5, "y": 5, "w": 10, "h": 10}
        # intersection 5x5 = 25, union 100+100-25 = 175
        self.assertAlmostEqual(_iou(a, b), 25 / 175)


class TestFallback(unittest.TestCase):
    def test_assigns_sequential_ids(self):
        boxes = [
            {"x": 0, "y": 0, "w": 10, "h": 10, "label": "a", "conf": 0.9},
            {"x": 5, "y": 5, "w": 10, "h": 10, "label": "b", "conf": 0.8},
        ]
        out = assign_fallback_track_ids(boxes)
        self.assertEqual([b["track_id"] for b in out], [1, 2])

    def test_empty(self):
        self.assertEqual(assign_fallback_track_ids([]), [])


class TestSimpleTracker(unittest.TestCase):
    def test_keeps_track_id_across_overlapping_frames(self):
        t = SimpleTracker(max_missing=3, iou_threshold=0.1, distance_threshold=200.0)
        first = t.update([{"x": 0, "y": 0, "w": 10, "h": 10, "label": "person", "conf": 0.9}])
        second = t.update([{"x": 1, "y": 1, "w": 10, "h": 10, "label": "person", "conf": 0.9}])
        self.assertEqual(first[0]["track_id"], second[0]["track_id"])

    def test_creates_new_id_for_distant_box(self):
        t = SimpleTracker(max_missing=3, iou_threshold=0.5, distance_threshold=20.0)
        first = t.update([{"x": 0, "y": 0, "w": 10, "h": 10, "label": "person", "conf": 0.9}])
        second = t.update([{"x": 500, "y": 500, "w": 10, "h": 10, "label": "person", "conf": 0.9}])
        self.assertNotEqual(first[0]["track_id"], second[0]["track_id"])

    def test_drops_stale_tracks(self):
        t = SimpleTracker(max_missing=2, iou_threshold=0.5, distance_threshold=20.0)
        first = t.update([{"x": 0, "y": 0, "w": 10, "h": 10, "label": "person", "conf": 0.9}])
        original_id = first[0]["track_id"]
        # Three empty frames should clear the track.
        t.update([])
        t.update([])
        t.update([])
        # New box at the same location should get a brand-new, monotonically
        # incremented id (never reuse IDs from cleared tracks).
        out = t.update([{"x": 0, "y": 0, "w": 10, "h": 10, "label": "person", "conf": 0.9}])
        self.assertNotEqual(out[0]["track_id"], original_id)
        self.assertGreater(out[0]["track_id"], original_id)

    def test_does_not_reuse_track_id_across_labels(self):
        t = SimpleTracker(max_missing=3, iou_threshold=0.1, distance_threshold=200.0)
        first = t.update([{"x": 0, "y": 0, "w": 10, "h": 10, "label": "person", "conf": 0.9}])
        second = t.update([{"x": 1, "y": 1, "w": 10, "h": 10, "label": "car", "conf": 0.9}])
        self.assertNotEqual(first[0]["track_id"], second[0]["track_id"])


if __name__ == "__main__":
    unittest.main()
