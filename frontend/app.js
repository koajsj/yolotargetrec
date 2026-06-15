// ---------- Element references ----------
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
const cameraStatus = document.getElementById("cameraStatus");
const cameraPill = document.getElementById("cameraPill");
const cameraStateText = document.getElementById("cameraStateText");
const cameraEmpty = document.getElementById("cameraEmpty");
const fpsText = document.getElementById("fpsText");
const cameraLatency = document.getElementById("cameraLatency");
const cameraVideo = document.getElementById("cameraVideo");
const cameraCanvas = document.getElementById("cameraCanvas");
const cameraCtx = cameraCanvas.getContext("2d");

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d");

// ---------- Constants ----------
const CAMERA_INTERVAL_MS = 250;
const PALETTE = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#8b5cf6",
  "#14b8a6", "#eab308",
];
const colorCache = new Map();

let cameraStream = null;
let detectTimer = null;
let requestPending = false;
let fpsMarks = [];
let lastCameraSourceSize = { width: 0, height: 0 };
let imageHasContent = false;

function colorFor(label) {
  if (!colorCache.has(label)) {
    const idx = colorCache.size % PALETTE.length;
    colorCache.set(label, PALETTE[idx]);
  }
  return colorCache.get(label);
}

// ---------- Health check ----------
async function checkHealth() {
  try {
    const response = await fetch("/health");
    const data = await response.json();
    if (data.ok) {
      healthEl.dataset.state = "ok";
      healthText.textContent = "Service is ready";
    } else {
      healthEl.dataset.state = "error";
      healthText.textContent = "Service error";
    }
  } catch (error) {
    healthEl.dataset.state = "error";
    healthText.textContent = "Service unavailable";
  }
}
setInterval(checkHealth, 15000);

// ---------- Label / boxes ----------
function formatLabel(box) {
  const conf = Number(box.conf || 0).toFixed(2);
  return `${box.label} ${conf} #${box.track_id}`;
}

function drawBoxes(ctx, boxes, scaleX, scaleY) {
  ctx.lineWidth = 2.5;
  ctx.font = '600 14px "Inter", "Segoe UI", sans-serif';
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

    // Rounded label background
    const padX = 8;
    const padY = 5;
    const bgH = 22;
    const bgW = textWidth + padX * 2;
    const radius = 5;
    ctx.fillStyle = color;
    roundRect(ctx, x, textY - bgH + padY, bgW, bgH, radius);
    ctx.fill();

    ctx.fillStyle = "#04130a";
    ctx.fillText(text, x + padX, textY - 4);
  });
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

function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function buildSummary(boxes) {
  const counts = new Map();
  boxes.forEach((b) => counts.set(b.label, (counts.get(b.label) || 0) + 1));
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  imageSummary.innerHTML = items
    .map(
      ([label, count]) =>
        `<span class="chip"><span class="swatch" style="background:${colorFor(label)}"></span><span>${label}</span><span class="count">${count}</span></span>`
    )
    .join("");
}

function setStatus(target, html, variant) {
  target.innerHTML = html;
  if (variant) target.dataset.variant = variant;
  else delete target.dataset.variant;
}

function setImageEmpty(empty) {
  imageHasContent = !empty;
  imageEmpty.style.display = empty ? "" : "none";
}

// ---------- Image detection ----------
async function detectImage(file) {
  if (!file) return;

  setStatus(imageStatus, '<span class="spinner"></span> Detecting image…', "loading");
  imageCount.textContent = "0";
  imageLatency.textContent = "—";
  imageSummary.innerHTML = "";
  setImageEmpty(false);

  try {
    const imageBitmap = await createImageBitmap(file);
    imageCanvas.width = imageBitmap.width;
    imageCanvas.height = imageBitmap.height;
    imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    imageCtx.drawImage(imageBitmap, 0, 0);

    const response = await fetch("/detect?mode=image", {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "detect_failed");
    }

    const boxes = data.boxes || [];
    drawBoxes(imageCtx, boxes, 1, 1);
    imageCount.textContent = String(boxes.length);
    imageLatency.textContent = `${data.processing_ms} ms`;
    buildSummary(boxes);
    setStatus(
      imageStatus,
      boxes.length
        ? `Done · detected <strong>${boxes.length}</strong> object${boxes.length === 1 ? "" : "s"}`
        : "Done · no objects detected",
      boxes.length ? "ok" : "idle"
    );
  } catch (error) {
    setStatus(imageStatus, "Image detection failed", "error");
    setImageEmpty(true);
  }
}

