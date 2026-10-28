# 隔离桌面与视频运行验收

本脚本验证生产 Docker/AutonomyService/BiDi/PNG/视频字幕/媒体音轨路径，使用生成的合成视频、字幕和语音。它不读取用户屏幕、麦克风、对话或数据库，也不发送图片给模型服务。

## 前提

- Windows；已安装项目依赖、Docker Desktop 并启动 Linux 引擎。
- FFmpeg 可执行文件；Windows `System.Speech` 用于把固定合成句子写入 WAV 文件，不会播放到宿主扬声器。
- 当前隔离镜像，含 `io.murasame.isolation.schema=2`、Firefox BiDi 配置和容器内 PulseAudio null sink。旧镜像会明确拒绝启动；可先使用应用的“开始活动”准备新版镜像，或在项目根目录执行 `docker build -t murasame-isolation:local isolation`。
- 已有本地 Whisper 文件。脚本禁止远程下载模型；模型不完整时本地识别项失败，结果说明缺失文件。

## 运行

在项目根目录执行：

```powershell
npm run verify:isolation
```

默认镜像为 `murasame-isolation:local`。可选择已有的专用测试镜像：

```powershell
$env:VERIFY_ISOLATION_IMAGE = 'murasame-isolation:verify-20261028'
$env:VERIFY_FFMPEG = (Get-Command ffmpeg).Source
npm run verify:isolation
```

模型路径有两种选择：

```powershell
# 指定应用用户目录；脚本仅读取其中 models 子目录，不加载对话或数据库。
$env:MURASAME_USER_DATA = 'E:\synthetic-app-data'

# 或直接指定独立的模型根目录，优先于上面的用户目录。
# 此目录下面应有 whisper/config.json、whisper/onnx/... 等已安装文件。
$env:VERIFY_MODEL_DIR = 'E:\local-models'
```

未设置模型路径时，读取 `%APPDATA%\murasame-desktop\models` 中的 Whisper 文件。模型权重不会复制到容器。

## 检查内容与输出

输出保存在 `previews/isolation-live/`：生成的 `fixtures/`、合成隔离桌面 PNG 和 `results.json`。脚本只把 `fixtures/` 复制到容器。

检查包括独立 owner/profile/session 标签、桌面和 Firefox 就绪、真实合成页面播放、持久 BiDi context、完整 PNG 解码、媒体时间推进、VTT 时间轴、视频自身音轨的 16 kHz PCM 采集、本地 Whisper 调用，以及真实 AutonomyService 的开始→观看→如实部分完成→回调→容器退出。模型画面描述在验收中是受控本地回调，因此本脚本不验证云模型理解质量。

音轨来自容器网页的视频媒体流，经过容器内 null sink；没有挂载宿主音频设备，也没有使用宿主麦克风。合成字幕应精确匹配；语音识别文本需要和固定合成句子人工比较。同音字错误不会被改写成正确答案；非空识别只证明本地识别调用完成。

每次执行生成唯一验收 profile，不调用应用的全量恢复清理，不处理其他 profile 的容器。测试不发布 VNC/调试/桥接端口，不挂载宿主目录，并在 `finally` 删除其创建的确切容器 ID；最后检查本次 profile 无残留。专用测试镜像可以保留以便重测。

所有项目成功时退出码为 0；播放、PCM、依赖或清理失败时为非零，并在结果中保留真实原因。视频只观察了一段时，`partial` 是预期的诚实结果，不等于播放或清理失败。

原始运行日志包含本机路径、容器进程和调试信息，分享验收结果时应使用精简的合成结果摘要。
