# IPC 大载荷 / 重复导航 / 大备份恢复

- 时间：2026-11-12T19:38:01.642Z

| 场景 | 结果 | 主线程最大延迟 | 内存 |
| --- | --- | --- | --- |
| sendMessage 8MB 文本 | {"resolved":true,"ok":false,"error":"请求参数无效：text","ms":12} | 1.8ms | 539.1→621.4MB |
| addMemory 4MB 文本 | {"resolved":true,"ok":false,"error":"请求参数无效：text","ms":4} | 1.4ms | 622.4→623.6MB |
| transcribe 200 万个样本 | {"resolved":true,"ok":false,"error":"","ms":241} | 0.9ms | 623.9→690.4MB |
| updateSettings 4MB 字段 | {"resolved":false,"thrown":"Error: Error invoking remote method 'settings:update': Error: 请求参数无效：userName","ms":6} | 0.7ms | 690.7→699MB |
| 循环引用对象 | {"resolved":true} | 2ms | - |
| 120 次页面导航+窗口开关 | 699.6→894.2MB | - | 增长 194.6MB |
| 200 条备份恢复到全新资料目录 | op=77ms, ok=true, 记忆数=200 | 56.2ms | 538.7→617.4MB |

## 发现
- 无