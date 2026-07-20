export abstract class PhysicalAiApi {
  abstract getStatus(): Promise<string>;
}
