# 可靠性修复与验收记录

日期：2026-10-28。对照 10 月 27 日专项审查及 10 月 28 日剩余问题清单，修复应用执行链路；保留原始需求，不把此前的角色网页预览算作应用修复。

## 修复矩阵

| 问题 | 本轮改变 | 回归证据 |
| --- | --- | --- |
| C01 完整回答丢失 | 会话和历史保存完整回答，桌宠另取短台词 | conversation-memory-regression、pet-speech |
| C02 否定与讨论误触发操作 | 区分明确命令、否定、引用、回忆与状态追问 | teammates、conversation-memory-regression |
| C03 长对话中段事实丢失 | 带预算、来源的事实及约束摘录；原文仍可检索 | conversation-memory-regression |
| C04 并发与会话串线 | 同会话串行、不同会话各自保存；迟到回复不抢当前选择或草稿 | conversation-memory-regression、chat-conversation-regression |
| M01–M04 记忆清除、编辑和开关 | 在途版本校验、串行事务、唯一 ID、失败回滚、更正重建向量；召回和提取独立开关 | conversation-memory-regression |
| M05–M08 记忆呈现与召回 | 广播实际提取状态及实际注入 ID；清除关联轨迹；过滤失效项；低相关不强行召回 | conversation-memory-regression、core-memory-status-regression、chat-conversation-regression |
| P01–P02 关系和情绪 | 实时关系进入提示词，可查看/重置，换形象选择延续或新关系线；统一情绪实例、按时间衰减 | relationship-affect-regression |
| T01–T02 文件覆盖与目录越界 | 排他新增、真实路径与重解析点检查；逐项源/目标/哈希审批；批准后新增文件不纳入，原件变化即停止 | task-reliability-regression、task-graph-checkpoints-regression |
| T03–T04 宿主命令和图片绕权 | 终端使用独立容器与私有快照，批准后才导出；图片走统一工具开关、审批、独立哈希复读 | task-reliability-regression、task-graph-checkpoints-regression |
| T05–T07 结果虚报与丢失副作用 | 计划成功不计成果，Critic 使用独立只读上下文逐项核对；中途失败保留实际文件影响 | task-reliability-regression、p1-p3 |
| T08–T09 状态与取消 | 创建、审批、拒绝、停止及终态统一广播；取消贯穿异步工具和容器清理 | task-reliability-regression |
| T10 多智能体协同 | 真实步骤依赖图、独立任务单、每步目录/工具/时限/网络限制；独立只读步骤可并行 | task-graph-checkpoints-regression |
| T11–T13 澄清、恢复与审批 | 原任务补充信息继续；按检查点复核并跳过已完成步骤；一次批准只派发一步；暂存变化二次审批后导出，不重放命令 | task-graph-checkpoints-regression、E2E 文件整理 |
| T12 / UI06 工作表现 | 真实任务事件驱动动作及多张活动卡；完成状态收起记录本地保存，点击定位具体任务 | pet-activity、pet-geometry-regression、task-status |
| T14 技能提前沉淀 | 仅已完成并独立复读验证的固定程序沉淀；复用核对目录范围、工具和程序 ID | task-graph-checkpoints-regression |
| A01–A02 采集边界 | 原生窗口 ID 精确匹配，拒绝整屏回退；前后复核身份，隐藏/锁屏/撤权在实际发送前再检查 | screen-capture-regression、media-permission-regression |
| A03–A04 活动停止与清理 | 每次活动独立 ID 和取消信号；旧回调不能控制新活动；正常、失败、超限、退出统一核验清理 | autonomy-lifecycle-regression、真实容器验收 |
| A05 主进程阻塞 | Docker/UIA/OCR 异步化；文字与视觉模型队列分离；采集、队列、生成时间分别记录 | gateway-lanes-regression、screen-capture-regression |
| A06–A07 动作核验 | 解码真实图像，使用实际 DOM 文本、URL、动作预期检查；结果不明的副作用不自动重复 | autonomy-lifecycle-regression、p4-p6 |
| A08 视频只截帧 | 真实播放状态、媒体时钟、VTT 与容器音轨采样；记录覆盖区间，未看完报告部分完成 | 真实容器验收、autonomy-lifecycle-regression |
| A09–A10 活动回顾与视觉结论 | 开始时绑定有效会话，事实和时间线进入可追问记录；没有 OCR 文字也保留有效视觉结论 | core 集成、p4-p6、autonomy-lifecycle-regression |
| UI01 / UI03–UI05 桌宠几何和响应 | 窗口随缩放调整、保留脚底锚点、接受坐标 0、显示器变化恢复；真实闲置时钟与像素 alpha 命中 | pet-geometry-regression、pet-chat-side、E2E 140% |
| UI02 / UI07–UI08 页面与入口 | 记忆工具栏合理宽度、聊天上下文可折叠、任务澄清和成果入口、Enter/Space；引导直达模型验证与首轮对话 | E2E、chat-conversation-regression |
| 复核追加：语音生命周期 | 撤权立即停止麦克风；按住说话松手后不迟到启动；切会话/关闭播报丢弃旧合成；转写绑定本次录音和会话 | audio-lifecycle-regression、chat-conversation-regression |

