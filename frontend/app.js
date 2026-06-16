const healthEl = document.getElementById("health");
const healthText = document.getElementById("healthText");
const imageInput = document.getElementById("imageInput");
const imageStatus = document.getElementById("imageStatus");
const imageCount = document.getElementById("imageCount");
const imageLatency = document.getElementById("imageLatency");
const imageSummary = document.getElementById("imageSummary");
const imageCanvas = document.getElementById("imageCanvas");
const imageEmpty = document.getElementById("imageEmpty");
const imageDrop = document.getElementById("imageDrop");
const imageCtx = imageCanvas.getContext("2d");

const startCameraBtn = document.getElementById("startCameraBtn");
const stopCameraBtn = document.getElementById("stopCameraBtn");
const cameraPill = document.getElementById("cameraPill");
const cameraStateText = document.getElementById("cameraStateText");
const cameraSubtitle = document.getElementById("cameraSubtitle");
const cameraHint = document.getElementById("cameraHint");
const cameraEmpty = document.getElementById("cameraEmpty");
const fpsText = document.getElementById("fpsText");
const cameraLatency = document.getElementById("cameraLatency");
const cameraVideo = document.getElementById("cameraVideo");
const cameraCanvas = document.getElementById("cameraCanvas");
const cameraStage = document.getElementById("cameraStage");
const cameraCtx = cameraCanvas.getContext("2d");

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d");
const IMAGE_PREVIEW_MAX_EDGE = 1600;

const runtimeConfig = {
  cameraIntervalMs: 250,
  cameraMaxWidth: 640,
  requestTimeoutMs: 15000,
  maxBodySize: 10 * 1024 * 1024,
  maxImageDimension: 2560,
};
const PALETTE = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#8b5cf6",
  "#14b8a6", "#eab308",
];
const colorCache = new Map();

const SESSION_STORAGE_KEY = "yoloSessionId";

const SESSION_ID = (() => {
  let id = "";
  try {
    id = sessionStorage.getItem(SESSION_STORAGE_KEY) || "";
  } catch (_) {}
  if (!id && typeof crypto !== "undefined" && crypto.randomUUID) {
    id = crypto.randomUUID();
  } else if (!id) {
    id = "s-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch (_) {}
  return id;
})();

let cameraStream = null;
let detectTimer = null;
let requestPending = false;
let fpsMarks = [];
let lastCameraBoxes = [];
let lastCameraSourceSize = { width: 0, height: 0 };
let imageAbort = null;
let cameraAbort = null;
let cameraRunId = 0;
let cameraOverlayFrame = 0;

function buildHeaders(extra) {
  return Object.assign({ "X-Session-Id": SESSION_ID }, extra || {});
}

function setCameraHint(text) {
  if (cameraHint) {
    cameraHint.textContent = text;
  }
}

function setMediaAspect(element, width, height) {
  if (!element || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return;
  }
  element.style.setProperty("--media-aspect", `${width} / ${height}`);
}

function clearMediaAspect(element) {
  if (element) {
    element.style.removeProperty("--media-aspect");
  }
}

function applyRuntimeConfig(config) {
  if (!config || typeof config !== "object") {
    return;
  }

  if (Number.isFinite(config.camera_interval_ms) && config.camera_interval_ms >= 100) {
    runtimeConfig.cameraIntervalMs = config.camera_interval_ms;
  }
  if (Number.isFinite(config.camera_max_width) && config.camera_max_width >= 64) {
    runtimeConfig.cameraMaxWidth = config.camera_max_width;
  }
  if (Number.isFinite(config.request_timeout_ms) && config.request_timeout_ms >= 100) {
    runtimeConfig.requestTimeoutMs = config.request_timeout_ms;
  }
  if (Number.isFinite(config.max_body_size) && config.max_body_size >= 1024) {
    runtimeConfig.maxBodySize = config.max_body_size;
  }
  if (Number.isFinite(config.max_image_dimension) && config.max_image_dimension >= 64) {
    runtimeConfig.maxImageDimension = config.max_image_dimension;
  }

  if (cameraSubtitle) {
    cameraSubtitle.textContent = `Capture one frame every ${runtimeConfig.cameraIntervalMs} ms and overlay boxes`;
  }
}

function fitContainRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const scale = Math.min(targetWidth / safeSourceWidth, targetHeight / safeSourceHeight);
  const width = safeSourceWidth * scale;
  const height = safeSourceHeight * scale;
  return {
    offsetX: (targetWidth - width) / 2,
    offsetY: (targetHeight - height) / 2,
    width,
    height,
  };
}

