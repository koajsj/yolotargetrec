import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from backend.config import CONFIG
from backend.tracker import TrackerRegistry, assign_fallback_track_ids
from backend.utils import decode_image_bytes
from backend.yolo import YOLODetector


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("yolo-vps")


BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

detector: Optional[YOLODetector] = None
detector_init_error = ""
tracker_registry = TrackerRegistry(
    idle_timeout_seconds=CONFIG.tracker_idle_timeout_seconds,
    tracker_max_missing=CONFIG.tracker_max_missing,
    tracker_iou_threshold=CONFIG.tracker_iou_threshold,
    tracker_distance_threshold=CONFIG.tracker_distance_threshold,
)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    global detector
    global detector_init_error

    try:
        detector = YOLODetector(
            model_name=CONFIG.model_name,
            image_size=CONFIG.image_size,
            max_concurrent=CONFIG.max_concurrent_detections,
        )
        detector_init_error = ""
    except Exception as exc:
        detector = None
        detector_init_error = str(exc)
        logger.exception("detector init failed: %s", exc)

    async def _cleanup_loop() -> None:
        while True:
            try:
                removed = await asyncio.to_thread(tracker_registry.cleanup)
                if removed:
                    logger.info("tracker cleanup removed %d stale sessions", removed)
            except Exception as exc:
                logger.warning("cleanup loop error: %s", exc)
            await asyncio.sleep(CONFIG.cleanup_interval_seconds)

    task = asyncio.create_task(_cleanup_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="YOLOv8 VPS App", lifespan=_lifespan)
if CONFIG.allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(CONFIG.allowed_origins),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error on %s: %s", request.url.path, exc)
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
    return FileResponse(
        FRONTEND_DIR / "style.css",
        media_type="text/css",
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/app.js")
async def script() -> FileResponse:
    return FileResponse(
        FRONTEND_DIR / "app.js",
        media_type="application/javascript",
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/health")
async def health() -> JSONResponse:
    model_ready = detector is not None and not detector_init_error
    return JSONResponse(
        {
            "ok": model_ready,
            "model": detector.model_name if detector else CONFIG.model_name,
            "device": detector.device if detector else "cpu",
            "busy": detector.is_busy() if detector else False,
            "active": detector.active_count if detector else 0,
            "max_concurrent": detector.max_concurrent if detector else CONFIG.max_concurrent_detections,
            "sessions": tracker_registry.count(),
            "config": {
                "camera_interval_ms": CONFIG.camera_interval_ms,
                "camera_max_width": CONFIG.camera_max_width,
                "request_timeout_ms": int(CONFIG.request_timeout_seconds * 1000),
                "max_body_size": CONFIG.max_body_size,
                "max_image_dimension": CONFIG.max_image_dimension,
            },
            "error": detector_init_error or None,
        },
        status_code=200 if model_ready else 503,
    )


async def _read_request_body(request: Request) -> tuple[bytes | None, JSONResponse | None]:
    content_length = request.headers.get("content-length", "").strip()
    if content_length:
        try:
            declared_size = int(content_length)
        except ValueError:
            return None, JSONResponse(status_code=400, content={"ok": False, "boxes": [], "error": "invalid_content_length"})
        if declared_size > CONFIG.max_body_size:
            return None, JSONResponse(status_code=413, content={"ok": False, "boxes": [], "error": "payload_too_large"})

    body = bytearray()
    try:
        async for chunk in request.stream():
            if not chunk:
                continue
            body.extend(chunk)
            if len(body) > CONFIG.max_body_size:
                return None, JSONResponse(status_code=413, content={"ok": False, "boxes": [], "error": "payload_too_large"})
    except Exception:
        logger.warning("read body failed", exc_info=True)
        return None, JSONResponse(status_code=400, content={"ok": False, "boxes": [], "error": "invalid_body"})

    if not body:
        return None, JSONResponse(status_code=400, content={"ok": False, "boxes": [], "error": "empty_body"})
    return bytes(body), None


@app.post("/detect")
async def detect(
    request: Request,
    mode: str = Query(default="image"),
    x_session_id: str = Header(default=""),
) -> JSONResponse:
    start_time = time.perf_counter()
    mode = (mode or "image").lower()
    client_host = request.client.host if request.client else "unknown"

    if mode not in {"image", "camera"}:
        return JSONResponse(status_code=400, content={"ok": False, "boxes": [], "error": "invalid_mode"})
    if detector is None:
        return JSONResponse(status_code=503, content={"ok": False, "boxes": [], "error": "model_unavailable"})

    body, body_error = await _read_request_body(request)
    if body_error is not None:
        return body_error

    image = decode_image_bytes(body)
    if image is None:
        return JSONResponse(status_code=400, content={"ok": False, "boxes": [], "error": "invalid_image"})

    source_height, source_width = image.shape[:2]
    if max(source_height, source_width) > CONFIG.max_image_dimension:
        return JSONResponse(
            status_code=413,
            content={
                "ok": False,
                "boxes": [],
                "error": "image_too_large",
                "max_dimension": CONFIG.max_image_dimension,
            },
        )

    if mode == "camera" and detector.is_busy():
        return JSONResponse(
            {
                "ok": True,
                "boxes": [],
                "dropped": True,
                "processing_ms": 0,
                "image_width": source_width,
                "image_height": source_height,
                "active": detector.active_count,
                "max_concurrent": detector.max_concurrent,
            }
        )

    try:
        raw_boxes, dropped = await asyncio.to_thread(
            detector.detect,
            image,
            CONFIG.request_timeout_seconds,
        )
    except TimeoutError:
        logger.warning("detect queue timeout (mode=%s) from %s", mode, client_host)
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
    except Exception as exc:
        logger.exception("detect failed: %s", exc)
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

    if dropped:
        return JSONResponse(
            {
                "ok": True,
                "boxes": [],
                "dropped": True,
                "processing_ms": 0,
                "image_width": source_width,
                "image_height": source_height,
                "active": detector.active_count,
                "max_concurrent": detector.max_concurrent,
            }
        )

    session_id = (x_session_id or "default").strip()[:128] or "default"
    try:
        if mode == "camera":
            tracker = tracker_registry.get(session_id)
            boxes = tracker.update(raw_boxes)
        else:
            boxes = assign_fallback_track_ids(raw_boxes)
    except Exception as exc:
        logger.warning("tracker failed for session=%s: %s", session_id, exc)
        boxes = assign_fallback_track_ids(raw_boxes)

    processing_ms = int((time.perf_counter() - start_time) * 1000)
    logger.info(
        "detect mode=%s session=%s client=%s boxes=%d ms=%d active=%d/%d",
        mode,
        session_id[:8],
        client_host,
        len(boxes),
        processing_ms,
        detector.active_count,
        detector.max_concurrent,
    )
    return JSONResponse(
        {
            "ok": True,
            "boxes": boxes,
            "processing_ms": processing_ms,
            "image_width": source_width,
            "image_height": source_height,
        }
    )
