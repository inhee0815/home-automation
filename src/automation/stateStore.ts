import { getStore } from '@netlify/blobs';

export type Power = 'ON' | 'OFF';
export interface HoodState {
  induction: Power | 'UNKNOWN';
  desired: Power | 'UNKNOWN';
  confirmed: Power | 'UNKNOWN';
  offDetectedAt: number | null;
  lastCommandAt: number | null;
  lastVerifiedAt: number | null;
  failureCount: number;
  nextRetryAt: number;
  updatedAt: number;
}
export interface StateRepository {
  load(): Promise<HoodState | null>;
  save(value: HoodState): Promise<void>;
}
export class BlobStateRepository implements StateRepository {
  private store() {
    return getStore({
      name: process.env.AUTOMATION_BLOB_STORE || 'home-automation-prod',
      consistency: 'eventual',
    });
  }
  async load(): Promise<HoodState | null> {
    return await this.store().get('hood-state', { type: 'json', consistency: 'eventual' }) as HoodState | null;
  }
  async save(value: HoodState): Promise<void> {
    await this.store().setJSON('hood-state', value);
  }
}
