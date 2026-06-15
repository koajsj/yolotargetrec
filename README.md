# YOLOv8 VPS Web System

Single-service YOLOv8 web app for image detection and camera detection.

## Requirements

- Linux VPS
- Docker
- Docker Compose plugin or docker-compose
- Git

## One-click start

```bash
git clone https://github.com/koajsj/yolotargetrec.git
cd yolotargetrec
bash run.sh
```

After startup, open:

```text
http://YOUR_VPS_IP:8000
```

## Full commands for a clean Ubuntu VPS

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
newgrp docker
git clone https://github.com/koajsj/yolotargetrec.git
cd yolotargetrec
bash run.sh
```

## Daily commands

Start or rebuild:

```bash
bash run.sh
```

Update from GitHub and restart:

```bash
bash update.sh
```

Restart only:

```bash
bash restart.sh
```

Stop:

```bash
bash stop.sh
```

## What run.sh does

- Checks Docker availability
- Detects `docker compose` or `docker-compose`
- Builds image
- Starts container in background
- Waits for `GET /health` to return success
- Prints the access URL

## Verify features

1. Open `http://YOUR_VPS_IP:8000`
2. Upload an image and confirm boxes are drawn
3. Start the camera and confirm live boxes, labels, conf, track_id, and FPS

## Notes

- Service port is `8000`
- Model is fixed to `yolov8n.pt`
- In camera mode, overloaded requests are dropped instead of queued
- Tracking failure falls back to per-frame numbering
