# 对话与记忆可靠性增量报告

时间：2026-10-29 03:46（Asia/Shanghai）。基线：`e10f25fbe1ccf030d3bb303f62c9d8cff89e475f`。

仅改动两个生产文件与一个专属测试文件，未提交、未推送，未改共享接线或公共文档：

- `src/main/core/services/conversation-service.ts`
- `src/main/core/services/memory-service.ts`
- `tests/unit/conversation-memory-maturity.test.ts`（30项）

## 复现与改动

| 实际缺陷 | 修复及验证 |
| --- | --- |
| 同一会话的两个异步记忆提取乱序，后一句更正看不到前一句刚新增的事实，最终并存矛盾事实 | 按命名来源（生产为conversationId）串行判断与提交；其他来源仍可独立推进。排队时捕获generation，清除/停用/来源删除后尚未开始的模型判断也跳过。未设置来源的旧接口仍保留独立并发语义。 |
| 自然UPDATE将旧值永久写入suppressed_facts，用户后来明确改回旧偏好也不能保存 | 自然更正仅使旧版本失效；明确DELETE仍永久抑制。模型更正为已存在的有效值时仅使旧条目失效，保留已有正确条目的ID与来源。 |
| 重复ADD/无变化UPDATE被错误报告saved并触发变更通知 | 保留原状态引用并返回unchanged，既不伪造保存结果也不制造新版本。 |
| 手动编辑成另一条已有事实时产生重复有效条目 | 返回可操作的冲突错误，保留原有两条事实；检查发生在异步embedding之后，涵盖同时新增。 |
| 较早开始的手动ADD在用户较新DELETE后完成，清除抑制并复活删除内容 | 按归一化键记录成功提交版本，迟到ADD检测到期间事实状态改变后拒绝保存。新的明确手动ADD仍可重新保存用户主动提供的内容。 |
| 一条损坏vector_json会让load丢掉整库内存事实，之后正常保存用空快照覆盖整库 | 逐条隔离索引错误，验证JSON数组、512维、有限数字，事实正文照常读取。初始加载失败时禁止写回不完整快照，防止破坏已有数据。 |
| embedding stamp改变只清空内存向量，写入新stamp后第二次重启又读到旧向量 | 事务内同时清空持久向量并更新stamp；故障注入确认事务回滚，事实仍可查看，失败初始化不能继续写。stamp无法读取时所有内存向量不可用于语义召回。 |
| 在本地embedding缺失时保存的事实，在模型恢复后一直没有向量而无法语义召回 | 查询向量可用后，使用本地embedding重建缺失索引并保存。相同重建复用在途工作；完成时按事实ID与有效期核对，不能复活中途删除或更正的版本。 |
| 存储normalized_key与正文不一致时，删除抑制按错误键写入，下一次提取可复活 | 加载时以事实正文重新计算派生归一化键，验证跨重启删除和再次提取。 |
| 召回异常直接拒绝send而丢掉正常对话机会 | 以空召回继续对话，prompt明确本轮检索暂不可用且不能声称查到/不存在旧记忆，已存注入ID为空。 |
| onRecall观察回调异常被当成模型故障，错误标模型离线且不调用模型；onTurn异常吞掉已完成的桌宠回复 | 观察回调独立隔离；记忆提取启动异常不再影响历史落库与短句展示，也不会误报模型离线。 |

## 真实链路范围

- 使用真实`node:sqlite`文件数据库、实际001/002/003迁移、真实SQL事务及数据库触发器故障注入。每个数据库在独立临时目录，结束后删除。
- TEMP/TMP均为本进程的 `E:/Desktop/软件工程/murasame/previews/tmp`。未读写真实用户数据库。
- 仅模型边界使用受控fixture：对话回复、记忆结构化候选、本地embedding输出。未调用真实用户模型、未外发私人内容。
- 组合测试执行真实ConversationService→MemoryService→SQL链路：记住旧过敏事实→更正→后续问题→检索→实际模型请求prompt→持久的本轮注入ID；同时验证不相关正交向量条目不注入，关闭记忆后不再注入。
- 这是上下文构造、顺序、索引和持久化可靠性证据，不是外部provider回答质量或真实本地向量语义准确率评测。

## RED → GREEN证据

证据均在本报告同目录：

- `conversation-memory-maturity-red.log`：首批8个业务用例均失败。
- `conversation-memory-maturity-green.log`：首批修复后3文件57项通过。
- `conversation-memory-maturity-red-2.log`：缺失索引恢复、recall观察回调异常、提取异常吞掉展示，3项新增失败。
- `conversation-memory-maturity-green-2.log`：修复后3文件60项通过。
- `conversation-memory-maturity-red-3.log`：更正为已存在事实时旧值仍存在，失败后修复。
- `conversation-memory-maturity-red-4.log`：错误归一化键绕过删除抑制，失败后修复。
- `conversation-memory-maturity-red-5.log`：stamp不可读仍使用未验证向量，失败后修复。
- `conversation-memory-maturity-focused-final.log`：最终5文件 **87/87**通过，其中专属测试 **30/30**。
- `conversation-memory-maturity-typecheck-final.log`：Node与Web类型检查退出0。
- `conversation-memory-maturity-lint-final.log`：两个生产文件和专属测试ESLint退出0。
- 所有本域文件`git diff --check`通过。

