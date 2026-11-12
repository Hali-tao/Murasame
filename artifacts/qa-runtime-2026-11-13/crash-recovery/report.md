# 渲染进程崩溃恢复探测

- 时间：2026-11-12T19:10:25.018Z

| 崩溃目标 | 是否恢复 | 恢复耗时(ms) | 最终 crashed | 窗口数 |
| --- | --- | --- | --- | --- |
| pet | 是 | 530 | false | 2 |
| main | 是 | 524 | false | 2 |
| undefined | 否 | - | - | undefined |

## 发现
- 无

## 连续崩溃上限
- 连续崩溃 5 次（60 秒内）：OK_CAPPED；恢复上限后保持 crashed 且主进程可响应属于已知限制，不做无限重载。

## 崩溃后前 6 帧状态
```json
[
  {
    "target": "pet",
    "frames": [
      {
        "at": 260,
        "windows": 2,
        "exists": true,
        "crashed": true,
        "url": "murasame://app/pet.html",
        "visible": true
      },
      {
        "at": 530,
        "windows": 2,
        "exists": true,
        "crashed": false,
        "url": "murasame://app/pet.html",
        "visible": true,
        "ready": "complete",
        "hasApi": true,
        "bodyLength": 12,
        "petOpaque": 51820
      }
    ]
  },
  {
    "target": "main",
    "frames": [
      {
        "at": 259,
        "windows": 2,
        "exists": true,
        "crashed": true,
        "url": "murasame://app/index.html",
        "visible": false
      },
      {
        "at": 524,
        "windows": 2,
        "exists": true,
        "crashed": false,
        "url": "murasame://app/index.html",
        "visible": false,
        "ready": "complete",
        "hasApi": true,
        "bodyLength": 530
      }
    ]
  },
  {}
]
```