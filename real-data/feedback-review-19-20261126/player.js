/* One audio clock; source.start schedules clips to their exact sample interval. */
globalThis.DuplexPlayer = class DuplexPlayer {
  constructor(encodedAudio, durationMs, onState) {
    this.encodedAudio = encodedAudio;
    this.durationMs = durationMs;
    this.onState = onState;
    this.positionMs = 0;
    this.endMs = durationMs;
    this.rate = 1;
    this.channel = "both";
    this.requestId = 0;
    this.source = null;
    this.context = null;
    this.readyPromise = null;
    this.buffers = {};
  }

  async prepare() {
    this.context ??= new (window.AudioContext || window.webkitAudioContext)();
    const resumed = this.context.resume();
    if (!this.readyPromise) {
      this.onState("loading");
      this.readyPromise = (async () => {
        const bytes = atob(this.encodedAudio);
        const encoded = new Uint8Array(bytes.length);
        for (let index = 0; index < bytes.length; index++) encoded[index] = bytes.charCodeAt(index);
        const stereo = await this.context.decodeAudioData(encoded.buffer);
        this.buffers.both = stereo;
        ["user", "assistant"].forEach((role, index) => {
          const mono = this.context.createBuffer(1, stereo.length, stereo.sampleRate);
          mono.copyToChannel(stereo.getChannelData(index), 0);
          this.buffers[role] = mono;
        });
        this.encodedAudio = null;
      })().catch(error => { this.readyPromise = null; throw error; });
    }
    await Promise.all([resumed, this.readyPromise]);
  }

  currentTime() {
    if (!this.source) return this.positionMs;
    const elapsedMs = Math.max(0, this.context.currentTime - this.startedAt) * 1000 * this.rate;
    return Math.min(this.endMs, this.positionMs + elapsedMs);
  }

  stopSource() {
    if (!this.source) return;
    this.source.onended = null;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }

  pause() {
    this.requestId++;
    this.positionMs = this.currentTime();
    this.stopSource();
    this.onState("paused");
  }

  seek(timeMs) {
    this.pause();
    this.positionMs = Math.max(0, Math.min(this.durationMs, timeMs));
    this.onState("paused");
  }

  async play(startMs = this.currentTime(), endMs = this.durationMs, channel = this.channel) {
    const requestId = ++this.requestId;
    this.stopSource();
    this.positionMs = Math.max(0, Math.min(this.durationMs, startMs));
    this.endMs = Math.max(this.positionMs, Math.min(this.durationMs, endMs));
    this.channel = channel;
    if (this.endMs <= this.positionMs) { this.onState("paused"); return; }
    await this.prepare();
    if (requestId !== this.requestId) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffers[channel];
    source.playbackRate.value = this.rate;
    source.connect(this.context.destination);
    this.source = source;
    this.startedAt = this.context.currentTime + 0.015;
    source.onended = () => {
      if (this.source !== source) return;
      this.positionMs = this.endMs;
      this.source = null;
      source.disconnect();
      this.onState("paused");
    };
    source.start(this.startedAt, this.positionMs / 1000, (this.endMs - this.positionMs) / 1000);
    this.onState("playing");
  }

  async configure({channel = this.channel, rate = this.rate}) {
    const positionMs = this.currentTime();
    const wasPlaying = Boolean(this.source);
    this.pause();
    this.channel = channel;
    this.rate = rate;
    if (wasPlaying) await this.play(positionMs, this.endMs, channel);
  }
};
