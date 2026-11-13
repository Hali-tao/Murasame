# QA 对抗性启动/退出报告

- 时间：2026-11-13T00:30:08.749Z

| 场景 | 结论 | 启动(ms) | 窗口数 | 退出(ms) | 备注 |
| --- | --- | --- | --- | --- | --- |
| corrupt-settings-json | EXPECTED_MODAL_BLOCK | 11609 | 0 | - | 按设计弹出中文错误框并等待用户确认；自动化环境主动结束进程 |
| unknown-preset | OK | 791 | 2 | 327 |  |
| invalid-scale-and-position | OK | 713 | 2 | 321 |  |
| corrupt-database | EXPECTED_MODAL_BLOCK | 11357 | 0 | - | 按设计弹出中文错误框并等待用户确认；自动化环境主动结束进程 |
| second-instance | OK | - | 0 | 635 |  |
| restart-loop | OK | - | 0 | - |  |

预期行为场景（启动失败中文错误框）：2 个；自动化环境主动结束进程。
全部场景符合预期。