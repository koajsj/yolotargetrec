import cv2
import numpy as np


def decode_image_bytes(data: bytes):
    if not data:
        return None
    np_bytes = np.frombuffer(data, dtype=np.uint8)
    if np_bytes.size == 0:
        return None
    return cv2.imdecode(np_bytes, cv2.IMREAD_COLOR)
