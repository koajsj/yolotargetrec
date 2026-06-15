import threading
from typing import List

import cv2
import numpy as np
from ultralytics import YOLO


class YOLODetector:
    def __init__(self, model_name: str = "yolov8n.pt", image_size: int = 640) -> None:
        self.model_name = model_name
        self.image_size = image_size
        self.device = "cpu"
        self._lock = threading.Lock()
        self.model = YOLO(model_name)

        warmup = np.zeros((image_size, image_size, 3), dtype=np.uint8)
        self.model.predict(warmup, imgsz=image_size, device=self.device, verbose=False)

    def is_busy(self) -> bool:
        return self._lock.locked()

    def detect(self, image: np.ndarray) -> List[dict]:
        original_height, original_width = image.shape[:2]
        resized = cv2.resize(image, (self.image_size, self.image_size), interpolation=cv2.INTER_LINEAR)
        scale_x = original_width / float(self.image_size)
        scale_y = original_height / float(self.image_size)

        with self._lock:
            results = self.model.predict(
                resized,
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
            x = max(0, int(round(x1 * scale_x)))
            y = max(0, int(round(y1 * scale_y)))
            w = max(0, int(round((x2 - x1) * scale_x)))
            h = max(0, int(round((y2 - y1) * scale_y)))
            if w <= 0 or h <= 0:
                continue

            output.append(
                {
                    "x": x,
                    "y": y,
                    "w": w,
                    "h": h,
                    "label": str(names.get(cls_idx, cls_idx)),
                    "conf": round(float(conf), 4),
                }
            )

        return output
