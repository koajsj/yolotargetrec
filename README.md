# YOLOv8 VPS 检测系统

基于 YOLOv8 的单服务目标检测 Web 应用,支持 **图片检测** 与 **摄像头实时检测**,面向 VPS 一键部署。

![tech](https://img.shields.io/badge/Python-3.10-3776AB) ![tech](https://img.shields.io/badge/FastAPI-0.115-009688) ![tech](https://img.shields.io/badge/YOLOv8-nano-FF6F00) ![tech](https://img.shields.io/badge/Docker-Ready-2496ED)

---

## 功能特性

- **图片检测**:支持拖拽 / 点击上传 PNG / JPG / WEBP,服务端推理后在原图上绘制检测框
- **摄像头实时检测**:浏览器调用摄像头,每 250 ms 抽帧回传,实时叠加检测框、类别、置信度、跟踪 ID
- **多用户隔离跟踪**:每个浏览器会话独立的 IoU 跟踪器(`X-Session-Id` 区分),多人同时使用不会串 ID
- **多类别颜色编码**:不同目标类别使用 12 色调色板区分,标签采用同色实心背景 + 圆角
- **检测结果汇总**:图片检测完成后,自动展示每个类别的数量分布
- **服务健康检查**:前端定时轮询 `/health`,状态用脉冲点胶囊显示(就绪 / 异常)
- **优雅降级**:摄像头模式下服务端过载会自动丢帧,跟踪失败回退为单帧编号
- **在途请求槽位**:默认 2 个检测槽位,槽位满时摄像头帧会主动丢弃,避免前端堆积
- **Docker 一键部署**:镜像内预下载 `yolov8n.pt`,容器自带健康检查,掉电自启

## 预览

打开 `http://YOUR_VPS_IP:8000` 即可使用,前端包含两个并列卡片:

- **图片检测**:上传区 + 统计(对象数 / 推理耗时)+ 类别汇总 + 画布
- **摄像头检测**:启停控制 + 实时 FPS / 耗时 + 状态指示 + 视频叠加层

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 模型 | Ultralytics YOLOv8 Nano (`yolov8n.pt`) |
| 后端 | FastAPI 0.115 + Uvicorn 0.30 |
| 图像处理 | OpenCV 4.10 (`opencv-python-headless`) |
| 数值计算 | NumPy 1.26 |
| 跟踪 | 自实现轻量 IoU 跟踪器(见 `backend/tracker.py`) |
| 前端 | 原生 HTML / CSS / JS,无构建步骤 |
| 部署 | Docker + Docker Compose,镜像内预热模型 |

## 环境要求

- Linux VPS(已在 Ubuntu 20.04 / 22.04 测试)
- Docker
- Docker Compose 插件或 `docker-compose`
- Git
- 浏览器需支持 `getUserMedia`(用于摄像头检测)

## 一键启动

```bash
git clone https://github.com/koajsj/yolotargetrec.git
cd yolotargetrec
bash run.sh
```

启动成功后访问:

```
http://YOUR_VPS_IP:8000
```

## 全新 Ubuntu VPS 完整步骤

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

## 常用命令

| 场景 | 命令 |
| --- | --- |
| 首次启动 / 重建 | `bash run.sh` |
| 快进拉取最新代码并重启 | `bash update.sh` |
| 仅重启容器 | `bash restart.sh` |
| 停止服务 | `bash stop.sh` |

`run.sh` 自动完成以下动作:

1. 检查 Docker 是否可用
2. 自动识别 `docker compose` 或 `docker-compose`
3. 构建镜像(首次会下载 YOLOv8 nano 权重,约 6 MB)
4. 后台启动容器
5. 轮询 `GET /health` 直到服务就绪
6. 打印访问地址

## 接口文档

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/` | 返回前端页面 |
| `GET` | `/style.css`、`/app.js` | 前端静态资源 |
| `GET` | `/health` | 健康检查,模型就绪时返回 `200`,未就绪时返回 `503` |
| `POST` | `/detect?mode=image` | 图片检测,请求体为图片二进制,返回 `boxes` |
| `POST` | `/detect?mode=camera` | 摄像头帧检测,JPEG 编码,支持 `dropped` 字段 |

`/detect` 返回结构(成功):

```json
{
  "ok": true,
  "boxes": [
    { "x": 120, "y": 80, "w": 200, "h": 150, "label": "person", "conf": 0.92, "track_id": 1 }
  ],
  "image_width": 1920,
  "image_height": 1080,
  "processing_ms": 42
}
```

`/detect` 丢帧响应(摄像头模式且服务端繁忙):

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

`active / max_concurrent` 在丢帧响应中始终返回,方便前端展示排队情况。

> 当 `mode=camera` 且服务端繁忙时,响应中 `dropped: true` 表示该帧被丢弃,前端会显示"Server busy, frame dropped"。

## 功能验证

1. 打开 `http://YOUR_VPS_IP:8000`,确认右上角状态显示为"Service is ready"
2. **图片检测**:点击"Select Image"或拖拽一张含有人 / 物的图片,确认画布上出现彩色检测框,标签包含类别、置信度与 ID
3. **摄像头检测**:点击"Start",授权浏览器摄像头权限,确认视频流上实时绘制检测框,右上 FPS 数值 > 0
4. 关闭页面后再次访问,容器应保持运行(Docker `restart: always`)

## 配置说明

- **服务端口**:`8000`(修改见 `docker-compose.yml`)
- **模型**:`yolov8n.pt`,在镜像构建阶段预下载,运行时不再联网
- **跨域来源**:`ALLOWED_ORIGINS` 留空时仅同源访问;若前后端分离,可传逗号分隔白名单
- **摄像头抽帧间隔**:由后端 `CAMERA_INTERVAL_MS` 下发给前端,默认 `250 ms`
- **抽帧最大宽度**:由后端 `CAMERA_MAX_WIDTH` 下发给前端,默认 `640 px`
- **跟踪策略**:`backend/tracker.py` 实现轻量 IoU 匹配 + per-session 注册表(`TrackerRegistry`);会话空闲 5 分钟后自动清理
- **健康检查**:`docker-compose.yml` 中每 15 s 探测一次 `/health`,失败 10 次标记为不健康
- **输入图像上限**:10 MB body,长边 ≤ 2560 px
- **检测槽位数**:`MAX_CONCURRENT_DETECTIONS`(默认 2)。这是允许同时在途的检测请求数,不是单模型内部的真实并行推理数;超出时摄像头帧会被丢弃并在前端状态栏显示 "Server busy: N/N slots in use"

## 项目结构

```
.
├── backend/
│   ├── app.py              # FastAPI 入口与路由
│   ├── yolo.py             # YOLOv8 推理封装
│   ├── tracker.py          # IoU 跟踪器 + TrackerRegistry
│   ├── utils.py            # 工具函数
│   └── requirements.txt    # Python 依赖
├── frontend/
│   ├── index.html          # 主页面
│   ├── style.css           # 样式
│   └── app.js              # 交互逻辑
├── tests/
│   └── test_tracker.py     # 跟踪器单元测试
├── .github/
│   └── workflows/
│       └── ci.yml          # GitHub Actions smoke test
├── Dockerfile              # 镜像构建
├── docker-compose.yml      # 容器编排
├── .dockerignore           # 构建上下文白名单
├── run.sh                  # 一键启动
├── update.sh               # 拉取更新并重启
├── restart.sh              # 重启容器
├── stop.sh                 # 停止容器
├── .gitignore              # 忽略 .claude/、__pycache__、node_modules 等
├── LICENSE                 # MIT
└── README.md
```

## 单元测试

```bash
python -m unittest discover -s tests -v
```

## 本地开发(无 Docker)

不通过 Docker 直接在主机上跑:

```bash
# 一次性安装依赖
python -m pip install -r backend/requirements.txt

# 启动后端
cd /path/to/yolo-vps
uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000

# 另一个终端,跑测试
python -m unittest discover -s tests -v
```

也可以 `pip install -e .` 把项目装为可编辑包,这样 `python -m backend.app` 在任意 CWD 都能跑。

## 持续集成

`.github/workflows/ci.yml` 在 push / PR 时跑:

1. `pip install -r backend/requirements.txt`
2. `python -c "import backend.app, ..."` 导入冒烟
3. `python -m unittest discover -s tests` 单元测试

GitHub Actions 因镜像体积问题**不会**真的下载 YOLOv8 权重(那一步留到 Docker 构建),仅验证代码可导入、可运行。

## 注意事项

- VPS 安全组 / 防火墙需放行 TCP `8000`
- 首次构建会从 PyPI 与 GitHub 拉取依赖,镜像约 1.5 GB
- 摄像头检测需要 HTTPS 或 `localhost` 才能调用 `getUserMedia`,裸 IP + HTTP 部署时浏览器可能拒绝授权
- 若要在公网域名下启用摄像头,请在反代(Nginx / Caddy)上配置 HTTPS
- 服务端过载时会主动丢帧(返回 `dropped: true`),不会因排队而拖慢 UI
- `update.sh` 仅允许干净工作区上的 fast-forward 更新,避免把部署机改成自动 merge 状态

## 路线图

- [ ] 模型热切换(`yolov8s/m/l`)
- [ ] 检测结果导出(JSON / CSV)
- [ ] WebSocket 推送替代轮询
- [ ] 多客户端同时摄像头检测
