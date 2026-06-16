# YOLOv8 VPS 目标检测 Web 系统

一个可直接部署到 VPS 的单体 YOLOv8 Web 应用。

后端使用 `FastAPI + ultralytics YOLOv8 + OpenCV`，前端使用原生 `HTML / CSS / JavaScript`，支持：

- 图片上传检测
- 摄像头实时检测
- Canvas 绘制检测框
- 显示 `label / conf / track_id`
- 前端显示 FPS
- Docker 一键部署

## 技术栈

- Python 3.10
- FastAPI
- ultralytics YOLOv8
- OpenCV
- numpy
- uvicorn
- HTML / CSS / JavaScript
- Docker / Docker Compose

## 项目结构

```text
yolotargetrec/
├── backend/
│   ├── app.py
│   ├── config.py
│   ├── requirements.txt
│   ├── tracker.py
│   ├── utils.py
│   └── yolo.py
├── frontend/
│   ├── app.js
│   ├── index.html
│   └── style.css
├── tests/
│   ├── test_config.py
│   ├── test_detector_slots.py
│   └── test_tracker.py
├── .github/workflows/ci.yml
├── _lib.sh
├── docker-compose.yml
├── Dockerfile
├── LICENSE
├── pyproject.toml
├── README.md
├── restart.sh
├── run.sh
├── stop.sh
└── update.sh
```

说明：

- `backend/`：后端接口、检测、轻量跟踪
- `frontend/`：页面、交互、画框、FPS
- `tests/`：单元测试
- `run.sh / update.sh / restart.sh / stop.sh`：一键运维脚本
- `_lib.sh`：脚本共用函数

## 功能说明

### 1. 图片检测

- 上传 PNG / JPG / WEBP 图片
- 调用 `POST /detect?mode=image`
- 服务端返回统一结构
- 前端在 canvas 上绘制检测框和标签

### 2. 摄像头实时检测

- 浏览器调用 `getUserMedia`
- 每 `200-300ms` 抽一帧上传
- 调用 `POST /detect?mode=camera`
- 前端叠加绘制检测框
- 显示 FPS 和推理耗时

### 3. 轻量跟踪

- 后端内置简化版 tracking
- 使用 IoU + 中心点距离匹配
- 同一目标跨帧尽量保持 `track_id`
- tracking 异常时自动降级为每帧重新编号，不会导致服务崩溃

## 接口

### `GET /health`

返回服务状态。

示例：

```json
{
  "ok": true,
  "model": "yolov8n.pt",
  "device": "cpu",
  "busy": false,
  "active": 0,
  "max_concurrent": 2,
  "sessions": 1,
  "config": {
    "camera_interval_ms": 250,
    "camera_max_width": 640,
    "request_timeout_ms": 15000,
    "max_body_size": 10485760,
    "max_image_dimension": 2560
  },
  "error": null
}
```

### `POST /detect`

查询参数：

- `mode=image`
- `mode=camera`

请求体：

- 直接上传图片二进制内容

成功返回：

```json
{
  "ok": true,
  "boxes": [
    {
      "x": 120,
      "y": 80,
      "w": 200,
      "h": 150,
      "label": "person",
      "conf": 0.92,
      "track_id": 1
    }
  ],
  "processing_ms": 42,
  "image_width": 1920,
  "image_height": 1080
}
```

高负载丢帧返回：

```json
{
  "ok": true,
  "boxes": [],
  "dropped": true,
  "processing_ms": 0,
  "image_width": 640,
  "image_height": 360,
  "active": 2,
  "max_concurrent": 2
}
```

## 一键部署

### 方式一：已有 Docker 环境

```bash
git clone https://github.com/koajsj/yolotargetrec.git
cd yolotargetrec
bash run.sh
```

启动成功后访问：

```text
http://你的VPS公网IP:8000
```

### 方式二：全新 Ubuntu VPS

适用于 Ubuntu 20.04 / 22.04 / 24.04。

直接复制执行：

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
git clone https://github.com/koajsj/yolotargetrec.git
cd yolotargetrec
sudo bash run.sh
```

## 脚本说明

### 启动

```bash
bash run.sh
```

会自动执行：

1. 检查 Docker
2. 检查 Docker Compose
3. 构建镜像
4. 下载 `yolov8n.pt`
5. 启动容器
6. 等待 `/health` 就绪
7. 输出访问地址

### 更新

```bash
bash update.sh
```

如果当前用户还没有加入 `docker` 组，也可以先用：

```bash
sudo bash update.sh
```

会自动执行：

1. `git fetch origin main`
2. `git merge --ff-only`
3. 重新构建镜像
4. 重新启动容器
5. 等待健康检查通过

### 重启

```bash
bash restart.sh
```

### 停止

```bash
bash stop.sh
```

## VPS 访问与摄像头说明

### 图片检测

图片检测直接使用下面地址即可：

```text
http://你的VPS公网IP:8000
```

### 摄像头检测

现代浏览器对摄像头有安全限制：

- `localhost` 可以直接调用摄像头
- `HTTPS` 域名可以调用摄像头
- `HTTP + 公网 IP` 通常不能调用摄像头

这不是项目 bug，是浏览器安全策略。

因此：

- 只做图片检测：直接访问 `http://你的VPS公网IP:8000`
- 需要公网摄像头检测：请给 VPS 配置域名和 HTTPS，再访问该域名

## 推荐部署方式

### 1. 最快可用

- VPS 上直接执行 `bash run.sh`
- 先验证图片检测

### 2. 完整可用

- VPS 上执行 `bash run.sh`
- 再用 Nginx 或 Caddy 反向代理到 `127.0.0.1:8000`
- 给域名配置 HTTPS
- 最终通过 `https://你的域名` 使用摄像头检测

## 常用排查命令

查看容器：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

查看健康状态：

```bash
curl http://127.0.0.1:8000/health
```

## 本地开发

安装依赖：

```bash
python -m pip install -r backend/requirements.txt
```

启动服务：

```bash
uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
```

## 运行测试

```bash
python -m unittest discover -s tests -v
```

## 稳定性设计

- 固定使用 `yolov8n.pt`
- 固定 CPU 推理
- 推理尺寸固定 `640`
- 请求体大小受限
- 图片最大边受限
- 所有主要接口有异常保护
- 摄像头模式有限流与丢帧降级
- tracking 失败自动回退
- 每个浏览器标签页独立 `session_id`

## 验收步骤

### 1. 启动服务

```bash
bash run.sh
```

### 2. 浏览器访问

```text
http://你的VPS公网IP:8000
```

### 3. 验证图片检测

- 上传一张图片
- 页面显示检测框
- 页面显示标签、置信度、track_id

### 4. 验证摄像头检测

- 若在 `localhost` 或 `HTTPS` 环境
- 点击 `Start`
- 页面显示视频、检测框、FPS、耗时

### 5. 验证更新

```bash
bash update.sh
```

更新后再次访问页面，功能应保持正常。