function resizeHiDPICanvas(canvas, ctx, width, height) {
  const displayWidth = Math.max(1, Math.round(width));
  const displayHeight = Math.max(1, Math.round(height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(displayWidth * dpr);
  const pixelHeight = Math.round(displayHeight * dpr);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: displayWidth, height: displayHeight };
}

function colorFor(label) {
  const key = String(label || "unknown");
  if (!colorCache.has(key)) {
    colorCache.set(key, PALETTE[colorCache.size % PALETTE.length]);
  }
  return colorCache.get(key);
}

function hexToRgba(hex, alpha) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) {
    return hex;
  }
  return `rgba(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}, ${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function formatLabel(box) {
  const conf = Number(box.conf || 0).toFixed(2);
  return `${box.label} ${conf} #${box.track_id}`;
}

function drawBoxes(ctx, boxes, scaleX, scaleY) {
  ctx.lineWidth = 2.5;
  ctx.font = '600 14px "Segoe UI", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

  boxes.forEach((box) => {
    const x = box.x * scaleX;
    const y = box.y * scaleY;
    const w = box.w * scaleX;
    const h = box.h * scaleY;
    const color = colorFor(box.label);
    const text = formatLabel(box);

    ctx.strokeStyle = color;
    ctx.fillStyle = hexToRgba(color, 0.18);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);

    const textWidth = ctx.measureText(text).width;
    const textY = y > 28 ? y - 8 : y + 20;
    const padX = 8;
    const padY = 5;
    const bgH = 22;
    const bgW = textWidth + padX * 2;

    ctx.fillStyle = color;
    roundRect(ctx, x, textY - bgH + padY, bgW, bgH, 5);
    ctx.fill();

    ctx.fillStyle = "#04130a";
    ctx.fillText(text, x + padX, textY - 4);
  });
}

function setStatus(target, text, variant, showSpinner = false) {
  const children = [];
  if (showSpinner) {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    children.push(spinner);
  }
  children.push(document.createTextNode(text));
  target.replaceChildren(...children);
  if (variant) {
    target.dataset.variant = variant;
  } else {
    delete target.dataset.variant;
  }
}

function setImageEmpty(empty) {
  imageEmpty.style.display = empty ? "" : "none";
}

function resetImageSummary() {
  imageSummary.replaceChildren();
}

function buildSummary(boxes) {
  const counts = new Map();
  boxes.forEach((box) => {
    const label = String(box.label || "unknown");
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  imageSummary.replaceChildren();
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([label, count]) => {
      const chip = document.createElement("span");
      chip.className = "chip";

      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = colorFor(label);

      const labelEl = document.createElement("span");
      labelEl.textContent = label;

      const countEl = document.createElement("span");
      countEl.className = "count";
      countEl.textContent = String(count);

      chip.append(swatch, labelEl, countEl);
      imageSummary.appendChild(chip);
    });
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), runtimeConfig.requestTimeoutMs);
  let cleanupAbort = null;

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      cleanupAbort = () => controller.abort();
      options.signal.addEventListener("abort", cleanupAbort, { once: true });
    }
  }

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json();
    return { response, data };
  } finally {
    window.clearTimeout(timeoutId);
    if (cleanupAbort && options.signal) {
      options.signal.removeEventListener("abort", cleanupAbort);
    }
  }
}

async function checkHealth() {
  try {
    const { response, data } = await fetchJsonWithTimeout("/health", { headers: buildHeaders() });
    applyRuntimeConfig(data && data.config);
    if (response.ok && data.ok) {
      healthEl.dataset.state = "ok";
      healthText.textContent = "Service is ready";
      return;
    }
    if (data && data.error) {
      healthEl.dataset.state = "error";
      healthText.textContent = `Service unavailable: ${data.error}`;
      return;
    }
  } catch (_) {}

  healthEl.dataset.state = "error";
  healthText.textContent = "Service unavailable";
}

