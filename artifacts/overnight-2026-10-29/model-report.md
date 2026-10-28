# 模型配置与传输可靠性增量

日期：2026-10-29，北京时间约 02:22。负责人：model_maturity。扩展任务完成后重新冻结，未 commit、未 push。

## 需求依据

- 已读 docs/00-OVERVIEW.md，docs/01-DECISIONS.md D-08、D-16。
- 已通过图像核对 SRS 原稿 page-09（印刷第6页 FR-24/25）、page-15（第12页 UC-08）、page-21（第18页 IF-08/09）、page-22（第19页 NFR-S01、NFR-R01/02）。
- 使用 systematic-debugging、test-driven-development、verification-before-completion 技能。所有新增 describe/it 标题带需求编号。

## 复现与根因

1. verify(id,input) 在发出验证请求前调用 save，立即替换旧地址、模型和密钥；认证失败仍返回 ok 的离线配置。加密或存储失败的 catch 也会把旧有效配置标为离线。验证期间普通对话已经可能使用未通过的新配置。
2. 探测结果分 markVerified、saveCapabilities 两次落盘；第二步失败会产生配置与能力证据不同步。异步探测迟到时也会覆盖较新的编辑状态。
3. setDefault 未检查已验证能力，未验证草稿可替换有效服务；D-16 规定的超过14天提示缺失。
4. 三种协议都接受远程 HTTP；URL 可夹带明文凭据；fetch 自动跟随重定向，可继续把请求体交给另一地址。
5. 错误脱敏仅按 sk-等模式猜测，服务商回显其他格式的真实密钥时泄漏。
6. testConnection 接受 HTTP200 空字符串，导致 text.chat 探测误报 verified。
7. SSE 读取忽略 error 帧，也不检查终止信号；“半句 + 错误”或提前关闭会作为完整成功回复保存，前端因此不能进入恢复草稿的失败分支。

首次业务红测 13/13 失败，补充异步迟到与真实本机 HTTP 重定向复现后 15/15 失败，均为预期断言失败。另单独复现旧探测时间切换无提示：1失败、19通过。

## 修复

- ModelRegistry.prepareVerification 生成内存候选，不改变已保存配置；ModelService 探测通过后单次写入配置、能力、状态、延迟。探测/加密/存储失败返回明确失败并保留旧配置。
- 验证版本防止旧请求覆盖后续保存或后续验证；提交读取当前 default 值，避免撤销用户同时进行的服务切换。
- 当前服务切换只接受在线且 text.chat 已验证的配置；过期探测复用时提示建议重新验证，不自动重测。
- 所有 adapter 共用保护连接校验：远程要求 HTTPS，明确的 localhost、127.0.0.1、[::1] 可用本机 HTTP；拒绝 URL 内嵌用户名密码。Ollama 通过共用 OpenAI adapter 继承检查。
- gateway 禁止自动跟随重定向，返回可操作说明；以实际请求密钥精确脱敏（包含 URL 编码及 JSON 转义形式），错误 cause 不携带未经清理的服务商原文。
- 空连接响应明确失败。SSE 检查错误帧和结束信号，提前结束不作为完整回复返回，并释放 reader。
- 真实 ConversationService + Gateway 回归覆盖空响应、断流、错误帧：失败不追加半句历史，同一用户原文重试后只写入一对完整消息。

## 文件

- src/main/model/registry.ts
- src/main/core/services/model-service.ts
- src/main/model/transport.ts
- src/main/model/adapters/openai-compatible.ts
- src/main/model/adapters/anthropic.ts
- src/main/model/gateway.ts（根代理已明确扩展授权，仅连接验证、重定向、脱敏边界，无公共调用接口变化）
- tests/unit/model-maturity-regression.test.ts（最终24例）
- src/main/core/services/task-service.ts（根代理追加授权，仅模型规划绑定；保留根侧审批/进度改动）
- src/main/core/murasame-core.ts（根代理追加授权，仅模型规划参数接线）
- tests/unit/task-model-binding.test.ts（8例）

## 验证

TEMP、TMP 均设为仓库 previews/tmp。

