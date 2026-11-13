# QA 对抗性启动/退出报告

- 时间：2026-11-13T02:00:49.629Z

| 场景 | 结论 | 启动(ms) | 窗口数 | 退出(ms) | 备注 |
| --- | --- | --- | --- | --- | --- |
| corrupt-settings-json | EXPECTED_MODAL_BLOCK | 11438 | 0 | - | 按设计弹出中文错误框并等待用户确认；自动化环境主动结束进程 |
| unknown-preset | OK | 790 | 2 | 329 |  |
| invalid-scale-and-position | OK | 730 | 2 | 316 |  |
| corrupt-database | EXPECTED_MODAL_BLOCK | 11527 | 0 | - | 按设计弹出中文错误框并等待用户确认；自动化环境主动结束进程 |
| second-instance | OK | - | 0 | 630 |  |
| restart-loop | OK | - | 0 | - |  |

预期行为场景（启动失败中文错误框）：2 个；自动化环境主动结束进程。
全部场景符合预期。