const healthText = document.getElementById("healthText");
const imageInput = document.getElementById("imageInput");
const imageStatus = document.getElementById("imageStatus");
const imageCanvas = document.getElementById("imageCanvas");
const imageCtx = imageCanvas.getContext("2d");

const startCameraBtn = document.getElementById("startCameraBtn");
const stopCameraBtn = document.getElementById("stopCameraBtn");
const cameraStatus = document.getElementById("cameraStatus");
const fpsText = document.getElementById("fpsText");
const cameraVideo = document.getElementById("cameraVideo");
const cameraCanvas = document.getElementById("cameraCanvas");
const cameraCtx = cameraCanvas.getContext("2d");

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d");

const CAMERA_INTERVAL_MS = 250;
let cameraStream = null;
let detectTimer = null;
let requestPending = false;
let fpsMarks = [];
let lastCameraSourceSize = { width: 0, height: 0 };

async function checkHealth() {
  try {
    const response = await fetch("/health");
    const data = await response.json();
    healthText.textContent = data.ok ? "Service is ready" : "Service error";
  } catch (error) {
    healthText.textContent = "Service unavailable";
  }
}

function formatLabel(box) {
  const conf = Number(box.conf || 0).toFixed(2);
  return `${box.label} ${conf} #${box.track_id}`;
}

function drawBoxes(ctx, boxes, scaleX, scaleY) {
  ctx.lineWidth = 2;
  ctx.font = "16px sans-serif";
  boxes.forEach((box) => {
    const x = box.x * scaleX;
    const y = box.y * scaleY;
    const w = box.w * scaleX;
    const h = box.h * scaleY;
    const text = formatLabel(box);

    ctx.strokeStyle = "#21c55d";
    ctx.fillStyle = "rgba(33, 197, 93, 0.18)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);

    const textWidth = ctx.measureText(text).width;
    const textY = y > 26 ? y - 8 : y + 20;
    ctx.fillStyle = "#21c55d";
    ctx.fillRect(x, textY - 16, textWidth + 12, 22);
    ctx.fillStyle = "#04130a";
    ctx.fillText(text, x + 6, textY);
  });
}

async function detectImage(file) {
  if (!file) {
    return;
  }

  imageStatus.textContent = "Detecting image...";
  try {
    const imageBitmap = await createImageBitmap(file);
    imageCanvas.width = imageBitmap.width;
    imageCanvas.height = imageBitmap.height;
    imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    imageCtx.drawImage(imageBitmap, 0, 0);

    const response = await fetch("/detect?mode=image", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "detect_failed");
    }

    drawBoxes(imageCtx, data.boxes || [], 1, 1);
    imageStatus.textContent = `Done: ${data.boxes.length} objects, ${data.processing_ms} ms`;
  } catch (error) {
    imageStatus.textContent = "Image detection failed";
  }
}

function updateFps() {
  const now = performance.now();
  fpsMarks = fpsMarks.filter((mark) => now - mark < 1000);
  fpsText.textContent = `FPS: ${fpsMarks.length.toFixed(1)}`;
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

  if (!lastCameraSourceSize.width || !lastCameraSourceSize.height) {
    return;
  }

  const scaleX = cameraCanvas.width / lastCameraSourceSize.width;
  const scaleY = cameraCanvas.height / lastCameraSourceSize.height;
  drawBoxes(cameraCtx, boxes, scaleX, scaleY);
}

async function sendCameraFrame() {
  if (!cameraStream || requestPending || cameraVideo.readyState < 2) {
    return;
  }

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
    if (!blob) {
      return;
    }

    const response = await fetch("/detect?mode=camera", {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
      },
      body: blob,
    });
    const data = await response.json();
    if (!response.ok || !data.ok || data.dropped) {
      cameraStatus.textContent = data && data.dropped ? "Server busy, frame dropped" : "Camera detection error";
      return;
    }

    lastCameraSourceSize = {
      width: data.image_width || targetWidth,
      height: data.image_height || targetHeight,
    };
    drawCameraOverlay(data.boxes || []);
    fpsMarks.push(performance.now());
    updateFps();
    cameraStatus.textContent = `Running: ${data.processing_ms} ms`;
  } catch (error) {
    cameraStatus.textContent = "Camera detection failed";
  } finally {
    requestPending = false;
  }
}

async function startCamera() {
  if (cameraStream) {
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    resizeCameraCanvas();
    detectTimer = window.setInterval(sendCameraFrame, CAMERA_INTERVAL_MS);
    startCameraBtn.disabled = true;
    stopCameraBtn.disabled = false;
    cameraStatus.textContent = "Camera started";
  } catch (error) {
    cameraStatus.textContent = "Cannot access camera";
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
  startCameraBtn.disabled = false;
  stopCameraBtn.disabled = true;
  cameraStatus.textContent = "Camera stopped";
}

imageInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  detectImage(file);
});

startCameraBtn.addEventListener("click", startCamera);
stopCameraBtn.addEventListener("click", stopCamera);
window.addEventListener("resize", resizeCameraCanvas);
window.addEventListener("beforeunload", stopCamera);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && cameraStream) {
    cameraStatus.textContent = "Page hidden, throttled detection continues";
  }
});

checkHealth();