// ---------- Camera helpers ----------
function updateFps() {
  const now = performance.now();
  fpsMarks = fpsMarks.filter((mark) => now - mark < 1000);
  fpsText.textContent = fpsMarks.length.toFixed(1);
}

function resizeCameraCanvas() {
  const width = cameraVideo.clientWidth || 640;
  const height = cameraVideo.clientHeight || 360;
  cameraCanvas.width = width;
  cameraCanvas.height = height;
}

function drawCameraOverlay(boxes) {
  resizeCameraCanvas();
  cameraCtx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
  if (!lastCameraSourceSize.width || !lastCameraSourceSize.height) return;
  const scaleX = cameraCanvas.width / lastCameraSourceSize.width;
  const scaleY = cameraCanvas.height / lastCameraSourceSize.height;
  drawBoxes(cameraCtx, boxes, scaleX, scaleY);
}

function setCameraState(state, labelText, variant) {
  // state: "off" | "running" | "warn" | "error"
  cameraPill.classList.remove("is-running", "is-warn", "is-error");
  if (state === "running") cameraPill.classList.add("is-running");
  if (state === "warn") cameraPill.classList.add("is-warn");
  if (state === "error") cameraPill.classList.add("is-error");
  cameraStateText.textContent = labelText;
  cameraPill.dataset.variant = variant || state;
}

// ---------- Camera detection loop ----------
async function sendCameraFrame() {
  if (!cameraStream || requestPending || cameraVideo.readyState < 2) return;

  requestPending = true;
  try {
    const videoWidth = cameraVideo.videoWidth || 640;
    const videoHeight = cameraVideo.videoHeight || 360;
    const targetWidth = Math.min(videoWidth, 640);
    const targetHeight = Math.max(1, Math.round((videoHeight / videoWidth) * targetWidth));

    captureCanvas.width = targetWidth;
    captureCanvas.height = targetHeight;
    captureCtx.drawImage(cameraVideo, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise((resolve) => {
      captureCanvas.toBlob(resolve, "image/jpeg", 0.8);
    });
    if (!blob) return;

    const response = await fetch("/detect?mode=camera", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
    const data = await response.json();
    if (!response.ok || !data.ok || data.dropped) {
      const text = data && data.dropped ? "Server busy, frame dropped" : "Camera detection error";
      setCameraState("warn", text, "warn");
      cameraLatency.textContent = "—";
      return;
    }

    lastCameraSourceSize = {
      width: data.image_width || targetWidth,
      height: data.image_height || targetHeight,
    };
    drawCameraOverlay(data.boxes || []);
    fpsMarks.push(performance.now());
    updateFps();
    cameraLatency.textContent = `${data.processing_ms} ms`;
    setCameraState("running", `Running · ${data.processing_ms} ms`, "running");
  } catch (error) {
    setCameraState("error", "Camera detection failed", "error");
    cameraLatency.textContent = "—";
  } finally {
    requestPending = false;
  }
}

async function startCamera() {
  if (cameraStream) return;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    cameraEmpty.style.display = "none";
    resizeCameraCanvas();
    detectTimer = window.setInterval(sendCameraFrame, CAMERA_INTERVAL_MS);
    startCameraBtn.disabled = true;
    stopCameraBtn.disabled = false;
    setCameraState("running", "Camera started", "running");
  } catch (error) {
    setCameraState("error", "Cannot access camera", "error");
  }
}

function stopCamera() {
  if (detectTimer) {
    window.clearInterval(detectTimer);
    detectTimer = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  requestPending = false;
  fpsMarks = [];
  updateFps();
  cameraCtx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
  cameraEmpty.style.display = "";
  startCameraBtn.disabled = false;
  stopCameraBtn.disabled = true;
  cameraLatency.textContent = "—";
  setCameraState("off", "Camera is off", "off");
}

// ---------- Drag & drop ----------
function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
["dragenter", "dragover"].forEach((ev) =>
  imageDrop.addEventListener(ev, (e) => {
    preventDefaults(e);
    imageDrop.classList.add("is-dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  imageDrop.addEventListener(ev, (e) => {
    preventDefaults(e);
    imageDrop.classList.remove("is-dragover");
  })
);
imageDrop.addEventListener("drop", (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    detectImage(file);
  }
});

// ---------- Event bindings ----------
imageInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  detectImage(file);
  event.target.value = "";
});
startCameraBtn.addEventListener("click", startCamera);
stopCameraBtn.addEventListener("click", stopCamera);
window.addEventListener("resize", resizeCameraCanvas);
window.addEventListener("beforeunload", stopCamera);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && cameraStream) {
    setCameraState("warn", "Page hidden, throttled", "warn");
  }
});

setImageEmpty(true);
checkHealth();
