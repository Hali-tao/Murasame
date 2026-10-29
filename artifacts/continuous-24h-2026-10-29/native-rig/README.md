# 奶龙原生共同呼吸绑定：第一轮增量

**状态：USER-PAUSED / 未经设计认可。** 用户明确要求先修软件，形象后续共同讨论设计。本目录仅保留已发生的原生绑定尝试与证据；所有角色设计、绑定、动作及追加 Viewer 操作现已停止。下文是已有工作的历史记录，不表示用户认可该形象，也不授权继续推进。

本目录是旧奶龙原型副本的首个共同呼吸绑定，制作日期为 2026-10-29。真实 Cubism 源工程、运行时导出和验证截图均已保存。这不是完整新角色，现有头颈及肢体接缝、美术质感、隐藏替换部件和完整动作仍待制作，也尚未接入 Murasame 生产桌宠。

## 可编辑交付

- [nailong-continuity-v1.cmo3](nailong-continuity-v1.cmo3)：本轮编辑后的 Cubism 工程，可继续编辑网格、变形器与参数。
- [nailong-continuity-v1.psd](nailong-continuity-v1.psd)：从旧原型复制的 16 层 PSD，像素与分层未修改。
- [runtime/nailong-continuity-v1.model3.json](runtime/nailong-continuity-v1.model3.json)：以 SDK 5.0 目标导出的兼容模型，附 moc3、cdi3 和一张 1024×1024 纹理。
- [runtime-sdk53](runtime-sdk53/)：第一次 SDK 5.3 导出的原件，用于保存不兼容证据，不作为本项目运行时交付入口。

操作使用 Live2D Cubism Editor 5.3.04 的真实界面。窗口显示“试用版，剩余 41 天”；本轮所用编辑与导出功能可用，未据此确认永久 Pro 授权。所有修改都发生在本目录副本，旧原型、旧内置模型、作者标记、软件代码和真实用户资料未修改。

## 实际改动及原因

旧原型的可见网格位于根层级，缺少统一的父级变形，头颈、肩部和髋部的叠层边界也直接可见。各部件缺少共同形变与现有美术接缝共同造成拼接感；仅补一个参数不能解决全部自然度问题。

本轮新增原生 Warp 变形器 `BodyContinuity_Breath`（ID `Warp`），父级为 `[Root]`，使用 5×5 转换细分和 2×2 贝塞尔细分。将当前可见的 10 个网格置于其下：头、身体、左右眼、张嘴、左右手臂、左右腿、尾巴。握持手、文件夹、闭眼及微笑嘴等 6 个隐藏替换部件保留原状，没有纳入这个父级或本轮纹理导出。

`ParamBreath`（呼吸）的范围为 0–1，原生关键形为 0 和 1。0 保留原始形态；1 轻微抬升上边界并向两侧扩展中部，让全部可见部件共同参与呼吸。下边界保持原位，但尚未验收脚底接地约束。此参数是形变驱动值，本轮没有制作 motion3 动画时间线。

## 已执行的验证

1. 保存后关闭源工程，再从磁盘重新打开同一 CMO3，检查共同父级、呼吸关键形及变形保持存在。证据：[重开工程并设置呼吸 1](cubism-reopened-breath-1.png)、[关键形 0/1](cubism-breath-keyforms.png)、[呼吸 0](cubism-breath-0.png)、[呼吸 1](cubism-breath-1.png)。
2. 在原生纹理图集窗口建立 1024×1024 图集，打包当前 10 个可见部件。证据：[纹理图集](cubism-texture-atlas.png)。
3. 第一次 SDK 5.3 导出无法被本项目已有 Core 5.1.0 加载；同一 Core 可加载并更新现有模型，排除了 Core 未初始化的情况。随后在编辑器实际提供的目标列表（SDK 3.0、3.3、4.0、4.2、5.0、5.3）中选择 SDK 5.0，重新导出兼容版本。没有升级生产运行库。证据：[SDK 5.0 导出设置](cubism-sdk50-export-settings.png)。
4. 项目已有 Core 5.1.0 实际加载并 update 兼容 moc3 成功。导出包含 10 个 drawable；`ParamBreath=1` 时 10 个部件的顶点全部发生变化，最大单坐标差为 0.010049015283584595 模型单位。按 0、0.25、0.5、0.75、1 及逆序采样，回到 0 时顶点差为 0，所有采样坐标有限。独立证据：[Core 验证说明](../native-core/README.md)、[完整探针结果](../native-core/native-core-probe.json)。
5. Cubism Viewer (for OW) 5.3.04 实际打开兼容版 model3.json，完整显示贴图；参数面板可见呼吸。证据：[Viewer 实际显示](viewer-loaded-sdk50.png)、[Viewer 参数面板](viewer-parambreath.png)。这证实原生 Viewer 载入与纹理显示，不等同于生产 Pixi 组件接入，也不构成自然度或帧率验收。

## 交付边界和后续工作

导出列出 27 个模板参数，但 Core 逐一检查参数端点后，只有 `ParamBreath` 产生几何或透明度变化。其余 26 个不能计为已经完成的转头、眨眼、口型或动作。当前没有行走、打字、抱文件等完整动作，也没有新增表情切换、物理摆动或动作文件。

这些问题留待后续与用户共同讨论形象设计后重新确定，不继续自动推进。既有技术问题包括头颈、肩部和髋部重叠区域的美术连续性、隐藏替换部件、局部父子变形器、接地与重心变化、表情及动作；生产渲染与交互也尚未验证接入。

## 文件完整性

[verification.json](verification.json) 记录原型前后哈希、工程和已有验证范围；[manifest.json](manifest.json) 记录本目录每个保留文件的大小与 SHA-256（manifest 自身除外）。旧原型 PSD 和 CMO3 的前后 SHA-256 一致，原目录保持原样。暂停后仅整理说明与哈希，没有追加模型验证。

文本另记LF规范化哈希，以适应Git换行转换；模型二进制和图片保持原字节。此项只整理归档记录，不修改设计或追加模型验证。

本轮参考了官方的 [Warp 变形器操作说明](https://docs.live2d.com/en/cubism-editor-manual/making-and-placement-of-warp-deformer/) 和 [编辑操作说明](https://docs.live2d.com/en/cubism-editor-manual/how-to-edit/)，实际工程修改与验证通过原生界面完成。
