# Duplex · 双轨交互时间线

基于实际生成的双轨 PCM、强制对齐字时间和 pipeline 事件记录的只读展示页。user 为左声道，assistant 为右声道；chunk 网格始终使用整段音频的绝对采样坐标。以 320 ms 为基准，按助手分词延后边界，读取 chunks 中的实际起止时间；用户分词不影响边界。跳转、播放高亮和边界核验均使用实际 chunk 索引。

## 本地运行

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

在浏览器打开 `http://127.0.0.1:8765/`。页面使用 `fetch` 读取展示数据，请通过 HTTP 服务打开。无需 npm、构建步骤或后端。

## GitHub Pages

将本站目录作为 `duplex_page` 仓库的根目录。在仓库 Settings → Pages 中选择从 `main` 分支的 `/ (root)` 发布。`.nojekyll` 保留静态文件原样。音频通过普通 Git 保存，不使用 Git LFS。

## 文件

- `index.html`：页面、Canvas 波形与 Web Audio 播放逻辑。
- `assets/demo.json`：既有时间线、Director、chunk、强制对齐、前后句和时序检查的只读投影。保留来源文件的 SHA-256。
- `assets/demo.wav`：未经重采样或重合成的原始双轨 PCM 副本。加载时核对采样率、采样数和可用环境下的 SHA-256。
- `assets/demo-sans.woff`：Noto Sans CJK SC 的展示字形子集，修改后命名为 Duplex Demo Sans；随附 `assets/OFL.txt`（SIL OFL 1.1）。更新台词时需要重新覆盖所用字形。原始字体来自 [Noto CJK](https://github.com/notofonts/noto-cjk)，原始 OTF SHA-256 为 `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`。

导出不包含 API 配置、克隆参考录音、模型、原始数据索引或服务器绝对路径。新 demo 必须完成生成和审计后，才能替换展示数据；`meta.preview_only=true` 表示尚在使用旧 demo 做开发预览。

场景原始问题来自 [OpenAssistant/oasst1](https://huggingface.co/datasets/OpenAssistant/oasst1)，固定版本 `c078a57c53311674f1f74d1e55f6ed7c27631ce3`，Apache-2.0。台词由 Writer 自动创作与修正，音频由 MOSS-TTS-v1.5 合成；展示使用已完成 Qwen3-ForcedAligner 对齐及事件排程的双轨产物。

## 使用

点击事件查看局部波形与 chunk；拖动局部波形平移，滚轮或加减按钮缩放。点击标记、字或 chunk 可定位；空格播放/暂停，左右方向键逐 chunk 移动。“试听完整前后文”包含交互前后至少一句完整台词，循环按钮使用同一区间。声道可切换双轨、仅 user、仅 assistant。

页面分别显示语义触发点、音频排程起点、有效起声、start/stop 动作及 `[CUT]`。有效起声是现有能量窗检测结果；强制对齐字时间有自身分辨率，二者不等同。普通话轮的 start 动作位于边界，并不意味着有效起声也位于边界。截断后的文本标为未播出；CUT 到后续 chunk 边界的补零按原数据绘制。

浏览器播放使用同一个 AudioContext 时钟与原始采样率的 AudioBuffer。观察视窗不改变试听内容；静态波形降采样使用实际 PCM 的最小值/最大值，双轨采用共同的幅度刻度。

## 当前展示数据

2026-11-13 从原始数据自动生成的“香港美食天堂原因” demo：585.60 秒，28 个话轮，8 种启用交互各一次。MOSS-TTS-v1.5 zero-shot 合成，Qwen3-ForcedAligner-0.6B 对齐；1470 个可变长度 chunks，230 项时序检查通过。每个角色在全对话中固定使用真实参考录音和 codec 缓存，参考 transcript 仅作来源记录，不作为 continuation 前缀。

短反馈均为“嗯嗯。”，保留生成的首尾静音，使用与普通话轮相同的角色参考响度目标；没有额外 −6 dB 衰减、边缘静音裁剪、变速或 2 秒目标。时序阶段曾对一个主话轮作局部自动返修，固定参考不变。此页展示最终通过时序检查的音频。

PER 门槛为普通话轮 0.20、backchannel 0.50。首次超标先对同一音频做无目标文本提示的 ASR 复核，仍超标才重合成一次；复核达标则允许通过并保留分歧。此次 u021 的两次 PER 均为 0.2523，一次重合成后为 0.0045；最终 28 轮均通过 PER 门槛。其他质量维度仍按现有规则记录，时序通过不代表人工音质验收。Writer、Director、台词、参考和所有返修均由 pipeline 生成或复用，无人工补写。

7 个事件保留交互前后完整句。最后的停止式打断位于对话结尾：完整 user 打断话轮横跨 CUT，之后没有另一句完整台词。该事件保留此前完整句、双方事件话轮及原始音频至结尾，页面明确显示“对话结束”，不将它标为前后句齐全。所有试听区间直接使用原始双轨的采样坐标，不裁掉说话内容，也不追加静音。
