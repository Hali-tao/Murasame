# IPC 大载荷 / 重复导航 / 大备份恢复

- 时间：2026-11-13T02:02:33.222Z

| 场景 | 结果 | 主线程最大延迟 | 内存 |
| --- | --- | --- | --- |
| sendMessage 8MB 文本 | {"resolved":true,"ok":false,"error":"请求参数无效：text","ms":15} | 1.2ms | 547.2→630.4MB |
| addMemory 4MB 文本 | {"resolved":true,"ok":false,"error":"请求参数无效：text","ms":4} | 2.7ms | 631.9→633.8MB |
| transcribe 200 万个样本 | {"resolved":true,"ok":false,"error":"","ms":212} | 1.3ms | 634.3→700.1MB |
| updateSettings 4MB 字段 | {"resolved":false,"thrown":"Error: Error invoking remote method 'settings:update': Error: 请求参数无效：userName","ms":6} | 1.2ms | 700.5→709.5MB |
| 循环引用对象 | {"resolved":true} | 0.7ms | - |
| 120 次页面导航+窗口开关 | 709.2→884.4MB | - | 增长 175.2MB |
| 200 条备份恢复到全新资料目录 | op=77ms, ok=true, 记忆数=200 | 64.7ms | 539.9→621.7MB |

## 发现
- 无