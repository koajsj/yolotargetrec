import logging
import math
import threading
import time

logger = logging.getLogger("yolo-vps.tracker")


def _center(box: dict) -> tuple[float, float]:
    return box["x"] + (box["w"] / 2.0), box["y"] + (box["h"] / 2.0)


def _iou(box_a: dict, box_b: dict) -> float:
    ax1, ay1 = box_a["x"], box_a["y"]
    ax2, ay2 = ax1 + box_a["w"], ay1 + box_a["h"]
    bx1, by1 = box_b["x"], box_b["y"]
    bx2, by2 = bx1 + box_b["w"], by1 + box_b["h"]

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)

    inter_w = max(0, inter_x2 - inter_x1)
    inter_h = max(0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h
    if inter_area <= 0:
        return 0.0

    area_a = box_a["w"] * box_a["h"]
    area_b = box_b["w"] * box_b["h"]
    union = area_a + area_b - inter_area
    if union <= 0:
        return 0.0
    return inter_area / union


def _distance(box_a: dict, box_b: dict) -> float:
    ax, ay = _center(box_a)
    bx, by = _center(box_b)
    return math.hypot(ax - bx, ay - by)


def assign_fallback_track_ids(detections: list[dict]) -> list[dict]:
    output = []
    for index, det in enumerate(detections, start=1):
        item = dict(det)
        item["track_id"] = index
        output.append(item)
    return output


class SimpleTracker:
    def __init__(self, max_missing: int = 8, iou_threshold: float = 0.3, distance_threshold: float = 90.0) -> None:
        self.max_missing = max_missing
        self.iou_threshold = iou_threshold
        self.distance_threshold = distance_threshold
        self.next_track_id = 1
        self.tracks: dict[int, dict] = {}
        self._lock = threading.Lock()

    def update(self, detections: list[dict]) -> list[dict]:
        with self._lock:
            try:
                return self._update(detections)
            except Exception:
                logger.warning("tracker update failed, falling back to per-frame ids", exc_info=True)
                return assign_fallback_track_ids(detections)

    def _update(self, detections: list[dict]) -> list[dict]:
        if not detections:
            self._age_tracks()
            return []

        updated = []
        used_tracks = set()

        for det in detections:
            best_track_id = None
            best_score = -1.0

            for track_id, track in self.tracks.items():
                if track_id in used_tracks:
                    continue
                if track["box"].get("label") != det.get("label"):
                    continue

                iou_score = _iou(det, track["box"])
                distance_score = _distance(det, track["box"])
                if iou_score < self.iou_threshold and distance_score > self.distance_threshold:
                    continue

                score = iou_score - (distance_score / max(self.distance_threshold, 1.0))
                if score > best_score:
                    best_score = score
                    best_track_id = track_id

            item = dict(det)
            if best_track_id is None:
                track_id = self.next_track_id
                self.next_track_id += 1
            else:
                track_id = best_track_id
                used_tracks.add(track_id)

            item["track_id"] = track_id
            updated.append(item)
            self.tracks[track_id] = {"box": dict(det), "missing": 0}

        matched_ids = {item["track_id"] for item in updated}
        stale_ids = []
        for track_id, track in self.tracks.items():
            if track_id in matched_ids:
                continue
            track["missing"] += 1
            if track["missing"] > self.max_missing:
                stale_ids.append(track_id)

        for track_id in stale_ids:
            self.tracks.pop(track_id, None)

        return updated

    def _age_tracks(self) -> None:
        stale_ids = []
        for track_id, track in self.tracks.items():
            track["missing"] += 1
            if track["missing"] > self.max_missing:
                stale_ids.append(track_id)

        for track_id in stale_ids:
            self.tracks.pop(track_id, None)


class TrackerRegistry:
    def __init__(
        self,
        idle_timeout_seconds: int = 300,
        tracker_max_missing: int = 8,
        tracker_iou_threshold: float = 0.3,
        tracker_distance_threshold: float = 90.0,
    ) -> None:
        self._idle_timeout = idle_timeout_seconds
        self._tracker_kwargs = {
            "max_missing": tracker_max_missing,
            "iou_threshold": tracker_iou_threshold,
            "distance_threshold": tracker_distance_threshold,
        }
        self._trackers: dict[str, tuple[SimpleTracker, float]] = {}
        self._lock = threading.Lock()

    def get(self, session_id: str) -> SimpleTracker:
        with self._lock:
            entry = self._trackers.get(session_id)
            now = time.time()
            if entry is None:
                tracker = SimpleTracker(**self._tracker_kwargs)
                self._trackers[session_id] = (tracker, now)
                return tracker
            tracker, _ = entry
            self._trackers[session_id] = (tracker, now)
            return tracker

    def cleanup(self) -> int:
        with self._lock:
            now = time.time()
            stale = [
                sid for sid, (_, ts) in self._trackers.items()
                if now - ts > self._idle_timeout
            ]
            for sid in stale:
                self._trackers.pop(sid, None)
            return len(stale)

    def count(self) -> int:
        with self._lock:
            return len(self._trackers)
