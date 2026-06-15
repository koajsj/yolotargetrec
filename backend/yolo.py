import threading
from typing import List, Tuple

import numpy as np
from ultralytics import YOLO


class YOLODetector:
    def __init__(
        self,
        model_name: str = "yolov8n.pt",
        image_size: int = 640,
        max_concurrent: int = 2,
    ) -> None:
        self.model_name = model_name
        self.image_size = image_size
        self.device = "cpu"
        self._max_concurrent = max(1, int(max_concurrent))
        self._active = 0
        self._slot_lock = threading.Lock()
        # A single YOLO instance is shared, so model.predict stays serialized.
        self._predict_lock = threading.Lock()
        self.model = YOLO(model_name)

        warmup = np.zeros((image_size, image_size, 3), dtype=np.uint8)
        self.model.predict(warmup, imgsz=image_size, device=self.device, verbose=False)

    def is_busy(self) -> bool:
        with self._slot_lock:
            return self._active >= self._max_concurrent

    @property
    def active_count(self) -> int:
        with self._slot_lock:
            return self._active

    @property
    def max_concurrent(self) -> int:
        return self._max_concurrent

    def detect(self, image: np.ndarray, wait_timeout: float | None = None) -> Tuple[List[dict], bool]:
        if image is None or image.size == 0:
            return [], False

        with self._slot_lock:
            if self._active >= self._max_concurrent:
                return [], True
            self._active += 1

        try:
            acquired = self._predict_lock.acquire(timeout=wait_timeout) if wait_timeout is not None else True
            if wait_timeout is None:
                self._predict_lock.acquire()
                acquired = True
            if not acquired:
                raise TimeoutError("predict_wait_timeout")
            try:
                return self._run_predict(image), False
            finally:
                self._predict_lock.release()
        finally:
            with self._slot_lock:
                self._active -= 1

    def _run_predict(self, image: np.ndarray) -> List[dict]:
        image_height, image_width = image.shape[:2]
        results = self.model.predict(
            image,
            imgsz=self.image_size,
            device=self.device,
            verbose=False,
        )

        if not results:
            return []

        result = results[0]
        names = result.names
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return []

        xyxy_list = boxes.xyxy.cpu().numpy()
        conf_list = boxes.conf.cpu().numpy()
        cls_list = boxes.cls.cpu().numpy().astype(int)

        output = []
        for xyxy, conf, cls_idx in zip(xyxy_list, conf_list, cls_list):
            x1, y1, x2, y2 = xyxy.tolist()
            x1 = min(max(0, int(round(x1))), max(image_width - 1, 0))
            y1 = min(max(0, int(round(y1))), max(image_height - 1, 0))
            x2 = min(max(0, int(round(x2))), image_width)
            y2 = min(max(0, int(round(y2))), image_height)
            x = x1
            y = y1
            w = max(0, x2 - x1)
            h = max(0, y2 - y1)
            if w <= 0 or h <= 0:
                continue
            if isinstance(names, dict):
                label = names.get(cls_idx, cls_idx)
            elif 0 <= cls_idx < len(names):
                label = names[cls_idx]
            else:
                label = cls_idx

            output.append(
                {
                    "x": x,
                    "y": y,
                    "w": w,
                    "h": h,
                    "label": str(label),
                    "conf": round(float(conf), 4),
                }
            )

        return output
