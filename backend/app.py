import asyncio
import time
from pathlib import Path

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from backend.tracker import SimpleTracker, assign_fallback_track_ids
from backend.utils import decode_image_bytes
from backend.yolo import YOLODetector


BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
REQUEST_TIMEOUT_SECONDS = 15
MAX_BODY_SIZE = 10 * 1024 * 1024

app = FastAPI(title="YOLOv8 VPS App")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

detector = YOLODetector(model_name="yolov8n.pt", image_size=640)
camera_tracker = SimpleTracker(max_missing=8, iou_threshold=0.3, distance_threshold=90.0)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "ok": False,
            "boxes": [],
            "error": "internal_server_error",
        },
    )


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/style.css")
async def style() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "style.css", media_type="text/css")


@app.get("/app.js")
async def script() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "app.js", media_type="application/javascript")


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse(
        {
            "ok": True,
            "model": detector.model_name,
            "device": detector.device,
            "busy": detector.is_busy(),
        }
    )


@app.post("/detect")
async def detect(
    request: Request,
    mode: str = Query(default="image"),
) -> JSONResponse:
    start_time = time.perf_counter()
    mode = (mode or "image").lower()

    try:
        body = await request.body()
        if not body:
            return JSONResponse(status_code=400, content={"ok": False, "boxes": [], "error": "empty_body"})
        if len(body) > MAX_BODY_SIZE:
            return JSONResponse(status_code=413, content={"ok": False, "boxes": [], "error": "payload_too_large"})
    except Exception:
        return JSONResponse(status_code=400, content={"ok": False, "boxes": [], "error": "invalid_body"})

    image = decode_image_bytes(body)
    if image is None:
        return JSONResponse(status_code=400, content={"ok": False, "boxes": [], "error": "invalid_image"})

    source_height, source_width = image.shape[:2]

    if mode == "camera" and detector.is_busy():
        return JSONResponse(
            {
                "ok": True,
                "boxes": [],
                "dropped": True,
                "processing_ms": 0,
                "image_width": source_width,
                "image_height": source_height,
            }
        )

    try:
        raw_boxes = await asyncio.wait_for(
            asyncio.to_thread(detector.detect, image),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return JSONResponse(
            status_code=408,
            content={
                "ok": False,
                "boxes": [],
                "error": "request_timeout",
                "image_width": source_width,
                "image_height": source_height,
            },
        )
    except Exception:
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "boxes": [],
                "error": "detect_failed",
                "image_width": source_width,
                "image_height": source_height,
            },
        )

    try:
        boxes = camera_tracker.update(raw_boxes) if mode == "camera" else assign_fallback_track_ids(raw_boxes)
    except Exception:
        boxes = assign_fallback_track_ids(raw_boxes)

    processing_ms = int((time.perf_counter() - start_time) * 1000)
    return JSONResponse(
        {
            "ok": True,
            "boxes": boxes,
            "processing_ms": processing_ms,
            "image_width": source_width,
            "image_height": source_height,
        }
    )
