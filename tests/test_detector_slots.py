"""Unit tests for YOLODetector's slot management.

These tests exercise only the slot bookkeeping (active counter, busy flag,
slot acquisition) by passing a fake `model` object, so they don't need the
real YOLOv8 weights or even the ultralytics package to be importable in
the test environment.
"""
import sys
import threading
import time
import types
import unittest
from unittest import mock

import numpy as np


def _install_fake_ultralytics() -> None:
    """Inject a minimal `ultralytics.YOLO` stub so yolo.py imports cleanly."""
    if "ultralytics" in sys.modules:
        return
    fake = types.ModuleType("ultralytics")

    class _FakeYOLO:
        def __init__(self, *args, **kwargs):
            pass

        def predict(self, *args, **kwargs):
            return []

    fake.YOLO = _FakeYOLO
    sys.modules["ultralytics"] = fake


def _fake_image() -> np.ndarray:
    return np.zeros((4, 4, 3), dtype=np.uint8)


class TestDetectorSlots(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _install_fake_ultralytics()
        from backend import yolo as yolo_module
        cls.yolo_module = yolo_module

    def _make_detector(self, max_concurrent=2):
        return self.yolo_module.YOLODetector(
            model_name="fake.pt", image_size=64, max_concurrent=max_concurrent
        )

    def test_starts_idle(self):
        d = self._make_detector()
        self.assertFalse(d.is_busy())
        self.assertEqual(d.active_count, 0)
        self.assertEqual(d.max_concurrent, 2)

    def test_returns_dropped_when_full(self):
        d = self._make_detector(max_concurrent=1)
        # Hold the only slot via a private injection.
        with d._slot_lock:
            d._active = 1
        boxes, dropped = d.detect(_fake_image())
        self.assertTrue(dropped)
        self.assertEqual(boxes, [])
        self.assertTrue(d.is_busy())

    def test_multiple_requests_can_hold_slots_within_limit(self):
        d = self._make_detector(max_concurrent=2)
        entered = threading.Event()
        release = threading.Event()

        def slow_predict(image):
            entered.set()
            release.wait(timeout=1.0)
            return []

        with mock.patch.object(d, "_run_predict", side_effect=slow_predict):
            t1 = threading.Thread(target=lambda: d.detect(_fake_image()))
            t2 = threading.Thread(target=lambda: d.detect(_fake_image()))
            t1.start()
            self.assertTrue(entered.wait(timeout=1.0))
            t2.start()
            time.sleep(0.05)
            self.assertEqual(d.active_count, 2)
            self.assertTrue(d.is_busy())
            release.set()
            t1.join()
            t2.join()
            self.assertFalse(d.is_busy())
            self.assertEqual(d.active_count, 0)

    def test_third_call_dropped(self):
        d = self._make_detector(max_concurrent=2)
        entered = threading.Event()
        release = threading.Event()

        def slow_predict(image):
            entered.set()
            release.wait(timeout=1.0)
            return []

        with mock.patch.object(d, "_run_predict", side_effect=slow_predict):
            t1 = threading.Thread(target=lambda: d.detect(_fake_image()))
            t2 = threading.Thread(target=lambda: d.detect(_fake_image()))
            t1.start()
            self.assertTrue(entered.wait(timeout=1.0))
            t2.start()
            time.sleep(0.05)
            boxes, dropped = d.detect(_fake_image())
            self.assertTrue(dropped)
            self.assertEqual(boxes, [])
            release.set()
            t1.join()
            t2.join()

    def test_release_on_exception(self):
        d = self._make_detector(max_concurrent=1)

        def boom(image):
            raise RuntimeError("predict failed")

        with mock.patch.object(d, "_run_predict", side_effect=boom):
            with self.assertRaises(RuntimeError):
                d.detect(_fake_image())
        # Slot must be released even though predict raised.
        self.assertEqual(d.active_count, 0)
        self.assertFalse(d.is_busy())

    def test_wait_timeout_releases_slot(self):
        d = self._make_detector(max_concurrent=2)
        d._predict_lock.acquire()
        try:
            with self.assertRaises(TimeoutError):
                d.detect(_fake_image(), wait_timeout=0.01)
        finally:
            d._predict_lock.release()
        self.assertEqual(d.active_count, 0)
        self.assertFalse(d.is_busy())

    def test_zero_or_negative_max_clamps_to_one(self):
        d = self._make_detector(max_concurrent=0)
        self.assertEqual(d.max_concurrent, 1)
        d2 = self._make_detector(max_concurrent=-5)
        self.assertEqual(d2.max_concurrent, 1)


if __name__ == "__main__":
    unittest.main()
