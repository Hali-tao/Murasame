# 本地屏幕文字识别

屏幕辅助优先使用 PP-OCRv5 mobile 检测/识别模型，通过 RapidOCR 3.10.0、ONNX Runtime 1.23.2 在 CPU 上运行。未安装或发生加载/推理异常时回退到 Windows OCR；识别没有文字不视为模型故障。用户取消或撤销屏幕权限时停止本次识别，不再启动备用识别。

## 使用与状态

「运行与隐私 → 本地文字识别」提供安装/重新安装、检查、进度、安装目录及备用状态。未安装不自动下载；首次联网下载约 141.1 MiB 的固定组件，界面按向上取整显示 142 MB。安装成功前使用 Windows OCR。模型安装后首次使用加载，设置页区分未安装、已安装待加载、正在安装、正在加载、可用、失败使用备用。屏幕辅助的识别文字区显示这一次实际使用的引擎。

安装位置是 `app.getPath('userData')/models/pp-ocrv5`，包括权重、Python 3.11.9 嵌入式运行时和依赖。没有系统 Python、pip 或硬编码 C 盘依赖。已有存储位置迁移会整体搬运该目录。安装包仅随附工作脚本和资源清单（`electron-builder.yml` 的 resources），权重由用户安装，不随源码提交。

## 安装与数据边界

- `resources/ocr-assets.json` 固定所有下载 URL、大小和 SHA-256，依赖 wheel 校验值与 PyPI 元数据核对，模型校验值与 RapidOCR 发布清单核对。所有 wheel 保留上游 dist-info/许可证；Python 运行时保留原始许可证。
- 在用户模型目录中新建独立暂存目录；逐文件校验、解包并实际加载两份模型成功后再替换现有安装。失败保留旧安装，清理本轮暂存内容。
- 嵌入式运行时只使用自身的 site-packages。明确指定 PP-OCRv5、mobile、CPU、模型绝对路径，禁用方向分类模型；不采用上游默认版本，不隐式下载其他模型或字典。
- 工作进程禁用网络连接，PNG 通过 stdin 传入，在内存中解码；OCR 结果通过 UTF-8 JSON 返回。不记录截图或 OCR 正文，不将图片写入磁盘。模型加载和识别有超时与取消信号，失败回退 Windows OCR。Windows OCR 同样通过内存接收图片。
- 预览只保留当前应用进程中的最近一张截图；新截图替换旧图，退出清除。OCR 本身不联网。屏幕辅助将识别文字通过文本 API 交给当前默认模型分析，截图不外发；不依赖图像能力或图片外发开关。文字请求与普通聊天使用相同的当前连接配置，不把可缺失/过期的能力探测记录作为额外请求门槛；缺少地址、模型名称、密钥或 API 失败会报告具体原因。屏幕文字不作为可执行指令，右侧仅展示 API 返回的回复。文字为空时不请求模型；超过 32000 字符时明确要求缩小选区，不静默截断。

## 2026-11-17 实测

使用真实 Windows OCR 和独立运行环境的 PP-OCRv5，四张由字体绘制的 1000×220 合成图片。没有 mock 识别输出。以下字符差异使用忽略空白后的编辑距离；该指标不验证代码缩进和语义，不代表通用准确率。

| 样例 | 预期字符数 | PP-OCRv5 字符差异 | Windows OCR 字符差异 |
| --- | ---: | ---: | ---: |
| 16 px 中文小字 | 36 | 0 | 2 |
| 22 px 中英混排 | 44 | 0 | 2 |
| 22 px 深色代码 | 93 | 1 | 22 |
| 18 px 深色中文/英文/数字 | 37 | 0 | 3 |

首轮 PP-OCRv5 每次约 1.6–1.8 秒（包含独立进程启动和模型加载）；Windows OCR 预热后约 0.4 秒。PP-OCRv5 在这组样例上字符差异较少，但通常更慢；不能据此宣称它对所有截图都更准确。极小、模糊、旋转文字仍可能识别不正确。代码识别结果需人工检查。

`node scripts/verify-screen-ocr.mjs` 从本地 `.ocr-build` 中的已下载资产完成安装（仍执行完整哈希校验）、测试上述样例、重新加载并输出 `.ocr-build/verification.json`。该目录不纳入 Git。该检查已在 D 盘含中文的自定义目录通过。

自动化覆盖：模型缺失、损坏、安装失败回滚与清理、并发安装合并、取消不回退、备用识别失败、实际 UI 安装与检查、框选后引擎标识。真实安装 UI 测试使用 `MURASAME_OCR_ASSET_CACHE` 显式指定已下载资产；默认测试不下载大文件。

## 上游资料

- [PaddleOCR PP-OCRv5](https://www.paddleocr.ai/v3.0.3/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5.html)
- [RapidOCR](https://github.com/RapidAI/RapidOCR) / [固定模型来源](https://www.modelscope.cn/models/RapidAI/RapidOCR)
- [RapidOCR 3.10.0](https://pypi.org/project/rapidocr/3.10.0/) / [ONNX Runtime 1.23.2](https://pypi.org/project/onnxruntime/1.23.2/)
- [Python 3.11.9](https://www.python.org/downloads/release/python-3119/)