async function detectImage(file) {
  if (!file) {
    return;
  }

  if (imageAbort) {
    imageAbort.abort();
  }
  const controller = new AbortController();
  imageAbort = controller;

  if (file.size > runtimeConfig.maxBodySize) {
    setStatus(
      imageStatus,
      `Image file too large (max ${Math.round(runtimeConfig.maxBodySize / (1024 * 1024))} MB)`,
      "error"
    );
    imageCount.textContent = "0";
    imageLatency.textContent = "--";
    resetImageSummary();
    setImageEmpty(true);
    if (imageAbort === controller) {
      imageAbort = null;
    }
    return;
  }

  setStatus(imageStatus, "Detecting image...", "loading", true);
  imageCount.textContent = "0";
  imageLatency.textContent = "--";
  resetImageSummary();
  setImageEmpty(false);

  let imageBitmap = null;
  let previewDrawn = false;
  try {
    imageBitmap = await createImageBitmap(file);
    if (controller.signal.aborted) {
      return;
    }

    const sourceWidth = imageBitmap.width;
    const sourceHeight = imageBitmap.height;
    const previewScale = Math.min(1, IMAGE_PREVIEW_MAX_EDGE / Math.max(sourceWidth, sourceHeight, 1));
    const previewWidth = Math.max(1, Math.round(sourceWidth * previewScale));
    const previewHeight = Math.max(1, Math.round(sourceHeight * previewScale));

    setMediaAspect(imageDrop, sourceWidth, sourceHeight);
    imageCanvas.width = previewWidth;
    imageCanvas.height = previewHeight;
    imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    imageCtx.drawImage(imageBitmap, 0, 0, previewWidth, previewHeight);
    previewDrawn = true;

    const { response, data } = await fetchJsonWithTimeout("/detect?mode=image", {
      method: "POST",
      headers: buildHeaders({ "Content-Type": file.type || "application/octet-stream" }),
      body: file,
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      return;
    }
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "detect_failed");
    }

    const boxes = Array.isArray(data.boxes) ? data.boxes : [];
    drawBoxes(
      imageCtx,
      boxes,
      previewWidth / Math.max(sourceWidth, 1),
      previewHeight / Math.max(sourceHeight, 1)
    );
    imageCount.textContent = String(boxes.length);
    imageLatency.textContent = `${data.processing_ms} ms`;
    buildSummary(boxes);
    setStatus(
      imageStatus,
      boxes.length
        ? `Done: detected ${boxes.length} object${boxes.length === 1 ? "" : "s"}`
        : "Done: no objects detected",
      boxes.length ? "ok" : "idle"
    );
  } catch (error) {
    if (error && error.name === "AbortError") {
      return;
    }

    let message = "Image detection failed";
    if (error && error.message === "image_too_large") {
      message = `Image too large (max ${runtimeConfig.maxImageDimension} px on the long side)`;
    } else if (error && error.message === "payload_too_large") {
      message = `Image file too large (max ${Math.round(runtimeConfig.maxBodySize / (1024 * 1024))} MB)`;
    } else if (error && error.message === "request_timeout") {
      message = "Image detection timed out";
    }

    setStatus(imageStatus, message, "error");
    if (!previewDrawn) {
      setImageEmpty(true);
    }
  } finally {
    if (imageBitmap && typeof imageBitmap.close === "function") {
      imageBitmap.close();
    }
    if (imageAbort === controller) {
      imageAbort = null;
    }
  }
}

function updateFps() {
  const now = performance.now();
  fpsMarks = fpsMarks.filter((mark) => now - mark < 1000);
  fpsText.textContent = fpsMarks.length.toFixed(1);
}

function drawCameraOverlay(boxes = lastCameraBoxes) {
  lastCameraBoxes = Array.isArray(boxes) ? boxes : [];
  if (!cameraStage) {
    return;
  }

  const stageWidth = cameraStage.clientWidth || 640;
  const stageHeight = cameraStage.clientHeight || 360;
  const displaySize = resizeHiDPICanvas(cameraCanvas, cameraCtx, stageWidth, stageHeight);
  cameraCtx.clearRect(0, 0, displaySize.width, displaySize.height);

  if (!lastCameraSourceSize.width || !lastCameraSourceSize.height) {
    return;
  }

  setMediaAspect(cameraStage, lastCameraSourceSize.width, lastCameraSourceSize.height);
  if (lastCameraBoxes.length === 0) {
    return;
  }

  const rect = fitContainRect(
    lastCameraSourceSize.width,
    lastCameraSourceSize.height,
    displaySize.width,
    displaySize.height
  );

  cameraCtx.save();
  cameraCtx.translate(rect.offsetX, rect.offsetY);
  drawBoxes(
    cameraCtx,
    lastCameraBoxes,
    rect.width / Math.max(lastCameraSourceSize.width, 1),
    rect.height / Math.max(lastCameraSourceSize.height, 1)
  );
  cameraCtx.restore();
}

