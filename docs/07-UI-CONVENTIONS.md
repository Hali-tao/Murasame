# 状态展示约定

界面上的运行状态只用这一套文案和颜色，定义在 `src/renderer/src/lib/status.ts`。

| 状态 | 文案 | 颜色 | 动效 |
| --- | --- | --- | --- |
| waiting-input | 等待输入 | gray | 静止 |
| service-wait | 服务等待 | blue | 进行中 |
| task-running | 任务执行 | blue | 进行中 |
| awaiting-approval | 等待批准 | amber | 进行中 |
| finished | 执行结束 | green | 静止 |
| unimplemented | 未实现 | gray | 静止 |
| unverified | 未验证 | amber | 静止 |
| degraded | 已降级 | red | 静止 |

错误提示分成两段：原因，以及用户下一步可以做的操作。不要把内部错误码显示在界面上。
