# 第五轮创作 UI / IPC 独立功能审查

时间：2026-10-29 05:17（北京时间）。本轮只读生产文件；未构建 out、未运行全量、未改生产代码。

## 结论

原先发现的三处正常使用缺陷已由 root 修复，并经独立探针复核。当前审查范围内未发现阻止交付的问题。

1. **创作重入恢复（原 P2）**：原页面默认回到「浏览网页」，运行时下拉框锁定，办公/Python 表单、目标和真实联网范围无法恢复。现 shared/status 带 kind/goal/allowNetwork，页面从实际状态恢复；执行阶段仍显示真实进度并禁用冲突操作。
2. **准备阶段离页后停止（原 P2）**：原页面只按 running 轮询和启用停止，准备阶段 running=false，重入后无法停止且不会自动跟进启动。现 IPC 对镜像准备返回 preparing/canStop/busy；页面在 canStop/serverBusy 时继续轮询、显示准备原因、保留停止入口，进入活动后恢复实际类型。
3. **清理失败重试（原 P1）**：后端容器未确认清理时 running=false，但仍要求重试；原停止按钮因此被禁用，之后新活动又被现存容器阻止。现 service.status 从实际容器/生命周期计算 canStop，页面展示失败原因并允许继续停止；成功清理后才关闭入口。

同时复核 root 新修复的 busy 回执：真实 AutonomyService 在候选生成等待期间状态为 busy=true；produce 完成返回的状态为 busy=false 且附 ready 产物，不需要等待下一次5秒轮询才能导出。

## 独立验证

最终 `final-results.txt`：**2 文件、8 项全部通过**，Vitest 运行1.67秒。

- 用真实 React AutonomyPage，控制正式 API 边界返回的独立状态；测试恢复类型/目标/联网范围、执行进度、准备后自动转运行、停止失败重试、原生保存取消仍保留产物、卸载清理轮询。
- 用真实 AutonomyService，控制 Docker 命令边界和 Worker/Critic 返回；测试执行期间与完成回执的 busy 状态，以及删除容器第一次失败、第二次成功时 canStop 的变化。
- 后端探针保留未传 kind 的旧 start 调用，实际成功且默认为 manual。
- 静态核对 shared/types 与 preload/IPC：旧 start 参数继续可选，新增元数据均可选，旧频道和方法没有移除或更名；create/export 的参数与 Result 结构前后匹配，保存取消返回显式说明而不销毁产物。

这些探针是界面/状态契约测试，不声称执行过真实 Docker 或外部模型；真实容器与 Electron 完整验收由 root 执行。没有访问用户资料或调用实际外部模型。TEMP/TMP 指向 previews/tmp。

## 证据文件

- `autonomy-ui-review.test.ts`：6项真实组件探针。
- `autonomy-status-review.test.ts`：2项真实服务状态探针。
- `vitest.config.ts`：仅收集本目录独立测试，不运行全量测试。
- `initial-results.txt`：初始5项中3失败、2通过；审查与root修复并行进行，初始探针按旧契约构造状态。
- `metadata-results.txt`：同步新增kind等元数据后6项中2失败、4通过，剩余准备/清理重试问题继续复现。
- `lifecycle-results.txt`：同步真实canStop/busy契约后6项组件检查全通过。
- `final-results.txt`：加入实际service状态回执与清理重试后8项全通过。

运行方式：`npx vitest run --config previews/fifth-review-ui/vitest.config.ts`。

审查范围：AutonomyPage、shared/types、shared/ipc、preload、main/ipc；为核对UI状态含义，只读跟踪了 AutonomyService.status/operate/stop/finish。未进行攻击载荷、安全边界或后端身份审查，避免与另外审查工作重复。

## 05:29 补充：导出回执与离线只读预览

root 在真实 Electron 验收中补充导出结果持久显示及离线 PNG 预览后，本代理追加独立复核。仍未修改生产代码、未构建 out、未运行全量。

最新 `notice-preview-results.txt`：**2文件14项全部通过**（12项组件、2项服务状态），35.50秒，主要耗时为测试环境加载。此前8项结果保留为前一检查点。

新增确认：

- 导出等待期间，正式 status 边界返回 busy=true 后按钮保持禁用；导出返回错误后立即恢复按钮，后续两次状态轮询不覆盖“目标已存在”的实际结果；下一次用户操作开始后才清除旧结果。
- 保存取消经过10秒状态轮询仍有明确说明，已核验产物及导出按钮保持可用。一般观察操作的失败也不会被后台状态原因覆盖。
- 离线预览尚未返回时，跨15秒状态轮询也不会发起第二次预览；返回后才启动下一次5秒刷新。
- 预览接口报告许可暂停时清除已有画面，显示暂停占位说明。
- 停止操作返回后隐藏原有离线画面；当时已发出的预览迟到返回后不再显示，也不会重启预览定时器。
- 离页卸载后，旧页面实例的迟到帧不会注入新挂载页面；新页面只显示自己的返回帧。
- 联网活动仍渲染带 autoconnect 的 noVNC iframe，期间不启动离线图片刷新；离线图片未替代在线交互。

边界说明：组件探针使用独立 base64 标记验证呈现和生命周期，不把它声称为真实 PNG/实际桌面截图。scrot与PNG解码、真实Docker展示、锁屏守卫的执行证据由 root 的后端回归及真实E2E负责；本次只读核对到 preview 在采集前和返回前检查 capture 许可，使用 count=false，且没有模型外发调用。

追加审查的源码哈希保存在 `reviewed-notice-preview-hashes.json`；旧哈希文件保留。当前补充范围内未发现新的阻止交付问题。
