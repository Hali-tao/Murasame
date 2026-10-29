# 奶龙新绑定的真实运行库兼容检查

**USER-PAUSED / 未经设计认可。用户要求先修软件，形象后续共同讨论。本目录仅保留暂停前已做的兼容检查，不表示角色设计完成，不继续制作或接入生产。**

本目录检验旁边 `native-rig/` 的实际Cubism导出。直接使用项目自带 `src/renderer/public/live2d/core/live2dcubismcore.min.js`，报告版本为5.1.0；不升级或修改生产运行库。

## 先失败，再修复

首次编辑器以SDK5.3格式导出，`Moc.fromArrayBuffer`返回null；失败保存在 `native-core-incompatible.txt`。随后加正向对照：同一运行库可加载、更新现有奶蛙模型，但新导出仍失败，见 `native-core-incompatible-control.txt`。不兼容原件保留于 `../native-rig/runtime-sdk53/`，moc3 SHA-256为 `cbdbdcd52c17748146d92e8fc661071a6211aac241f60935af591aa032cd2c16`。

编辑器改选实际提供的SDK5.0目标重新导出，`../native-rig/runtime/`中的moc3已被同一Core成功加载和更新，见 `native-core-compatible.txt` 与 `native-core-probe.json`。兼容版moc3 SHA-256为 `e92e4f88fa470456caf11f5f39292c9bc49f5fe38127bae97445b2f6d83f1f34`。

## 实际测到的范围

- 导出包含10个可绘制部件；ParamBreath从0到1时，10个部件的实际顶点均变化，最大单坐标变化0.010049模型单位。
- 按0、0.25、0.5、0.75、1及逆序采样，回到0时顶点与起点差为0，所有采样坐标有限。
- 模型列出27个参数，但端点探测只有ParamBreath产生顶点或透明度变化。因此这只是共同呼吸绑定，不能把其余模板参数计作已完成的转头、眨眼、口型等动作。
- 这是实际Core加载和网格变形验证，不含纹理渲染、帧率或视觉自然度评分，不等同于已接入Murasame生产桌宠。编辑器/Viewer的实图及源工程重开验证另见native-rig记录。

## 复跑

将 `native-core-probe.mjs.txt`复制到项目的previews目录并改名`.mjs`，在项目根目录用Node执行。默认读取兼容版，生成诊断JSON于 `previews/continuous-24h-2026-10-29/native-core-probe.json`。可通过第一个命令行参数传入 `artifacts/continuous-24h-2026-10-29/native-rig/runtime-sdk53/nailong-continuity-v1.moc3`重现旧格式失败。脚本有旧模型正向对照，读取前后核对导出哈希不变；不写入模型、运行库或用户资料。

`raw-text-evidence.zip`保留5份原始文本；目录可读副本统一换行和行末空白。manifest包含原始、可读与LF规范化哈希，README和manifest本身不计入文件清单。
