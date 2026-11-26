/* The review page reads immutable results and exports separate human decisions. */
(async () => {
  const $ = id => document.getElementById(id), M = ReviewModel;
  const node = (tag, cls, text) => {const element=document.createElement(tag);if(cls)element.className=cls;if(text!=null)element.textContent=text;return element;};
  const overlaps = (a,b) => a[0] < b[1] && b[0] < a[1];
  const colors = {"<|listen|>":["#3578c8","#edf4fc"],"<|speak|>":["#12806c","#e8f5ee"],"<|bc|>":["#8454b7","#f3edf9"],"<|wait|>":["#a66c12","#fff4df"],"<|idle|>":["#637785","#edf1f4"]};
  let data;
  try {const response=await fetch("review-data.json");if(!response.ok)throw Error(`HTTP ${response.status}`);data=await response.json();}
  catch(error){$("fatal-error").textContent=`复核数据加载失败：${error.message}。请刷新页面重试。`;$("fatal-error").hidden=false;return;}
  const samples = new Map(data.samples.map(sample=>[sample.id,sample]));
  const storageKey = `duplex-review-v3:${data.review_id}`, clipCache = new Map();
  let state=M.emptyState(), selected=0, range=[0,1], viewStart=0, player=null, mediaGeneration=0, animation=null, toastTimer=null;
  const item=()=>data.items[selected], sample=()=>samples.get(item().sample_id), clip=()=>data.clips[item().clip_id];
  const answer=()=>state.items[item().id] || {};
  const selectedSpan=()=>range.map(index=>index*320);
  const status=entry=>state.items[entry.id]?.status || "pending";
  const seconds=time=>(time/1000).toFixed(2);
  const toast=text=>{clearTimeout(toastTimer);$("toast").textContent=text;$("toast").hidden=false;toastTimer=setTimeout(()=>{$("toast").hidden=true;},3500);};
  try {const cached=JSON.parse(localStorage.getItem(storageKey) || "null");if(cached)state=M.importReview(data,cached);}
  catch(error){toast(`未载入本地记录：${error.message}`);}

  function save() {
    try {localStorage.setItem(storageKey,JSON.stringify(M.exportReview(data,state)));$("save-status").textContent="已保存在此浏览器。复核后请导出 JSON 或复制摘要发给我，页面不会自动提交。";}
    catch {$("save-status").textContent="此浏览器无法保存。离开前请导出 JSON 或复制复核摘要。";}
  }
  function visibleIndices() {
    return data.items.flatMap((entry,index)=>(($("sample-filter").value==="all" || String(entry.number)===$("sample-filter").value) &&
      ($("kind-filter").value==="all" || entry.kind===$("kind-filter").value) &&
      ($("status-filter").value==="all" || status(entry)===$("status-filter").value)) ? [index] : []);
  }
  function renderQueue() {
    const indices=visibleIndices();
    $("review-list").replaceChildren(...indices.map(index=>{
      const entry=data.items[index], currentStatus=status(entry);
      const button=node("button",`queue-item ${currentStatus}${index===selected?" active":""}`);
      button.dataset.index=index;button.setAttribute("aria-current",String(index===selected));
      button.append(node("span","small",`录音 ${entry.number} · ${entry.sample_id.slice(0,8)}`),node("strong","",M.spanText(entry.span_ms)),
        node("span","small",entry.title),node("span","small status",{pending:"待复核",reviewed:"已完成",uncertain:"仍不确定"}[currentStatus]));
      button.onclick=()=>selectItem(index);return button;
    }));
    if(!indices.length)$("review-list").append(node("p","muted","当前筛选中没有片段。"));
    const done=data.items.filter(entry=>status(entry)!=="pending").length;
    const unsure=data.items.filter(entry=>status(entry)==="uncertain").length;
    $("progress").textContent=`${done} / ${data.items.length}`;
    $("summary").textContent=`${data.samples.length} 条录音 · ${data.items.length} 个片段 · 已复核 ${done}，仍不确定 ${unsure}。原音频和原标签保持不变。`;
    $("previous-item").disabled=!indices.some(index=>index<selected);
    $("next-item").disabled=!indices.some(index=>index>selected);
  }
  function navigate(direction) {
    const indices=visibleIndices().filter(index=>direction>0?index>selected:index<selected);
    if(indices.length)selectItem(direction>0?indices[0]:indices.at(-1));
    else toast("当前筛选已到最后一个片段，可切换筛选继续复核。");
  }
  function contextSpan() {
    const margin=Number($("context-margin").value), span=selectedSpan();
    return [Math.max(clip().start_ms,span[0]-margin),Math.min(clip().end_ms,span[1]+margin)];
  }
  function viewSpan() {
    const width=Number($("zoom").value);
    if(!width)return [clip().start_ms,clip().end_ms];
    viewStart=Math.max(clip().start_ms,Math.min(viewStart,Math.max(clip().start_ms,clip().end_ms-width)));
    return [viewStart,Math.min(clip().end_ms,viewStart+width)];
  }
  function focusSelection() {
    const width=Number($("zoom").value);
    viewStart=selectedSpan()[0]-(width?Math.min(width/3,3200):0);
  }
  function setRange(start,stop,{focus=false}={}) {
    const first=Math.floor(clip().start_ms/320), last=Math.min(sample().frames.length,Math.ceil(clip().end_ms/320));
    start=Math.max(first,Math.min(start,last-1));stop=Math.max(start+1,Math.min(stop,last));
    range=[start,stop];$("range-start").value=String(start);$("range-end").value=String(stop-1);
    if(focus)focusSelection();renderSelection();renderWaveform();renderStrip();renderTranscripts();
  }
  function renderRangeOptions() {
    const first=Math.floor(clip().start_ms/320), stop=Math.min(sample().frames.length,Math.ceil(clip().end_ms/320));
    for(const id of ["range-start","range-end"]) {
      $(id).replaceChildren(...sample().frames.slice(first,stop).map(frame=>{
        const option=node("option","",`#${frame.chunk_index} · ${seconds(id==="range-start"?frame.span_ms[0]:frame.span_ms[1])} s`);
        option.value=frame.chunk_index;return option;
      }));
    }
  }
  async function loadPlayer(entry,generation) {
    document.querySelectorAll(".audio-button").forEach(button=>button.disabled=true);
    $("playback-status").textContent="音频准备中…";$("audio-error").hidden=true;
    try {
      if(!clipCache.has(entry.clip_id))clipCache.set(entry.clip_id,(async()=>{
        const response=await fetch(data.clips[entry.clip_id].url);if(!response.ok)throw Error(`HTTP ${response.status}`);
        const blob=await response.blob();return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(",")[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
      })());
      const encoded=await clipCache.get(entry.clip_id);if(generation!==mediaGeneration)return;
      const nextPlayer=new DuplexPlayer(encoded,clip().end_ms-clip().start_ms,status=>{
        if(player!==nextPlayer)return;
        $("playback-status").textContent={loading:"解码音频中…",playing:"正在播放",paused:"已停止"}[status];
        if(status==="playing")animate();else renderWaveform();
      });
      player=nextPlayer;player.seek(Math.max(0,selectedSpan()[0]-clip().start_ms));
      document.querySelectorAll(".audio-button").forEach(button=>button.disabled=false);
    } catch(error) {
      clipCache.delete(entry.clip_id);if(generation!==mediaGeneration)return;
      $("audio-error").textContent=`音频加载失败：${error.message}。请重新选择此片段或刷新页面。`;$("audio-error").hidden=false;
    }
  }
  function selectItem(index) {
    player?.pause();player?.context?.close().catch(()=>{});player=null;selected=index;mediaGeneration++;
    const entry=item(), response=answer();
    $("sample-label").textContent=`录音 ${entry.number} · ${entry.sample_id.slice(0,8)} · 片段 ${selected+1}/${data.items.length}`;
    $("issue-title").textContent=entry.title;$("issue-time").textContent=M.spanText(entry.span_ms);
    $("issue-description").textContent=entry.description;
    $("precise-gap").hidden=entry.kind!=="coverage_gap";
    $("precise-gap").textContent=`精确缺口：${(entry.span_ms[0]/1000).toFixed(3)}–${(entry.span_ms[1]/1000).toFixed(3)} 秒，${Math.round(entry.span_ms[1]-entry.span_ms[0])} ms，位于 ${entry.affected_role==="user"?"User":"Assistant"} 音轨。下方 token 判断仍按完整 320 ms 块。`;
    $("review-note").value=response.note || "";$("heard-text").value=response.transcript || "";$("sound-kind").value=response.sound || "";
    $("transcript-label").hidden=entry.kind==="assistant_pause" || entry.kind==="coverage_gap";
    $("full-recording").href=`${data.baseline_url}/${entry.sample_id}/viewer/index.html#time_ms=${entry.span_ms[0]}`;
    renderRangeOptions();setRange(...entry.chunk_span,{focus:true});renderQueue();renderEvidence();
    history.replaceState(null,"",`#issue=${encodeURIComponent(entry.id)}`);
    loadPlayer(entry,mediaGeneration);
  }
  async function play(span,channel=$("channel").value) {
    const active=player;if(!active)return;
    $("audio-error").hidden=true;
    try {active.rate=Number($("speed").value);await active.play(Math.max(0,span[0]-clip().start_ms),Math.min(clip().end_ms,span[1])-clip().start_ms,channel);}
    catch(error){if(player===active){$("audio-error").textContent=`播放失败：${error.message}`;$("audio-error").hidden=false;}}
  }
  function geometry(){const width=$("waveform").clientWidth;return {width,left:width<500?72:90,right:width-12};}
  function renderWaveform() {
    const canvas=$("waveform"),{width,left,right}=geometry(),height=292,ratio=window.devicePixelRatio||1;
    if(!width)return;if(canvas.width!==Math.round(width*ratio)||canvas.height!==height*ratio){canvas.width=Math.round(width*ratio);canvas.height=height*ratio;}
    const ctx=canvas.getContext("2d");ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
    const span=viewSpan(),x=time=>left+(time-span[0])/(span[1]-span[0])*(right-left),gain=Number($("gain").value);
    ctx.font="14px system-ui";ctx.textBaseline="middle";
    const minimumTick=(span[1]-span[0])/Math.max(2,Math.floor((right-left)/85));
    const ticks=[640,1280,2560,5120,10240,20480,40960,81920].find(step=>step>=minimumTick)||81920;
    for(let time=Math.ceil(span[0]/ticks)*ticks;time<=span[1];time+=ticks){ctx.fillStyle="#637785";ctx.fillText(seconds(time),Math.max(left,Math.min(right-40,x(time)-20)),15);}
    const first=Math.max(0,Math.floor(span[0]/320)),stop=Math.min(sample().frames.length,Math.ceil(span[1]/320));
    ctx.save();ctx.beginPath();ctx.rect(left,28,right-left,244);ctx.clip();
    for(let index=first;index<stop;index++){
      const frame=sample().frames[index], color=colors[frame.control_token]||["#b23636","#fff0ef"];
      ctx.fillStyle=color[1];ctx.fillRect(x(index*320),244,x((index+1)*320)-x(index*320),27);
      ctx.fillStyle=color[0];ctx.fillRect(x(index*320),266,x((index+1)*320)-x(index*320),5);
      ctx.strokeStyle="#e3eaf1";ctx.beginPath();ctx.moveTo(x(index*320),28);ctx.lineTo(x(index*320),273);ctx.stroke();
      if(state.blocks[M.blockKey(sample().id,index)]){ctx.fillStyle="#b17420";ctx.fillRect(x(index*320)+1,244,x((index+1)*320)-x(index*320)-2,4);}
    }
    ["user","assistant"].forEach((role,lane)=>{
      const mid=79+lane*109,color=lane?"#13846f":"#3578c8";
      ctx.fillStyle=lane?"#dff2eaa8":"#dceafca8";ctx.fillRect(x(range[0]*320),mid-43,x(range[1]*320)-x(range[0]*320),86);
      ctx.strokeStyle=color;ctx.strokeRect(x(range[0]*320),mid-43,x(range[1]*320)-x(range[0]*320),86);
      ctx.strokeStyle="#cbd9e2";ctx.beginPath();ctx.moveTo(left,mid);ctx.lineTo(right,mid);ctx.stroke();
      const wave=clip().waveforms[role],begin=Math.max(0,Math.floor((span[0]-clip().start_ms)/wave.step_ms)),end=Math.min(wave.max.length,Math.ceil((span[1]-clip().start_ms)/wave.step_ms));
      ctx.strokeStyle=color;ctx.beginPath();
      for(let i=begin;i<end;i++){const position=x(clip().start_ms+(i+.5)*wave.step_ms);ctx.moveTo(position,mid-Math.min(1,wave.max[i]*gain)*40);ctx.lineTo(position,mid-Math.max(-1,wave.min[i]*gain)*40);}ctx.stroke();
    });
    ctx.strokeStyle="#b56a1d";ctx.setLineDash([4,3]);
    for(const time of item().span_ms){ctx.beginPath();ctx.moveTo(x(time),28);ctx.lineTo(x(time),238);ctx.stroke();}ctx.setLineDash([]);
    if(player){const position=player.currentTime()+clip().start_ms;if(position>=span[0]&&position<=span[1]){ctx.strokeStyle="#183a45";ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(x(position),26);ctx.lineTo(x(position),274);ctx.stroke();ctx.lineWidth=1;}}
    ctx.restore();ctx.font="bold 14px system-ui";
    for(const [lane,role] of ["user","assistant"].entries()){ctx.fillStyle=lane?"#13846f":"#3578c8";ctx.fillText(lane?"Assistant":"User",7,70+lane*109);ctx.font="14px system-ui";ctx.fillStyle="#637785";ctx.fillText(`座位 ${sample().roles[`${role}_output_slot`]}`,7,92+lane*109);ctx.font="bold 14px system-ui";}
    ctx.fillStyle="#637785";ctx.font="14px system-ui";ctx.fillText("原标签",7,256);ctx.fillText(`${seconds(span[0])}–${seconds(span[1])} 秒 · 每格 320 ms`,left,284);
    $("previous-window").disabled=span[0]<=clip().start_ms;$("next-window").disabled=span[1]>=clip().end_ms;
  }
  function animate(){if(animation)return;const tick=()=>{animation=null;renderWaveform();if(player?.source){const now=player.currentTime()+clip().start_ms,span=viewSpan();if(Number($("zoom").value)&&now>=span[1]){viewStart=now;renderStrip();renderTranscripts();}animation=requestAnimationFrame(tick);}};animation=requestAnimationFrame(tick);}
  function renderStrip(){const span=viewSpan(),first=Math.max(0,Math.floor(span[0]/320)),stop=Math.min(sample().frames.length,Math.ceil(span[1]/320));
    $("chunk-strip").replaceChildren(...sample().frames.slice(first,stop).map(frame=>{const index=frame.chunk_index,choice=state.blocks[M.blockKey(sample().id,index)],button=node("button",`chunk${range[0]<=index&&index<range[1]?" selected":""}${choice?" human":""}`),color=colors[frame.control_token]||["#b23636","#fff0ef"];
      button.style.setProperty("--token-color",color[0]);button.style.setProperty("--token-bg",color[1]);button.dataset.chunk=index;
      button.append(node("span","",`#${index}`),node("small","",seconds(frame.span_ms[0])),node("strong","",frame.control_token?.replaceAll("<|","").replaceAll("|>","")||"待定"));
      button.title=`原标签 ${frame.control_token||"未确定"}${choice?`；你的判断 ${M.choiceText(choice)}`:""}`;
      button.onclick=event=>event.shiftKey?setRange(Math.min(range[0],index),Math.max(range[1],index+1)):setRange(index,index+1);return button;}));
    const strip=$("chunk-strip"), focused=strip.querySelector(".selected");
    if(focused)strip.scrollLeft+=focused.getBoundingClientRect().left-strip.getBoundingClientRect().left-strip.clientWidth/2+focused.clientWidth/2;
  }
  function renderSelection(){
    $("selection-label").textContent=`选中 #${range[0]}${range[1]-range[0]>1?`–#${range[1]-1}`:""} · ${M.spanText(selectedSpan())} · ${range[1]-range[0]} 块`;
    const choices=Array.from({length:range[1]-range[0]},(_,i)=>state.blocks[M.blockKey(sample().id,range[0]+i)]);
    const counts=new Map();for(const choice of choices){const text=M.choiceText(choice);counts.set(text,(counts.get(text)||0)+1);}
    $("selection-result").textContent=[...counts].map(([label,count])=>`${label}：${count} 块`).join("；");
    document.querySelectorAll("[data-token]").forEach(button=>{const active=choices.every(choice=>choice?.action==="token"&&choice.token===button.dataset.token);button.classList.toggle("selected",active);button.setAttribute("aria-pressed",String(active));});
    for(const [id,action] of [["keep-selection","keep"],["trim-selection","trim"]])$(id).classList.toggle("selected",choices.every(choice=>choice?.action===action));
    $("decision-status").textContent={pending:"此片段尚未完成",reviewed:"此片段已完成",uncertain:"此片段仍不确定"}[status(item())];
  }
  function editAnswer(fields){state.items[item().id]={...answer(),...fields,status:"pending",updated_at:new Date().toISOString()};save();renderSelection();renderQueue();}
  function apply(action,token=null){M.applyRange(state,sample().id,...range,action,token);
    for(const entry of data.items)if(entry.sample_id===sample().id&&overlaps(entry.chunk_span,range)&&state.items[entry.id])state.items[entry.id]={...state.items[entry.id],status:"pending",updated_at:new Date().toISOString()};
    save();renderSelection();renderStrip();renderWaveform();renderQueue();}
  function finish(uncertain){if(!uncertain&&!M.hasAnswer(state,item())){toast("请先填写一项判断、备注，或选择“仍不确定”。");return;}
    state.items[item().id]={...answer(),status:uncertain?"uncertain":"reviewed",updated_at:new Date().toISOString()};save();renderSelection();renderQueue();navigate(1);}
  function renderTranscripts(){const span=viewSpan(),rows=sample().utterances.filter(utterance=>overlaps([utterance.start_ms,utterance.end_ms],span));
    $("transcripts").replaceChildren(...rows.map(utterance=>{const row=node("div",`transcript${overlaps([utterance.start_ms,utterance.end_ms],selectedSpan())?" active":""}`);row.tabIndex=0;row.setAttribute("role","button");
      row.append(node("span","time",seconds(utterance.start_ms)+" s"),node("span",`role ${utterance.role}`,utterance.role==="user"?"User":"Assistant"),node("span","words",utterance.text));
      const listen=()=>play([Math.max(clip().start_ms,utterance.start_ms),Math.min(clip().end_ms,utterance.end_ms)],utterance.role);row.onclick=listen;row.onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();listen();}};return row;}));
    if(!rows.length)$("transcripts").append(node("p","muted","这个视窗没有对应的原有转写，请以音频为准。"));}
  function renderEvidence(){const entry=item(),container=$("evidence");container.replaceChildren(node("p","evidence-row",`原批次 ${data.source_run} · 同一时段判断 · 音频时间不变`));
    const labels=[...new Set(entry.evidence.map(row=>row.label).filter(Boolean))];if(labels.length)container.append(node("p","evidence-row",`原模型声音判断：${labels.map(value=>({speech:"语音",uncertain:"不确定"}[value]||value)).join("、")}`));
    for(const frame of sample().frames.slice(...entry.chunk_span)){container.append(node("p","evidence-row",`#${frame.chunk_index} ${M.spanText(frame.span_ms)} · 原 token ${frame.control_token||"未确定"} · User 峰值 ${frame.user_energy.peak_pcm16} · Assistant 峰值 ${frame.assistant_energy.peak_pcm16} · 原话权 ${frame.floor_owner||"未确定"}`));}
    if(entry.kind==="coverage_gap")container.append(node("p","evidence-row",`原报告覆盖区间 ${M.spanText(entry.evidence[0].span_ms)}；此页只突出实际缺口，未裁掉任何音频。`));}
  function download(){const blob=new Blob([JSON.stringify(M.exportReview(data,state),null,2)+"\n"],{type:"application/json"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`duplex-review-${data.source_run}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("已导出。请把 JSON 文件发给我，再统一总结规律和修改流程。");}
  async function copy(){const text=M.summaryText(data,state);try{await navigator.clipboard.writeText(text);toast("复核摘要已复制，可粘贴到聊天中。");}catch{$("copy-text").value=text;$("copy-dialog").showModal();$("copy-text").select();}}
  for(const [kind,label] of Object.entries(data.kinds)){const option=node("option","",`${label}（${data.items.filter(item=>item.kind===kind).length}）`);option.value=kind;$("kind-filter").append(option);}
  for(const sample of data.samples){const option=node("option","",`录音 ${sample.number} · ${sample.id.slice(0,8)}`);option.value=sample.number;$("sample-filter").append(option);}
  for(const token of M.tokens){const button=node("button","",token);button.dataset.token=token;button.onclick=()=>apply("token",token);$("token-buttons").append(button);}
  for(const id of ["sample-filter","kind-filter","status-filter"])$(id).onchange=()=>{const indices=visibleIndices();if(indices.length&&!indices.includes(selected))selectItem(indices[0]);else renderQueue();};
  $("previous-item").onclick=()=>navigate(-1);$("next-item").onclick=()=>navigate(1);
  $("range-start").onchange=()=>setRange(Number($("range-start").value),Math.max(range[1],Number($("range-start").value)+1),{focus:true});
  $("range-end").onchange=()=>setRange(Math.min(range[0],Number($("range-end").value)),Number($("range-end").value)+1,{focus:true});
  $("select-issue").onclick=()=>setRange(...item().chunk_span,{focus:true});
  $("keep-selection").onclick=()=>apply("keep");$("trim-selection").onclick=()=>apply("trim");$("clear-selection").onclick=()=>apply("clear");
  $("sound-kind").onchange=()=>editAnswer({sound:$("sound-kind").value});$("review-note").oninput=()=>editAnswer({note:$("review-note").value});$("heard-text").oninput=()=>editAnswer({transcript:$("heard-text").value});
  $("finish-item").onclick=()=>finish(false);$("mark-uncertain").onclick=()=>finish(true);$("reopen-item").onclick=()=>editAnswer({});
  $("play-context").onclick=()=>play(contextSpan());$("play-selection").onclick=()=>play(selectedSpan());$("play-user").onclick=()=>play(selectedSpan(),"user");$("play-assistant").onclick=()=>play(selectedSpan(),"assistant");$("pause-audio").onclick=()=>player?.pause();
  $("speed").onchange=()=>player?.configure({rate:Number($("speed").value)});$("channel").onchange=()=>player?.configure({channel:$("channel").value});
  $("gain").onchange=renderWaveform;$("zoom").onchange=()=>{focusSelection();renderWaveform();renderStrip();renderTranscripts();};
  for(const [id,direction] of [["previous-window",-1],["next-window",1]])$(id).onclick=()=>{const span=viewSpan();viewStart=span[0]+direction*(span[1]-span[0]);renderWaveform();renderStrip();renderTranscripts();};
  $("waveform").onclick=event=>{const {left,right}=geometry(),position=event.clientX-$("waveform").getBoundingClientRect().left;if(position<left||position>right)return;const span=viewSpan(),index=Math.floor((span[0]+(position-left)/(right-left)*(span[1]-span[0]))/320);if(event.shiftKey)setRange(Math.min(range[0],index),Math.max(range[1],index+1));else setRange(index,index+1);};
  $("export-results").onclick=download;$("copy-results").onclick=copy;$("close-copy").onclick=()=>$("copy-dialog").close();
  $("import-results").onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>5*1024*1024)throw Error("文件超过 5 MB，请选择导出的复核 JSON。");state=M.importReview(data,JSON.parse(await file.text()),state);save();selectItem(selected);toast("已导入同一批次的复核结果。");}catch(error){toast(error.message);}event.target.value="";};
  window.addEventListener("resize",()=>{renderWaveform();renderStrip();});
  document.addEventListener("keydown",event=>{if(event.target.closest("input,textarea,select,button")||$("copy-dialog").open)return;if(event.code==="Space"){event.preventDefault();player?.source?player.pause():play(contextSpan());}});
  const params=new URLSearchParams(location.hash.slice(1)), initial=data.items.findIndex(item=>item.id===params.get("issue"));
  $("workspace").hidden=false;save();selectItem(initial>=0?initial:0);
})();