- 第一轮模型定向测试：4文件、31/31通过。
- 最终定向测试（02:20）：模型上述4文件 + task-model-binding、task-graph-checkpoints-regression、task-approval-recovery、task-reliability-regression，共8文件、80/80通过。
- 对上述模型生产文件和新增测试执行 eslint：通过。
- git diff --check -- src/main/model src/main/core/services/model-service.ts tests/unit/model-maturity-regression.test.ts：通过；只有仓库已有的 LF→CRLF 提醒。
- 02:08发起的 npm run typecheck：通过；后续只加过期时间提示，最终整体类型检查交根代理统一执行。
- 按根代理要求停止重复全量检查。此前全量 npm test：445通过、1失败，唯一失败 tests/unit/p4-p6.test.ts [CON-01] 形象能力清单与资源实际内容一致，naiwa 动作文件10个而 capability 暂为1（并行资源增量中间态）。此前全量 lint 的 nailong-motion-render.mjs 12项错误也已交形象代理处理。未修改这些文件。
- 本批未改渲染器，未启动额外 e2e，交根代理最终集成验证。

## 快照和剩余核对边界

- 已新增真实 Gateway 请求快照测试：旧请求发出后切换到另一已验证配置，旧请求仍使用原模型名、凭据并正常完成；新默认配置保持切换结果；公开返回数据不含密钥。
- 已有 task-graph-checkpoints-regression.test.ts 存在任务快照不随配置编辑变化、凭据不落任务记录的覆盖。未修改任务相关文件。
- 下述跨模块点经根代理追加授权后已经修复：TaskService.continueTask 非 resume 分支重新调用 planner，原实现每次取 getDefault，与原任务快照不符。详见下节。
- 草稿恢复 UI 路径为 ChatPage.sendInConversation：sendMessage 返回 null 时恢复原文。本批证明真实后端在空响应/断流/error帧时返回失败且可重试；没有声称新增了浏览器级草稿验收。
- 外部服务使用受控 HTTP/fetch 边界，未发送真实用户内容或真实服务商密钥；safeStorage 仍使用既有系统加密实现，测试仅在外部边界模拟其失败。

## 追加授权：D-08任务模型绑定

根代理在首轮冻结后明确授权 TaskService 和 MurasameCore 的模型绑定范围，未涉及审批/进度/Worker扩展。

业务红测：真实 MurasameCore + TaskService + 内存 SQLite（全部 schema 迁移）路径，8例中7失败、1通过；证明创建时两次读默认配置可能造成实际模型与快照不符、旧任务补充随全局切换迁移、同ID编辑污染旧任务、重启后旧地址修改/配置删除/key轮换均静默用新默认模型。已有检查点“继续”不重新规划原本通过。

修复：

- TaskPlanner 增加显式绑定参数，原有只接收goal的测试/调用仍兼容。
- 创建时只捕获一次模型对象并克隆；进程内按taskId保留包含凭据的配置克隆，只由主进程规划调用使用。
- 存储仍白名单保留id/name/provider/model/去用户名密码与query/hash的endpoint；另存随机salt和连接字段/凭据的单向指纹用于重启后核对，不存apiKey字段或明文key。
- 继续原任务的重新规划传入绑定对象；不再在MurasameCore planner内部读取当前默认配置。无原模型的任务不会因后来配置默认模型而自动迁移。
- 重启后按原profile id解析配置并核对指纹；原地址、模型、协议或key变更/删除/旧版本缺完整绑定证据时，明确失败、保留任务，不自动换服务或重发内容。
- 已核验检查点的继续只用保存的计划，不请求模型，不要求旧模型仍存在。
- 同一taskId仍沿用原模型；未新增“终态按新模型重规划”的产品行为。根侧若后续增加显式新计划版本，需要同时更新版本快照并保留旧Planner证据。

8例全部转绿，连同既有任务回归4文件45/45通过；与模型测试合并最终8文件80/80通过。针对修改文件eslint与diff检查通过，最终全量typecheck/lint/e2e交根代理统一执行。

## 追加复核：完成帧中的截断

根代理指出任意finish_reason可能误认完成后，补3条红测（OpenAI length、content_filter、Anthropic max_tokens）以及正常stop控制测试。3条都先实际失败，修复后转绿。

现仅正常结束原因可确认完成；length/content_filter或Anthropic max_tokens等异常结束即时返回“内容未完成”，即使其后带DONE/message_stop也不能掩盖。错误不拼接部分回复、原始错误帧或密钥。

## 仍交根侧的范围

- copy-image任务的过期/拒绝恢复元数据由根侧继续处理，本批未变更相关分支。它没有普通TaskPlan，不应在containerPath/hostPath丢失后走普通模型重规划。
- Planner审计当前使用固定callId，若未来支持同任务显式的新模型/新计划版本，需要独立revision/traceId，不能只覆盖execution却沿用旧declared。此次绑定始终沿用原模型，没有引入模型迁移。
