# IPC 大载荷 / 重复导航 / 大备份恢复

- 时间：2026-11-14T20:17:19.701Z

| 场景 | 结果 | 主线程最大延迟 | 内存 |
| --- | --- | --- | --- |
| sendMessage 8MB 文本 | {"resolved":true,"ok":false,"error":"请求参数无效：text","ms":25} | 3ms | 537.1→563.3MB |
| addMemory 4MB 文本 | {"resolved":true,"ok":false,"error":"请求参数无效：text","ms":12} | 2.6ms | 577.2→629.6MB |
| transcribe 200 万个样本 | {"resolved":true,"ok":false,"error":"","ms":428} | 1.5ms | 630→696.8MB |
| updateSettings 4MB 字段 | {"resolved":false,"thrown":"Error: Error invoking remote method 'settings:update': Error: 请求参数无效：userName","ms":13} | 2.6ms | 697.1→705.9MB |
| 循环引用对象 | {"resolved":true} | 2ms | - |
| 120 次页面导航+窗口开关 | 706.4→853.8MB | - | 增长 147.4MB |
| 200 条备份恢复到全新资料目录 | op=117ms, ok=true, 记忆数=200 | 94.6ms | 543→622.4MB |

## 发现
- 无