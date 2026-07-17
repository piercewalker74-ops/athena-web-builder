// ─── Athena Sound Engine v2.1 ─────────────────────────────────────────────────
// Real samples from /sfx with synthesized fallback.
// Fixed: fallback now fires when sample unavailable (.then not .catch).
// Fixed: map pre-warmed on resume() so boot beeps have time to load.
// Fixed: bootBeep -> bootLine (lighter extras), bootReady -> interfaceBoot fanfare.
// Fixed: openPanel has 6 rotating boot-family files.

type SoundMap = Record<string, string[]>;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;
  private volume = 0.38;

  // ── Sample loading ────────────────────────────────────────────────────────
  private soundMap: SoundMap = {};
  private bufferCache = new Map<string, AudioBuffer>();
  private mapFetch: Promise<void> | null = null;

  // ── Background ambient ────────────────────────────────────────────────────
  private bgSource: AudioBufferSourceNode | null = null;
  private bgGain: GainNode | null = null;
  private readonly BG_VOL = 0.045;

  // ── Mouse-move ambient (low_ominous_007 seamless loop) ────────────────────
  private mouseAmbSource: AudioBufferSourceNode | null = null;
  private mouseAmbGain: GainNode | null = null;
  private readonly MOUSE_AMB_VOL = 0.10;
  private readonly MOUSE_AMB_PATH = 'ominous/low_ominous_007.wav';

  // ── Auto-type stream ──────────────────────────────────────────────────────
  private autoTypeActive = false;
  private autoTypeTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── AudioContext + master gain ───────────────────────────────────────────
  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  resume() {
    void this.getCtx().resume();
    // Pre-warm: start loading the map + key buffers now so boot beeps don't miss
    void this.preWarm();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain)    this.masterGain.gain.value    = this.muted ? 0 : this.volume;
    if (this.bgGain)        this.bgGain.gain.value        = this.muted ? 0 : this.BG_VOL;
    if (this.mouseAmbGain)  this.mouseAmbGain.gain.value  = this.muted ? 0 : this.MOUSE_AMB_VOL;
    return this.muted;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.masterGain && !this.muted) this.masterGain.gain.value = v;
  }

  private node(): [AudioContext, GainNode] {
    const ctx = this.getCtx();
    return [ctx, this.masterGain!];
  }

  // ─── Sound-map + buffer loading ───────────────────────────────────────────
  private ensureMap(): Promise<void> {
    if (this.mapFetch) return this.mapFetch;
    this.mapFetch = fetch('/sfx/sound-map.json')
      .then(r => r.json() as Promise<SoundMap>)
      .then(m => { this.soundMap = m; })
      .catch(() => { /* silent — synth fallback covers all events */ });
    return this.mapFetch;
  }

  /** Pre-load the map and prime one buffer from each high-frequency event. */
  private async preWarm(): Promise<void> {
    await this.ensureMap();
    // Load one file from each event likely to fire during boot
    const primeEvents = ['interfaceBoot', 'bootLine', 'typeKey', 'openPanel'];
    await Promise.allSettled(
      primeEvents.map(ev => {
        const file = this.pickFile(ev);
        return file ? this.loadBuffer(file) : Promise.resolve(null);
      }),
    );
  }

  private async loadBuffer(path: string): Promise<AudioBuffer | null> {
    const cached = this.bufferCache.get(path);
    if (cached) return cached;
    try {
      const r = await fetch(`/sfx/${path}`);
      if (!r.ok) return null;
      const arr = await r.arrayBuffer();
      const buf = await this.getCtx().decodeAudioData(arr);
      this.bufferCache.set(path, buf);
      return buf;
    } catch {
      return null;
    }
  }

  private pickFile(event: string): string | null {
    const files = this.soundMap[event];
    if (!files?.length) return null;
    return files[Math.floor(Math.random() * files.length)];
  }

  /**
   * Play a real sample. Returns the source node or null if unavailable.
   * Callers must check the return value and fall back to synthesis if null.
   */
  private async playSample(
    event: string,
    gainLevel = 0.8,
    loop = false,
    dest?: AudioNode,
  ): Promise<AudioBufferSourceNode | null> {
    await this.ensureMap();
    const file = this.pickFile(event);
    if (!file) return null;
    const buf = await this.loadBuffer(file);
    if (!buf) return null;
    if (this.muted && !loop) return null;   // skip (but allow bg loop to init)

    const ctx  = this.getCtx();
    const gain = ctx.createGain();
    const src  = ctx.createBufferSource();
    src.buffer     = buf;
    src.loop       = loop;
    gain.gain.value = this.muted ? 0 : gainLevel;
    src.connect(gain);
    gain.connect(dest ?? this.masterGain ?? ctx.destination);
    src.start();
    return src;
  }

  // ─── Synthesized helpers ──────────────────────────────────────────────────
  private synthChirp(freq1: number, freq2: number, dur: number, vol = 0.22) {
    if (this.muted) return;
    const [ctx, dest] = this.node();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(dest);
    osc.type = 'sine';
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq1, t);
    osc.frequency.exponentialRampToValueAtTime(freq2, t + dur * 0.6);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t); osc.stop(t + dur);
  }

  private synthNoise(dur: number, freq: number, vol = 0.12) {
    if (this.muted) return;
    const [ctx, dest] = this.node();
    const buf  = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * dur * 0.7));
    }
    const src  = ctx.createBufferSource();
    const filt = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filt.type = 'bandpass'; filt.frequency.value = freq; filt.Q.value = 0.5;
    src.buffer = buf;
    src.connect(filt); filt.connect(gain); gain.connect(dest);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t);
  }

  private synthClick(vol = 0.18) {
    // Very short noise click — instant, no decode needed
    if (this.muted) return;
    const [ctx, dest] = this.node();
    const dur  = 0.025;
    const buf  = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.004));
    }
    const src  = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf; gain.gain.value = vol;
    src.connect(gain); gain.connect(dest);
    src.start(ctx.currentTime);
  }

  // ─── Public event API ─────────────────────────────────────────────────────

  /** Boot startup ambient — plays background_001.wav once as the screen loads */
  playBootAmbient() {
    void this.playSample('bootAmbient', 0.80);
  }

  /** Received-message pip — synthesized (needs instant response) */
  commChirp() { this.synthChirp(880, 1760, 0.12, 0.25); }

  /** Sent-message double-blip — synthesized */
  commSend() {
    if (this.muted) return;
    const [ctx, dest] = this.node();
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(dest);
      osc.type = 'square';
      osc.frequency.value = i === 0 ? 440 : 550;
      gain.gain.setValueAtTime(0,    t + i * 0.06);
      gain.gain.linearRampToValueAtTime(0.08, t + i * 0.06 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.07);
      osc.start(t + i * 0.06); osc.stop(t + i * 0.06 + 0.08);
    }
  }

  /** Automation fired — deep thinking pulse */
  motionPing() {
    void this.playSample('thinking', 0.55).then(src => {
      if (!src) this.synthChirp(1200, 400, 0.35, 0.20);
    });
  }

  /** Error / alert klaxon */
  klaxon() {
    void this.playSample('ominous', 0.70).then(src => {
      if (src) return;
      // synth fallback: 3-pulse sawtooth klaxon
      if (this.muted) return;
      const [ctx, dest] = this.node();
      const t = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(dest);
        osc.type = 'sawtooth';
        osc.frequency.value = i % 2 === 0 ? 220 : 180;
        gain.gain.setValueAtTime(0.15, t + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.13);
        osc.start(t + i * 0.15); osc.stop(t + i * 0.15 + 0.14);
      }
    });
  }

  /** Nav click — rotates through 6 boot-family files */
  hydraulicHiss() {
    void this.playSample('openPanel', 0.82).then(src => {
      if (!src) this.synthNoise(0.15, 800, 0.12);
    });
  }

  /** Per-keystroke click — 25-clip rotating pool */
  keyClack() {
    void this.playSample('typeKey', 0.52).then(src => {
      if (!src) this.synthClick(0.18);
    });
  }

  /** User message-input keystroke — auto_typing_002 */
  userTypeKey() {
    void this.playSample('userType', 0.55);
  }

  /**
   * Boot-sequence line beep — uses lighter bootLine sounds (booting_up_* extras).
   * NOT the main fanfare (that's bootReady).
   */
  bootBeep(_freq = 880, _dur = 0.05) {
    void this.playSample('bootLine', 0.60).then(src => {
      if (!src) this.synthChirp(_freq, _freq * 1.4, _dur + 0.02, 0.18);
    });
  }

  /**
   * Boot complete — plays the main interfaceBoot fanfare, then starts bg ambient.
   */
  bootReady() {
    void this.playSample('interfaceBoot', 0.90).then(src => {
      if (!src) {
        const freqs = [440, 554, 659, 880];
        freqs.forEach((f, i) => setTimeout(() => this.synthChirp(f, f * 1.3, 0.08, 0.18), i * 70));
      }
    });
    setTimeout(() => { void this.startBackground(); }, 2200);
  }

  /** AI response complete */
  transmitReceived() { this.synthChirp(1400, 700, 0.22, 0.18); }

  /** Radar/scan sweep — 200→1600 Hz sine over 0.5 s */
  scanSweep() {
    if (this.muted) return;
    const [ctx, dest] = this.node();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(dest);
    osc.type = 'sine';
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(1600, t + 0.45);
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.50);
    osc.start(t); osc.stop(t + 0.50);
  }

  /** Quick scan-hit ping — confirmation blip when a scan resolves */
  scanHit() { this.synthChirp(1400, 1800, 0.07, 0.13); }

  /** Rising alert tone */
  alertTone() {
    void this.playSample('ominous', 0.60).then(src => {
      if (!src) this.synthChirp(300, 600, 0.85, 0.12);
    });
  }

  // ─── Auto-type: plays during AI streaming ─────────────────────────────────
  startAutoType() {
    if (this.autoTypeActive) return;
    this.autoTypeActive = true;
    const burst = () => {
      if (!this.autoTypeActive) return;
      const ev = Math.random() < 0.75 ? 'autoType' : 'autoTypeExtra';
      void this.playSample(ev, 0.48);
      const delay = 650 + Math.random() * 1350;
      this.autoTypeTimer = setTimeout(burst, delay);
    };
    burst();
  }

  stopAutoType() {
    this.autoTypeActive = false;
    if (this.autoTypeTimer !== null) {
      clearTimeout(this.autoTypeTimer);
      this.autoTypeTimer = null;
    }
  }

  // ─── Background ambient loop ──────────────────────────────────────────────
  async startBackground() {
    if (this.bgSource) return;
    await this.ensureMap();
    const ctx = this.getCtx();
    if (ctx.state === 'suspended') return;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);   // bypass master so it stays under slider
    this.bgGain = gain;

    const src = await this.playSample('background', this.BG_VOL, true, gain);
    if (!src) { this.bgGain = null; return; }
    this.bgSource = src;

    // 3s fade-in
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(this.muted ? 0 : this.BG_VOL, t + 3);
  }

  stopBackground() {
    try { this.bgSource?.stop(); } catch { /* already stopped */ }
    this.bgSource = null;
    this.bgGain = null;
  }

  // ─── Mouse-move ambient ───────────────────────────────────────────────────
  async startMouseAmbient() {
    if (this.mouseAmbSource) return;
    const ctx = this.getCtx();
    if (ctx.state === 'suspended') return;

    const buf = await this.loadBuffer(this.MOUSE_AMB_PATH);
    if (!buf || this.mouseAmbSource) return; // guard re-entry after async load

    const gain = ctx.createGain();
    gain.gain.value = this.muted ? 0 : this.MOUSE_AMB_VOL;
    gain.connect(ctx.destination);
    this.mouseAmbGain = gain;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop   = true;   // seamless — Web Audio loops at sample boundary, zero gap
    src.connect(gain);
    src.start();
    this.mouseAmbSource = src;
  }

  stopMouseAmbient() {
    try { this.mouseAmbSource?.stop(); } catch { /* already stopped */ }
    this.mouseAmbSource = null;
    this.mouseAmbGain   = null;
  }
}

export const soundEngine = new SoundEngine();
