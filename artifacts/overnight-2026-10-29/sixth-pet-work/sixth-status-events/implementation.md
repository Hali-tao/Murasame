# 第六轮自主活动状态事件

冻结时间：2026-10-29 06:37:48 +08:00。基线 `f94e56b9079aba5afd0f0da55ce30a452d6739de`。

## 已实现

- `AutonomyService.subscribe(listener)` 注册后续状态监听并返回可重复调用的解绑函数；初次恢复继续读取原 `status()`。
- 所有真实 state 更新与 operate/export 的 busy 开始、finally 释放统一发布 `status()` 快照。快照为每个监听者独立深拷贝，保留核验产物；同步异常和异步拒绝均不影响活动。旧 run 的异步 finally 不会向替换后的活动发布状态。
- IPC 新增 `autonomy:updated`，真实服务事件通过既有窗口广播；preload 提供 `autonomy.onStatusChanged(listener)`。共享 `ActivityStatus` 增加可选 `activityId`。
- IPC 环境准备开始、结束和取消发送展示快照，不改真实服务状态。运行中或待清理活动优先，准备镜像不遮掉已有核验产物；尚未开始的准备不会被标成完成。
- 没有新增定时器、Docker 轮询或健康查询；保留现有 status/health 行为，未修改前端恢复轮询。

## 修改范围

生产文件仅：`src/main/core/services/autonomy-service.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/shared/ipc.ts`、`src/shared/types.ts`。

新增专属测试：`tests/unit/autonomy-status-events.test.ts`、`tests/unit/autonomy-status-bridge.test.ts`。

未修改 pet.tsx、Live2DPet、ModelsPage，也未构建 out、运行完整 E2E 或提交。

## 验证证据

- `service-red.txt`：新增服务事件接口缺失时 7 项失败。
- `bridge-red.txt`：preload 状态订阅缺失时 3 项失败。
- `bridge-green.txt`：新增 10 项通过；实际 AutonomyService → 主进程注册 → preload → 监听者通路，外部 Electron/Docker 边界使用受控 fixture。
- `affected-tests.txt`：两个新增文件加现有 `autonomy-lifecycle-regression`、`isolated-creation`，共 4 文件 **58/58 通过**。
- `lint.txt`：5 个生产文件和 2 个专属测试定向 ESLint 通过。
- `git diff --check` 对本次文件通过。
- `typecheck-node.txt`：整项目 node 配置检查只有另一工作线的 `src/renderer/src/components/Live2DPet.tsx:217 TS2445 loadExpression protected` 报错；已报告 root，未越权修改。

测试 TEMP/TMP 指向仓库 `previews/tmp`。未访问真实用户数据、外部模型或真实 Docker。

## 整合说明

订阅不发送初始快照，消费方使用“先订阅，再 status 恢复”，保留既有低频恢复轮询。相同阶段可能伴随 notes 或 busy 更新；消费者按 `activityId` 和需要的阶段字段判断动作，避免把每条快照都当作新阶段。

主代理负责整合后的全量 verify、桌宠实际动作与新包验收。
