// AudioWorkletGlobalScope is not covered by any built-in TypeScript lib.

declare const sampleRate: number;
declare const currentFrame: number;
declare const currentTime: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

interface AudioWorkletNodeOptions {
  numberOfInputs?: number;
  numberOfOutputs?: number;
  outputChannelCount?: number[];
  processorOptions?: unknown;
}

declare function registerProcessor(
  name: string,
  ctor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

// Minimal MessagePort typing; the full DOM lib isn't available in the worklet scope.
interface MessageEvent<T = unknown> {
  readonly data: T;
}
interface MessagePort {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: unknown[]): void;
}
