# Duplex · 双轨交互时间线

基于实际生成的双轨 PCM、CTC 字时间和 pipeline 事件记录的只读展示页。user 为左声道，assistant 为右声道；chunk 网格始终使用整段音频的绝对采样坐标。

## 本地运行

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

在浏览器打开 `http://127.0.0.1:8765/`。页面使用 `fetch` 读取展示数据，请通过 HTTP 服务打开。无需 npm、构建步骤或后端。

## GitHub Pages

将本站目录作为 `duplex_page` 仓库的根目录。在仓库 Settings → Pages 中选择从 `main` 分支的 `/ (root)` 发布。`.nojekyll` 保留静态文件原样。音频通过普通 Git 保存，不使用 Git LFS。

## 文件

- `index.html`：页面、Canvas 波形与 Web Audio 播放逻辑。
- `assets/demo.json`：既有时间线、Director、chunk、CTC、前后句和时序检查的只读投影。保留来源文件的 SHA-256。
- `assets/demo.wav`：未经重采样或重合成的原始双轨 PCM 副本。加载时核对采样率、采样数和可用环境下的 SHA-256。
- `assets/demo-sans.woff`：Noto Sans CJK SC 的展示字形子集，修改后命名为 Duplex Demo Sans；随附 `assets/OFL.txt`（SIL OFL 1.1）。更新台词时需要重新覆盖所用字形。原始字体来自 [Noto CJK](https://github.com/notofonts/noto-cjk)，原始 OTF SHA-256 为 `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`。

导出不包含 API 配置、克隆参考录音、模型、原始数据索引或服务器绝对路径。新 demo 必须完成生成和审计后，才能替换展示数据；`meta.preview_only=true` 表示尚在使用旧 demo 做开发预览。

场景原始问题来自 [OpenAssistant/oasst1](https://huggingface.co/datasets/OpenAssistant/oasst1)，固定版本 `c078a57c53311674f1f74d1e55f6ed7c27631ce3`，Apache-2.0。台词由 Writer 自动创作与修正，音频由 Qwen3-TTS 合成；展示使用已完成 CTC 对齐及事件排程的双轨产物。

## 使用

点击事件查看局部波形与 chunk；拖动局部波形平移，滚轮或加减按钮缩放。点击标记、字或 chunk 可定位；空格播放/暂停，左右方向键逐 chunk 移动。“试听完整前后文”包含交互前后至少一句完整台词，循环按钮使用同一区间。声道可切换双轨、仅 user、仅 assistant。

页面分别显示语义触发点、音频排程起点、有效起声、start/stop 动作及 `[CUT]`。有效起声是现有能量窗检测结果；CTC 字时间有自身分辨率，二者不等同。普通话轮的 start 动作位于边界，并不意味着有效起声也位于边界。截断后的文本标为未播出；CUT 到后续 chunk 边界的补零按原数据绘制。

浏览器播放使用同一个 AudioContext 时钟与原始采样率的 AudioBuffer。观察视窗不改变试听内容；静态波形降采样使用实际 PCM 的最小值/最大值，双轨采用共同的幅度刻度。
