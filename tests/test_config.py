"""Configuration parsing tests."""
import importlib
import os
import unittest
from unittest import mock


class TestConfigParsing(unittest.TestCase):
    def test_invalid_values_fall_back_to_defaults(self):
        with mock.patch.dict(
            os.environ,
            {
                "MAX_CONCURRENT_DETECTIONS": "bad",
                "REQUEST_TIMEOUT_SECONDS": "bad",
                "MAX_BODY_SIZE": "",
            },
            clear=False,
        ):
            import backend.config as config_module

            reloaded = importlib.reload(config_module)
            self.assertEqual(reloaded.CONFIG.max_concurrent_detections, 2)
            self.assertEqual(reloaded.CONFIG.request_timeout_seconds, 15.0)
            self.assertEqual(reloaded.CONFIG.max_body_size, 10 * 1024 * 1024)

    def test_values_are_clamped(self):
        with mock.patch.dict(
            os.environ,
            {
                "MAX_CONCURRENT_DETECTIONS": "0",
                "TRACKER_IOU_THRESHOLD": "2",
                "REQUEST_TIMEOUT_SECONDS": "-1",
            },
            clear=False,
        ):
            import backend.config as config_module

            reloaded = importlib.reload(config_module)
            self.assertEqual(reloaded.CONFIG.max_concurrent_detections, 1)
            self.assertEqual(reloaded.CONFIG.tracker_iou_threshold, 1.0)
            self.assertEqual(reloaded.CONFIG.request_timeout_seconds, 0.1)

    def test_allowed_origins_are_split_and_trimmed(self):
        with mock.patch.dict(
            os.environ,
            {
                "ALLOWED_ORIGINS": " https://a.example , ,https://b.example ",
            },
            clear=False,
        ):
            import backend.config as config_module

            reloaded = importlib.reload(config_module)
            self.assertEqual(
                reloaded.CONFIG.allowed_origins,
                ("https://a.example", "https://b.example"),
            )


if __name__ == "__main__":
    unittest.main()