## 全量验证中如实记录的问题

- 03:44:14：`npm test` **47文件561/561通过**，日志 `conversation-memory-maturity-full-suite.log`。
- 增加最后一个stamp故障回归后，03:44:58：全量 **561通过、1失败，共562**，日志 `conversation-memory-maturity-full-suite-final.log`。
- 唯一失败在非本域 `tests/unit/task-reliability-regression.test.ts:167`：`waits for cleanup before settling cancellation and never starts the command`，期望`aborted`，实际`timeout`；该例耗时2498ms。同一轮并行运行了typecheck和lint。
- 已即时通知主代理；未修改任务实现或降低该测试断言。不能把最后全量运行声称全部通过。主代理负责整合后全量verify/build/E2E。

## 边界与后续

- 未改调用权限、原始对话保存策略、活动会话隔离或既有删除generation边界。
- 初版按需重建阻塞首次召回，已被独立审查指出并按下方03:57补充修复；真实本地embedding大批量性能仍未实测，UI接线与验收由主代理负责。
- 同源提取保持异步，不阻塞对话回复；若前一条提取本身尚未完成，下一轮回复仍以最近对话上下文为依据，不能宣称所有记忆已同步保存。
- 初始数据库读取/索引stamp迁移失败时拒绝修改并保留可读取事实；修复底层存储后需重新初始化服务（通常重启应用）。
- 现有整库持久化方式未在本轮重构。未知类别等其他数据库结构性损坏没有被宣称全面修复。
- 未执行真实provider质量评测、未生成新安装包、未做本域Electron E2E。最终验收由主代理统筹。

本域改动已冻结，可由主代理直接整合与审查。

## 03:57 独立审查P2闭环：后台有界重建

独立审查确认初版`recall()`等待全部缺失向量串行重建：一个挂起的事实embedding会阻止当前对话进入gateway。这是本轮新增回归，不能用前面的正确性测试掩盖。

专属新增回归先观察到失败：后台事实embedding被gate阻塞时，ConversationService发送仍未完成。证据：`conversation-memory-background-red.log`。

随后只修改`memory-service.ts`与专属测试：

- 当前召回先使用已有向量/字面命中并返回真实`degraded`，不等待后台重建；本轮chat可立即继续。后台完成后后续召回能使用已修复向量。
- 后台single-flight，正常每16条让出事件循环并自动继续下一批，无需用户逐批发消息。
- 单条异步计算最多等待2秒；整轮30秒上限，成功部分逐条原子保存。超时/失败/关闭策略时停止，后续召回可继续剩余项。
- 底层embedding接口不可取消，因此超时后其迟到结果丢弃，底层未结束时不并发重试该挂起工作；若永不返回，需重启本地进程才能重新发起该索引工作。逻辑job和用户对话不会一直等待它。
- 清除、删除、来源删除或记忆策略改变立即取消后台逻辑job，并检查generation/有效ID。迟到结果不能复活事实或覆盖更正。
- 新增生产接口`indexStatus(): MemoryIndexStatus`、`subscribeIndex(listener)`。状态`idle/rebuilding/paused/failed`及`completed/total/message`均源于实际有效向量。索引更新只发独立进度事件，不触发事实订阅重读全部记忆。共享类型与UI/IPC接线由主代理实现。
- 失败/断点完成部分已真实写入SQLite，重启读取已有进度，仅重建缺失项。索引保存失败保持事实正文、返回failed，不提前声称ready。

最终本域测试 **41项**；相关5文件 **99/99通过**（含主代理同期新增的相关用例），日志`conversation-memory-background-focused.log`。Node类型检查退出0：`conversation-memory-background-typecheck.log`；本域ESLint退出0：`conversation-memory-background-lint.log`；diff检查通过。

新增确定性验收涵盖：当前回复不被gate挡住、字面召回在重建中可用、35条自动跨批继续、独立进度无事实事件、2秒挂起超时及迟到丢弃、不重叠重试、30秒整轮预算、失败与重启续建、clear/delete/policy/source取消、SQL写失败如实报告。旧30项仍保留，恢复验收改为后台完成后后续召回可见，未降低事实/删除/持久化断言。

未运行真实provider或真实用户数据库。该修复的整合全量verify/build/E2E仍由主代理负责。本域再次冻结，等待复核。
