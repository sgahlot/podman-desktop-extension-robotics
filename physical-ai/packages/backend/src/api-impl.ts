import type { PhysicalAiApi } from '/@shared/src/PhysicalAiApi';

export class PhysicalAiApiImpl implements PhysicalAiApi {
  async getStatus(): Promise<string> {
    return 'Physical AI extension is running';
  }
}
