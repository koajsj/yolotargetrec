"""Centralised configuration."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Tuple


logger = logging.getLogger("yolo-vps.config")


def _env_int(name: str, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("invalid integer for %s=%r, using default %r", name, raw, default)
        return default
    if minimum is not None and value < minimum:
        logger.warning("%s=%r is below minimum %r, clamping", name, value, minimum)
        value = minimum
    if maximum is not None and value > maximum:
        logger.warning("%s=%r is above maximum %r, clamping", name, value, maximum)
        value = maximum
    return value


def _env_float(name: str, default: float, minimum: float | None = None, maximum: float | None = None) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        logger.warning("invalid float for %s=%r, using default %r", name, raw, default)
        return default
    if minimum is not None and value < minimum:
        logger.warning("%s=%r is below minimum %r, clamping", name, value, minimum)
        value = minimum
    if maximum is not None and value > maximum:
        logger.warning("%s=%r is above maximum %r, clamping", name, value, maximum)
        value = maximum
    return value


def _env_csv(name: str) -> Tuple[str, ...]:
    raw = os.environ.get(name, "")
    if not raw.strip():
        return ()
    return tuple(part.strip() for part in raw.split(",") if part.strip())


@dataclass(frozen=True)
class Config:
    # ----- Detector -----
    model_name: str = os.environ.get("YOLO_MODEL", "yolov8n.pt")
    image_size: int = _env_int("YOLO_IMAGE_SIZE", 640, minimum=32)
    max_concurrent_detections: int = _env_int("MAX_CONCURRENT_DETECTIONS", 2, minimum=1, maximum=8)

    # ----- Request limits -----
    request_timeout_seconds: float = _env_float("REQUEST_TIMEOUT_SECONDS", 15.0, minimum=0.1)
    max_body_size: int = _env_int("MAX_BODY_SIZE", 10 * 1024 * 1024, minimum=1024)
    max_image_dimension: int = _env_int("MAX_IMAGE_DIMENSION", 2560, minimum=64)
    allowed_origins: Tuple[str, ...] = _env_csv("ALLOWED_ORIGINS")

    # ----- Tracker -----
    tracker_max_missing: int = _env_int("TRACKER_MAX_MISSING", 8, minimum=0, maximum=120)
    tracker_iou_threshold: float = _env_float("TRACKER_IOU_THRESHOLD", 0.3, minimum=0.0, maximum=1.0)
    tracker_distance_threshold: float = _env_float("TRACKER_DISTANCE_THRESHOLD", 90.0, minimum=1.0)
    tracker_idle_timeout_seconds: int = _env_int("TRACKER_IDLE_TIMEOUT_SECONDS", 300, minimum=30)

    # ----- Background jobs -----
    cleanup_interval_seconds: int = _env_int("CLEANUP_INTERVAL_SECONDS", 60, minimum=5)

    # ----- Camera capture (frontend constant for documentation) -----
    camera_interval_ms: int = _env_int("CAMERA_INTERVAL_MS", 250, minimum=100)
    camera_max_width: int = _env_int("CAMERA_MAX_WIDTH", 640, minimum=64)


CONFIG = Config()
