# YOLOv8 VPS Web 系统

## 环境要求

- Docker
- Docker Compose

## 启动

```bash
git clone <your-repo-url>
cd <your-repo-folder>
bash run.sh
```

启动完成后浏览器访问：

```text
http://你的VPS公网IP:8000
```

## 功能验证

1. 打开页面后顶部显示服务正常。
2. 在“图片检测”区域选择图片，可看到检测框、`label`、`conf`、`track_id`。
3. 在“摄像头实时检测”区域点击“开启摄像头”。
4. 浏览器允许摄像头权限后，系统会每 250ms 发送一帧到后端检测。
5. 页面会显示检测框、`label`、`conf`、`track_id` 和实时 FPS。

## 更新

```bash
bash update.sh
```

更新脚本会执行：

```bash
git pull origin main
docker-compose up --build -d
```

更新后可继续访问 `http://你的VPS公网IP:8000`，图片检测和摄像头检测仍可正常使用。

## 其他脚本

重启服务：

```bash
bash restart.sh
```

停止服务：

```bash
bash stop.sh
```
