// AudioWorklet tap (audio thread). Downmixes each render quantum to mono and hands it to the
// DSP worker. Per PRD 6.2 it never blocks, never allocates in steady state, and never posts a
// message per block: it either writes the shared ring buffer or, in the postMessage fallback,
// posts one transferable batch every `batchSize` samples.

import { RingProducer, type RingLayout } from "../shared/ring";

interface TapOptions {
  ring: RingLayout | null;
  /** Fallback transport: samples per posted batch. */
  batchSize: number;
}

class TapProcessor extends AudioWorkletProcessor {
  private readonly producer: RingProducer | null;
  private mono = new Float32Array(128);
  private port2: MessagePort | null = null;
  private batch: Float32Array;
  private readonly batchSize: number;
  private batchFill = 0;
  private batchFrame = 0;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const opts = options.processorOptions as TapOptions;
    this.producer = opts.ring ? new RingProducer(opts.ring) : null;
    this.batchSize = opts.batchSize;
    this.batch = new Float32Array(opts.ring ? 0 : opts.batchSize);
    // In fallback mode the main thread hands us a MessagePort connected straight to the DSP
    // worker, so audio never round-trips through the main thread.
    this.port.onmessage = (e: MessageEvent) => {
      this.port2 = (e.data as { port: MessagePort }).port;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? [];
    const out = outputs[0]?.[0];
    const n = input[0]?.length ?? out?.length ?? 128;
    if (this.mono.length !== n) this.mono = new Float32Array(n); // only if the quantum changes
    const mono = this.mono;

    const channels = input.length;
    if (channels === 0) {
      mono.fill(0);
    } else {
      const first = input[0]!;
      for (let i = 0; i < n; i++) mono[i] = first[i]!;
      for (let c = 1; c < channels; c++) {
        const ch = input[c]!;
        for (let i = 0; i < n; i++) mono[i]! += ch[i]!;
      }
      if (channels > 1) {
        const g = 1 / channels;
        for (let i = 0; i < n; i++) mono[i]! *= g;
      }
    }

    if (this.producer) {
      this.producer.push(mono, currentFrame, n);
    } else {
      this.pushBatch(mono, n);
    }
    return true;
  }

  private pushBatch(mono: Float32Array, n: number): void {
    if (this.batchFill === 0) this.batchFrame = currentFrame;
    this.batch.set(mono.subarray(0, n), this.batchFill);
    this.batchFill += n;
    if (this.batchFill + n > this.batch.length) {
      const full = this.batch.subarray(0, this.batchFill);
      if (this.port2) {
        // Transfer the buffer instead of copying it, then allocate the next one. (Size it from
        // batchSize: the transferred array now reports length 0.)
        this.port2.postMessage({ samples: full, frame: this.batchFrame }, [full.buffer]);
        this.batch = new Float32Array(this.batchSize);
      }
      this.batchFill = 0;
    }
  }
}

registerProcessor("resonance-tap", TapProcessor);
