declare module "vosk" {
  export function setLogLevel(level: number): void;

  export class Model {
    constructor(modelPath: string);
    free(): void;
  }

  export interface RecognizerOptions {
    model: Model;
    sampleRate: number;
  }

  export interface VoskResult {
    text: string;
  }

  export class Recognizer {
    constructor(options: RecognizerOptions);
    acceptWaveform(data: Buffer): boolean;
    result(): VoskResult;
    finalResult(): VoskResult;
    partialResult(): VoskResult;
    free(): void;
  }
}