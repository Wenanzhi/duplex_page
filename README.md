# Duplex · Control token 核对

当前页面仅展示双轨波形、对应导出文本、control token、数量统计和定位功能，保留逐块、逐页及连续试听。

## 本次随机样本

- 从已完成 token 修正、仍保留完整 delivery 的数据中，排除上一批 10 条后，以种子 20261125 从 14,537 条候选中无放回随机抽取 10 条。
- 不按主题、时长、质量或 token 类型挑选；此页面只检查 token，不改变样本原有质量状态。
- 新随机 10 条 · 总计 135.71 分钟。训练记录 25,449 条，其中音轨范围内的标注 25,439 条，末条无音频记录 10 条。
- 各 token 合计：listen 8,649、wait 25、bc 43、speak 16,704、idle 28。
- 末条单独计数：listen 6、idle 4；上面的总量已包含这些末条。

## 统计与定位

按原始训练记录逐条计数，连续相同 token 分别计入，不是交互事件数量。卡片显示当前样本及整组数量，并区分音频块和末条；点击卡片或类型选择器可筛选，支持上一个/下一个、按第几处跳转、位置列表和块编号定位。

Control 行对应助手目标物理时段：普通记录来自上一输入块；助手开场的空输入记录对应首块。User 开场的第零音频块没有助手目标记录时显示 —，不推断标签。末条在“会话末尾”展示，不补音频或伪造波形。

URL 参数：`?demo=<id>&token=<URL 编码后的 token>` 筛选，`&record=<训练记录编号>` 或 `&chunk=<物理块编号>` 定位。

## 标注与原始数据

使用 `target_window_dialogue_state_v1`：助手有输出优先 speak/bc；用户话轮及其自然能量间隙为 listen；明确停顿和停止后的观察等待为 wait，块内用户话轮开始则 listen；助手主话轮结束、用户新话轮未开始才 idle。末条按最后主话轮 user→listen、assistant→idle 单列。

页面 records 与对应正式 delivery/chunks.json 完全一致；文本直接读取 annotations_json.timeline_chunks，不重分词或重排。音频为正式双轨 PCM16 的无损压缩，保留增益、静音、CUT 和 320 ms 边界；不调用生成、ASR、对齐或排程。波形两轨共用幅度刻度。

本批抽样清单与验证报告保存在 duplex_pipeline/output_dataset/test/control_review_random10_20261125。上一批试听资源保留在本地与 Git 历史；发布目录替换为新随机批次，控制站点体积。更早的分块样本仍可通过 `?set=previous` 打开。

字体为 Duplex Chunk Sans（Noto Sans CJK 子集），许可见 assets/OFL.txt。