function scheduleCameraOverlayDraw() {
  if (cameraOverlayFrame) {
    return;
  }
  cameraOverlayFrame = window.requestAnimationFrame(() => {
    cameraOverlayFrame = 0;
    drawCameraOverlay();
  });
}

function scheduleNextCameraFrame(delayMs = runtimeConfig.cameraIntervalMs) {
  if (!cameraStream) {
    return;
  }
  if (detectTimer) {
    window.clearTimeout(detectTimer);
  }
  detectTimer = window.setTimeout(() => {
    detectTimer = null;
    void sendCameraFrame();
  }, Math.max(0, delayMs));
}

function setCameraState(state, labelText, variant) {
  cameraPill.classList.remove("is-running", "is-warn", "is-error");
  if (state === "running") {
    cameraPill.classList.add("is-running");
  }
  if (state === "warn") {
    cameraPill.classList.add("is-warn");
  }
  if (state === "error") {
    cameraPill.classList.add("is-error");
  }
  cameraStateText.textContent = labelText;
  cameraPill.dataset.variant = variant || state;
}

async function sendCameraFrame() {
  if (!cameraStream || requestPending || cameraVideo.readyState < 2) {
    return;
  }

  const runId = cameraRunId;
  const startedAt = performance.now();
  requestPending = true;

  try {
    const videoWidth = cameraVideo.videoWidth || 640;
    const videoHeight = cameraVideo.videoHeight || 360;
    const targetWidth = Math.min(videoWidth, runtimeConfig.cameraMaxWidth);
    const targetHeight = Math.max(1, Math.round((videoHeight / Math.max(videoWidth, 1)) * targetWidth));

    captureCanvas.width = targetWidth;
    captureCanvas.height = targetHeight;
    captureCtx.drawImage(cameraVideo, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise((resolve) => {
      captureCanvas.toBlob(resolve, "image/jpeg", 0.8);
    });
    if (!blob) {
      return;
    }

    cameraAbort = new AbortController();
    const { response, data } = await fetchJsonWithTimeout("/detect?mode=camera", {
      method: "POST",
      headers: buildHeaders({ "Content-Type": "image/jpeg" }),
      body: blob,
      signal: cameraAbort.signal,
    });
    if (runId !== cameraRunId || !cameraStream) {
      return;
    }

    if (!response.ok || !data.ok || data.dropped) {
      let text = "Camera detection error";
      if (data && data.dropped) {
        text = data.active != null && data.max_concurrent != null
          ? `Server busy: ${data.active}/${data.max_concurrent} slots in use`
          : "Server busy, frame dropped";
      } else if (data && data.error === "request_timeout") {
        text = "Camera request timed out";
      }
      setCameraState("warn", text, "warn");
      cameraLatency.textContent = "--";
      return;
    }

    lastCameraSourceSize = {
      width: data.image_width || targetWidth,
      height: data.image_height || targetHeight,
    };
    drawCameraOverlay(Array.isArray(data.boxes) ? data.boxes : []);
    fpsMarks.push(performance.now());
    updateFps();
    cameraLatency.textContent = `${data.processing_ms} ms`;
    setCameraState("running", `Running: ${data.processing_ms} ms`, "running");
  } catch (error) {
    if (error && error.name === "AbortError") {
      return;
    }
    setCameraState("error", "Camera detection failed", "error");
    cameraLatency.textContent = "--";
  } finally {
    if (runId === cameraRunId) {
      cameraAbort = null;
    }
    requestPending = false;
    if (runId === cameraRunId && cameraStream) {
      const elapsedMs = performance.now() - startedAt;
      scheduleNextCameraFrame(runtimeConfig.cameraIntervalMs - elapsedMs);
    }
  }
}

async function startCamera() {
  if (cameraStream) {
    return;
  }

  if (!window.isSecureContext) {
    setCameraHint("Public VPS camera access requires HTTPS or localhost.");
    setCameraState("warn", "Camera requires HTTPS or localhost", "warn");
    return;
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    setCameraHint("This browser does not support the camera API.");
    setCameraState("error", "Camera API unavailable", "error");
    return;
  }

  try {
    cameraRunId += 1;
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    if (cameraVideo.videoWidth && cameraVideo.videoHeight) {
      setMediaAspect(cameraStage, cameraVideo.videoWidth, cameraVideo.videoHeight);
    }
    cameraEmpty.style.display = "none";
    setCameraHint("Click Stop to end live detection.");
    drawCameraOverlay([]);
    scheduleNextCameraFrame(0);
    startCameraBtn.disabled = true;
    stopCameraBtn.disabled = false;
    setCameraState("running", "Camera started", "running");
  } catch (error) {
    if (error && error.name === "NotAllowedError") {
      setCameraHint("Allow camera permission in the browser and try again.");
      setCameraState("error", "Camera permission denied", "error");
      return;
    }
    if (error && error.name === "NotFoundError") {
      setCameraHint("No camera device was found on this machine.");
      setCameraState("error", "No camera found", "error");
      return;
    }
    if (error && error.name === "NotReadableError") {
      setCameraHint("Another application may already be using the camera.");
      setCameraState("error", "Camera is busy", "error");
      return;
    }
    if (error && error.name === "SecurityError") {
      setCameraHint("Public VPS camera access requires HTTPS or localhost.");
      setCameraState("warn", "Camera requires HTTPS or localhost", "warn");
      return;
    }
    setCameraHint("Check browser permission and VPS HTTPS access, then retry.");
    setCameraState("error", "Cannot access camera", "error");
  }
}

function stopCamera() {
  cameraRunId += 1;
  if (detectTimer) {
    window.clearTimeout(detectTimer);
    detectTimer = null;
  }
  if (cameraOverlayFrame) {
    window.cancelAnimationFrame(cameraOverlayFrame);
    cameraOverlayFrame = 0;
  }
  if (cameraAbort) {
    cameraAbort.abort();
    cameraAbort = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  requestPending = false;
  fpsMarks = [];
  lastCameraBoxes = [];
  lastCameraSourceSize = { width: 0, height: 0 };
  updateFps();
  drawCameraOverlay([]);
  clearMediaAspect(cameraStage);
  cameraEmpty.style.display = "";
  setCameraHint("Click Start to begin live detection.");
  startCameraBtn.disabled = false;
  stopCameraBtn.disabled = true;
  cameraLatency.textContent = "--";
  setCameraState("off", "Camera is off", "off");
}

function preventDefaults(event) {
  event.preventDefault();
  event.stopPropagation();
}

["dragenter", "dragover"].forEach((eventName) => {
  imageDrop.addEventListener(eventName, (event) => {
    preventDefaults(event);
    imageDrop.classList.add("is-dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  imageDrop.addEventListener(eventName, (event) => {
    preventDefaults(event);
    imageDrop.classList.remove("is-dragover");
  });
});

imageDrop.addEventListener("drop", (event) => {
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    detectImage(file);
  }
});

imageInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  detectImage(file);
  event.target.value = "";
});

startCameraBtn.addEventListener("click", startCamera);
stopCameraBtn.addEventListener("click", stopCamera);
window.addEventListener("resize", scheduleCameraOverlayDraw);
window.addEventListener("beforeunload", stopCamera);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && cameraStream) {
    setCameraState("warn", "Page hidden, throttled", "warn");
  }
});

if (typeof ResizeObserver !== "undefined" && cameraStage) {
  const cameraResizeObserver = new ResizeObserver(() => {
    if (cameraStream || lastCameraBoxes.length) {
      scheduleCameraOverlayDraw();
    }
  });
  cameraResizeObserver.observe(cameraStage);
}

setImageEmpty(true);
if (!window.isSecureContext) {
  setCameraHint("Public VPS camera access requires HTTPS or localhost.");
}
checkHealth();
window.setInterval(checkHealth, 15000);
