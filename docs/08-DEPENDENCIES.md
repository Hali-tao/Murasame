# 依赖与模型来源

安装依赖使用仓库里的 `package-lock.json`，重复安装应使用 `npm ci`。

| 组件 | 来源 | 用途 | 许可记录 |
| --- | --- | --- | --- |
| Electron 44.9.1 | 官方发行包，校验和写在 README | 桌面壳 | 见 Electron 许可 |
| better-sqlite3-multiple-ciphers | npm | 加密本地库 | 见包内许可 |
| Windows UI Automation / Windows.Media.Ocr | 操作系统 | 屏幕感知 | 随 Windows 提供，不另嵌引擎 |
| nomic-embed-text | 用户本机 Ollama | 记忆向量 | 未打进安装包 |
| Whisper / Kokoro ONNX | 用户本机文件 | 语音 | 未打进安装包 |
| Debian bookworm 镜像 | Docker Hub | 隔离桌面 | 见 `docs/05-LICENSES.md` |

`npm audit` 的结果以执行时为准。高危项要记在这里，不能当成没有。当前没有把未审计的模型权重放进仓库。
