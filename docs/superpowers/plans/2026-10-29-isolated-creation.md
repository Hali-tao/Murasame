# 隔离办公与代码创作实施计划

> **For agentic workers:** 使用 executing-plans 逐项实施；独立通知和原生动作工作线依据 dispatching-parallel-agents 分工，root统一验证提交。

**Goal:** 使自主活动具备真实办公文档和Python脚本的生成、运行/回读、独立审阅、可见展示和明确导出闭环。

**Architecture:** 沿用已有 Docker/XFCE/noVNC 隔离和生命周期；补齐 LibreOffice 与 code-server。用户指定活动类型和目标，绑定当前已验证模型，以独立 Worker 和 Critic 请求协作；确定性验证先核对真实文件、进程退出和输出，再让 Critic判断目标是否满足。允许一次有界修订，不用模型声称代替执行证据。产物先留容器，用户明确选择保存位置后才独占新建宿主文件。

**Tech Stack:** Electron/TypeScript、现有 ModelGateway、Docker Debian、LibreOffice、code-server、Python3。

**Spec:** 用户给定SRS FR28–30/UC10，docs/01-DECISIONS.md D15/D27/D16；用户已明确授权自主决定实施细节，无需逐项问答批准。本增量不修改原要求，也不将有界Python/文档路径宣称为通用办公编程全部完成。现有TigerVNC/noVNC沿用，原文指定KasmVNC的差异继续记录，不篡改需求。

## Global Constraints

- 默认不挂载宿主目录，不透传设备；联网由本次明确范围控制。代码在非root容器用户下运行，绝不回退宿主。
- 生成目标是用户主动输入的文字；不隐式读取用户文件。文本创作与截图外发分开控制，锁屏/免打扰/取消即时阻止后续调用。
- 同一次创作固定已验证模型；最多6次实际模型发送、2个候选（仅一次修订）、180秒；代码单次15秒及输出/文件大小限制。按现有生产ACTIVITY_LIMITS，原活动10分钟/12动作上限继续生效。
- 文档纯文本经XML转义进入ODF、用真实LibreOffice保存并独立读取ODT内容。代码固定Python入口，实际运行并比较声明输出；Critic必须看到原目标、候选和真实执行结果。
- 完成创作后保留隔离桌面供查看和导出；停止/期限清理容器，界面明确提示先导出。只对当前活动中核验过的产物提供导出，核对内容hash，保存对话框确认准确位置，拒绝覆盖已有文件。

## Review Focus

1. 取消/权限撤回时模型迟到不得写文件或追加成功。
2. 改默认模型不改变当前创作的Worker/Critic；实际发送次数包含schema重试。
3. 模型假称成功、非零退出、超时、输出过大、符号链接及文件被改不能通过验证。
4. 导出过程中活动已停止、候选已替换或目标已存在，不能导出错误文件或覆盖资料。
5. 旧镜像缺少办公/编辑器必须明确升级，不静默使用壳环境；界面失败后仍能停止和查看原因。

## 实施任务

- [x] 新增共享创作契约与容器内受控文件runner；先为真实回读/执行错误/越界/超时写红绿回归。
- [x] Docker镜像一次包含办公与编辑器，固定官方下载版本与SHA；独立tag构建、记录软件版本与隔离检查后才供新实现使用。
- [x] AutonomyService接创作/审阅/一次修订、预算/取消和产物导出；ModelService绑定模型，IPC显式数据校验与保存对话框。
- [x] 自主活动页开放办公和Python入口，显示阶段/真实产物/审阅/导出和清理范围；保持浏览/视频原链路。
- [x] 真实Docker独立合成文档/随机代码输入验证、取消/假成功/导出边界；真实Electron走完整UI/IPC，模型边界使用可控服务并明确区分外部模型质量。
- [ ] 独立审查重要问题闭环、全量verify/build/受影响E2E，记录产物与限制，再普通推送。若后续新增业务代码必须重新打包，保留第四轮检查点。

root所有权：isolation、autonomy服务、ModelService创作接口、core接线、shared契约/types/IPC、AutonomyPage、专属测试脚本。独立代理仅动原生模型线和通知store/组件，避免覆盖。测试TEMP/TMP使用项目previews/tmp。