测试文件在 `tests/unit/` 和 `tests/e2e/`。这些是实际业务回归，模型服务使用受控返回，不能据此声称真实模型回复质量已全面达标。

## 验证结果

- 完整自动化回归：32 个测试文件、399 项通过；包含原生加密数据库、本机模型协议夹具和真实临时目录联接。
- 类型检查、静态检查及生产构建通过；追溯矩阵 74/74 有测试映射。映射不等同于全部人工验收已完成。
- Electron 端到端 7/7 通过，最终结果记录在 `artifacts/reliability-2026-10-28/verification.json`：首次使用、模型验证、首轮流式对话、10 页导航、实际文件审批/整理、记忆更正/删除、140% 桌宠、三种预置、托盘、单实例。
- Docker 真机验收使用独立测试镜像、独立 profile 和合成 HTML/WebM/VTT。真实 PNG 解码为 1280×720，媒体时间推进，持久浏览器会话可连续读取；取得 3 秒、48,000 点的 16kHz 非静音音轨；本机现有 Whisper 实际完成识别。
- 自主活动生产服务完整运行：启动 → 导航 → 播放观察 → 如实报告部分完成 → 回调一次 → 停止并移除容器。该测试 profile 残留容器为 0。

容器实测还修复了单测未暴露的问题：旧镜像配置识别、Firefox 就绪等待、导航命令过早返回、浏览器会话 ID 失效、进程额度耗尽及无音频后端。隔离镜像 schema 为 2，旧镜像需重新构建。音频使用容器内 null sink，不挂载宿主麦克风或扬声器。

## 复测

```powershell
npm run typecheck
npm run lint
npm test
npm run trace
npm run test:e2e
```

Docker 实测脚本及依赖说明随 `npm run verify:isolation` 提供。测试只创建独立 profile 的临时容器，并检查退出清理；不清理其他应用或用户容器。

## 验收边界

1. 真实模型回答质量、中文记忆相似度阈值与长时间运行稳定性仍需要真实任务集和持续评价；本轮没有用假模型通过冒充质量评测。
2. 物理双屏不同 DPI、拔屏后的手动拖动、透明区域穿透到其他程序、真实麦克风/扬声器听感和新安装机器，仍按 `docs/06-TESTING.md` 现场验收。自动化已覆盖几何、窗口缩放、键盘及取消逻辑。
3. Whisper 合成音频实测有同音误字，只证明采样到本地识别链路可用。无字幕、跨域或受保护的视频可能不能读取音轨，界面须保留限制和实际覆盖区间。
4. 文件操作已防常规路径穿越、联接及批准后原件变化；没有把应用层检查宣称为抵御同机恶意进程高速替换目录的操作系统级隔离。
5. 绘图队友当前为已标注的程序示例 PNG；任意文生图、自主办公与通用自主编程不在本轮已交付能力内。奶龙 V2 连续网格/动作网页仍是角色预览，原生 Cubism 绑定、moc3 导出与应用内替换尚未完成。
6. 本轮交付源码和角色预览，不宣称已重新制作 Windows 安装包或完成签名、公开资源许可审核。

原始审查保留历史意义；本记录和机器可读验收结果描述本次修复后的状态，不删除尚待现场确认的要求。
