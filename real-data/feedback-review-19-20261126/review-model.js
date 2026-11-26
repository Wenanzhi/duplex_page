/* Human review state is independent of every model label and training artifact. */
(function (root) {
  const tokens = ["<|listen|>", "<|wait|>", "<|idle|>", "<|speak|>", "<|bc|>"];
  const soundNames = {ordinary_speech:"Assistant 普通发言",assistant_backchannel:"Assistant 短反馈",user_backchannel:"User 短反馈",
    assistant_pause:"Assistant 自己的停顿",user_holding:"User 暂停且持话",breath_or_noise:"呼吸或噪声",silence:"没有声音",boundary_speech:"起音或尾音",uncertain:"仍不确定"};
  const blockKey = (sampleId, index) => `${sampleId}:${index}`;
  const emptyState = () => ({items:{},blocks:{}});
  const spanText = span => span.map(time => (time / 1000).toFixed(2)).join("–") + " 秒";
  const choiceText = choice => !choice ? "未判断" : choice.action === "trim" ? "裁剪静音" : choice.action === "keep" ? "保留原标签" : choice.token;

  function applyRange(state, sampleId, start, stop, action, token = null) {
    if (!["token","keep","trim","clear"].includes(action) || action === "token" && !tokens.includes(token)) throw Error("未知判断");
    if (!Number.isInteger(start) || !Number.isInteger(stop) || start < 0 || start >= stop) throw Error("区间无效");
    const updated_at = new Date().toISOString();
    for (let index = start; index < stop; index++) {
      const key = blockKey(sampleId, index);
      if (action === "clear") delete state.blocks[key];
      else state.blocks[key] = {action,token:action === "token" ? token : null,updated_at};
    }
  }

  function hasAnswer(state, item) {
    const answer = state.items[item.id] || {};
    return Boolean(answer.sound || answer.note?.trim() || answer.transcript?.trim() ||
      Array.from({length:item.chunk_span[1]-item.chunk_span[0]},(_,i)=>i+item.chunk_span[0])
        .every(index=>state.blocks[blockKey(item.sample_id,index)]));
  }

  function exportReview(data, state) {
    const block_decisions = [];
    for (const sample of data.samples) for (const frame of sample.frames) {
      const choice = state.blocks[blockKey(sample.id,frame.chunk_index)];
      if (choice) block_decisions.push({sample_id:sample.id,chunk_index:frame.chunk_index,span_ms:frame.span_ms,
                                       original_token:frame.control_token,...choice});
    }
    return {schema_version:3,review_id:data.review_id,source_run:data.source_run,source_sha256:data.source_sha256,
      code_sha256:data.code_sha256,exported_at:new Date().toISOString(),
      items:data.items.map(item=>({item_id:item.id,sample_id:item.sample_id,kind:item.kind,span_ms:item.span_ms,
        status:"pending",sound:"",note:"",transcript:"",...state.items[item.id]})),block_decisions};
  }

  function importReview(data, value, existing = emptyState()) {
    if (value.schema_version !== 3 || value.review_id !== data.review_id || value.source_sha256 !== data.source_sha256 ||
        value.code_sha256 !== data.code_sha256) throw Error("该文件不属于这一版复核音频，未导入任何判断。");
    if (!Array.isArray(value.items) || !Array.isArray(value.block_decisions)) throw Error("复核文件结构不完整。");
    const next = JSON.parse(JSON.stringify(existing));
    const items = new Map(data.items.map(item=>[item.id,item])), samples = new Map(data.samples.map(sample=>[sample.id,sample]));
    const seenItems = new Set(), seenBlocks = new Set();
    for (const entry of value.items) {
      const item = items.get(entry.item_id);
      if (!item || seenItems.has(entry.item_id) || entry.sample_id !== item.sample_id || entry.kind !== item.kind ||
          JSON.stringify(entry.span_ms) !== JSON.stringify(item.span_ms) || !["pending","reviewed","uncertain"].includes(entry.status) ||
          typeof entry.note !== "string" || typeof entry.transcript !== "string" || entry.sound && !soundNames[entry.sound]) throw Error("复核片段字段无效，未导入任何判断。");
      seenItems.add(entry.item_id);
      const answer = {status:entry.status,sound:entry.sound || "",note:entry.note,transcript:entry.transcript,updated_at:entry.updated_at || ""};
      if (!next.items[item.id] || (next.items[item.id].updated_at || "") <= answer.updated_at) next.items[item.id] = answer;
    }
    for (const entry of value.block_decisions) {
      const frame = samples.get(entry.sample_id)?.frames[entry.chunk_index], key = blockKey(entry.sample_id,entry.chunk_index);
      if (!Number.isInteger(entry.chunk_index) || !frame || seenBlocks.has(key) || frame.chunk_index !== entry.chunk_index ||
          JSON.stringify(entry.span_ms) !== JSON.stringify(frame.span_ms) || !["token","keep","trim"].includes(entry.action) ||
          entry.action === "token" && !tokens.includes(entry.token) || entry.action !== "token" && entry.token !== null ||
          typeof entry.updated_at !== "string") throw Error("逐块判断无效，未导入任何判断。");
      seenBlocks.add(key);
      if (!next.blocks[key] || next.blocks[key].updated_at <= entry.updated_at)
        next.blocks[key] = {action:entry.action,token:entry.token,updated_at:entry.updated_at};
    }
    return next;
  }

  function summaryText(data, state) {
    const lines = [`复核批次：${data.source_run}`,`音频版本：${data.source_sha256.slice(0,16)}`];
    for (const item of data.items) {
      const answer = state.items[item.id];
      if (!answer || !hasAnswer(state,item) && answer.status !== "uncertain") continue;
      lines.push(`\n录音 ${item.number}（${item.sample_id.slice(0,8)}）${spanText(item.span_ms)} / ${item.title}`,
        `状态：${{pending:"未完成",reviewed:"已复核",uncertain:"仍不确定"}[answer.status || "pending"]}`);
      if (answer.sound) lines.push(`声音性质：${soundNames[answer.sound]}`);
      if (answer.transcript) lines.push(`听到的文字：${answer.transcript}`);
      if (answer.note) lines.push(`判断依据：${answer.note}`);
    }
    lines.push("\n逐块判断（同一时段，连续同类已合并）：");
    for (const sample of data.samples) {
      let group = null;
      const emit = () => { if (group) lines.push(`录音 ${sample.number}（${sample.id.slice(0,8)}）${spanText([group.start*320,group.stop*320])}：${choiceText(group.choice)}`); };
      for (const frame of sample.frames) {
        const choice = state.blocks[blockKey(sample.id,frame.chunk_index)];
        if (choice && group && group.stop === frame.chunk_index && choiceText(choice) === choiceText(group.choice)) group.stop++;
        else {emit();group=choice ? {start:frame.chunk_index,stop:frame.chunk_index+1,choice} : null;}
      }
      emit();
    }
    return lines.join("\n");
  }
  const api = {tokens,soundNames,blockKey,emptyState,spanText,choiceText,applyRange,hasAnswer,exportReview,importReview,summaryText};
  root.ReviewModel = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
