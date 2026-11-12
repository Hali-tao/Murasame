# 渲染进程崩溃恢复探测

- 时间：2026-11-12T18:02:46.932Z

| 崩溃目标 | 是否恢复 | 恢复耗时(ms) | 最终 crashed | 窗口数 |
| --- | --- | --- | --- | --- |
| pet | 是 | 521 | false | 2 |
| main | 是 | 523 | false | 2 |

## 发现
- 无

## 崩溃后前 6 帧状态
```json
[
  {
    "target": "pet",
    "frames": [
      {
        "at": 253,
        "windows": 2,
        "exists": true,
        "crashed": true,
        "url": "murasame://app/pet.html",
        "visible": true
      },
      {
        "at": 521,
        "windows": 2,
        "exists": true,
        "crashed": false,
        "url": "murasame://app/pet.html",
        "visible": true,
        "ready": "complete",
        "hasApi": true,
        "bodyLength": 12,
        "petOpaque": 0
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
        "at": 523,
        "windows": 2,
        "exists": true,
        "crashed": false,
        "url": "murasame://app/index.html",
        "visible": false,
        "ready": "complete",
        "hasApi": true,
        "bodyLength": 458
      }
    ]
  }
]
```