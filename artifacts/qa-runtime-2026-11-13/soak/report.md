# QA 运行时压测报告

- 时间：2026-11-12T17:04:56.989Z
- 模式：标准（预热 8s / 压力 60s / 空闲 120s）
- 采样点：127

## 结论
- 未发现崩溃/未响应/异常退出（PASS）
- 崩溃次数：0；异常退出：false
- 控制台错误条数：0

## 指标
| 指标 | 值 |
| --- | --- |
| 空闲起始总内存 | 236.7 MB |
| 空闲结束总内存 | 268.9 MB |
| 空闲内存增长 | 32.2 MB（16.1 MB/min） |
| 主进程最大响应延迟 | 9 ms |
| 最大总 CPU | 3.4% |

## 发现
- [P2] QA-SOAK-FUZZ-REJECT 非法输入抛出异常：setScale NaN — Error: Error invoking remote method 'pet:set-scale': Error: 请求参数无效：scale
- [P2] QA-SOAK-FUZZ-REJECT 非法输入抛出异常：setScale 负数 — Error: Error invoking remote method 'pet:set-scale': Error: 请求参数无效：scale

## 控制台错误样本
- 无

## 明细
```json
{
  "findings": [
    {
      "severity": "P2",
      "id": "QA-SOAK-FUZZ-REJECT",
      "title": "非法输入抛出异常：setScale NaN",
      "detail": "Error: Error invoking remote method 'pet:set-scale': Error: 请求参数无效：scale"
    },
    {
      "severity": "P2",
      "id": "QA-SOAK-FUZZ-REJECT",
      "title": "非法输入抛出异常：setScale 负数",
      "detail": "Error: Error invoking remote method 'pet:set-scale': Error: 请求参数无效：scale"
    }
  ],
  "crashes": []
}
```