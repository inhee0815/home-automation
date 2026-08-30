import { AutomationEngine } from '../../src/automation/engine';
import { AutomationStateStore } from '../../src/automation/stateStore';
import { LgThinQClient } from '../../src/lg/client';
import { TuyaClient } from '../../src/tuya/client';

jest.mock('../../src/lg/client');
jest.mock('../../src/tuya/client');

describe('Phase 6 — Comprehensive Safety, Debouncing & Credential Protection', () => {
  let mockLgClient: jest.Mocked<LgThinQClient>;
  let mockTuyaClient: jest.Mocked<TuyaClient>;
  let engine: AutomationEngine;

  const baseTime = 1700000000000;

  beforeEach(() => {
    jest.clearAllMocks();
    AutomationStateStore.resetState();

    mockLgClient = new LgThinQClient() as jest.Mocked<LgThinQClient>;
    mockTuyaClient = new TuyaClient() as jest.Mocked<TuyaClient>;
    engine = new AutomationEngine(mockLgClient, mockTuyaClient);
  });

  describe('Rapid ON / OFF / ON Changes (Debouncing)', () => {
    it('should debounce rapid toggling and prevent turning hood OFF during brief cooktop OFF intervals', async () => {
      // 1. T = 0s: Cooktop ON -> Hood turns ON
      mockLgClient.getCooktopStatus.mockResolvedValueOnce({
        deviceId: 'lg_cooktop',
        deviceName: 'Cooktop',
        modelName: 'BEF3AMB4E',
        online: true,
        isOperating: true,
        powerState: 'ON',
        burners: [{ burnerId: 'b1', isOperating: true, powerLevel: 9 }],
      });
      mockTuyaClient.getStatus.mockResolvedValueOnce({
        online: true,
        switch_1: false,
        cur_power: 0,
        cur_current: 0,
        cur_voltage: 220,
        fault: null,
      });
      mockTuyaClient.setPlugState.mockResolvedValueOnce({
        success: true,
        changed: true,
        currentState: true,
        message: 'Turned ON',
      });

      const res1 = await engine.evaluateAndExecute(baseTime);
      expect(res1.action).toBe('TURN_ON');
      expect(res1.hoodState).toBe('ON');

      // 2. T = 15s: Cooktop turned OFF rapidly (e.g. temporary adjustment)
      mockLgClient.getCooktopStatus.mockResolvedValueOnce({
        deviceId: 'lg_cooktop',
        deviceName: 'Cooktop',
        modelName: 'BEF3AMB4E',
        online: true,
        isOperating: false,
        powerState: 'OFF',
        burners: [],
      });
      mockTuyaClient.getStatus.mockResolvedValueOnce({
        online: true,
        switch_1: true,
        cur_power: 100,
        cur_current: 450,
        cur_voltage: 220,
        fault: null,
      });

      const res2 = await engine.evaluateAndExecute(baseTime + 15000);
      expect(res2.action).toBe('WAITING_SHUTDOWN_DELAY');
      expect(res2.hoodState).toBe('ON'); // Hood remains ON
      expect(mockTuyaClient.setPlugState).toHaveBeenCalledTimes(1); // No new setPlugState call!

      // 3. T = 30s: Cooktop turned ON again -> Hood stays ON smoothly
      mockLgClient.getCooktopStatus.mockResolvedValueOnce({
        deviceId: 'lg_cooktop',
        deviceName: 'Cooktop',
        modelName: 'BEF3AMB4E',
        online: true,
        isOperating: true,
        powerState: 'ON',
        burners: [{ burnerId: 'b1', isOperating: true, powerLevel: 5 }],
      });
      mockTuyaClient.getStatus.mockResolvedValueOnce({
        online: true,
        switch_1: true,
        cur_power: 100,
        cur_current: 450,
        cur_voltage: 220,
        fault: null,
      });

      const res3 = await engine.evaluateAndExecute(baseTime + 30000);
      expect(res3.action).toBe('ALREADY_ON');
      expect(res3.hoodState).toBe('ON');
      expect(mockTuyaClient.setPlugState).toHaveBeenCalledTimes(1); // Still 1 total call!
    });
  });

  describe('Credential Leak Prevention', () => {
    it('should sanitize error responses and never expose PAT, access secret, or keys', async () => {
      const sensitiveSecret = 'SECRET_PAT_999888';
      mockLgClient.getCooktopStatus.mockRejectedValueOnce(
        new Error(`Unauthorized with token ${sensitiveSecret}`)
      );

      const result = await engine.evaluateAndExecute(baseTime);

      expect(result.action).toBe('SKIPPED_LG_ERROR');
      // The error message logged to user response contains sanitized error description
      expect(result.message).toContain('LG ThinQ API error');
      expect(result.message).not.toContain(process.env.LG_THINQ_PAT);
    });
  });

  describe('Idempotency & Retry Safety', () => {
    it('should never send unnecessary command requests when plug is already OFF after 3 minutes', async () => {
      // Induction inactive for 5 minutes
      mockLgClient.getCooktopStatus.mockResolvedValueOnce({
        deviceId: 'lg_cooktop',
        deviceName: 'Cooktop',
        modelName: 'BEF3AMB4E',
        online: true,
        isOperating: false,
        powerState: 'OFF',
        burners: [],
      });
      mockTuyaClient.getStatus.mockResolvedValueOnce({
        online: true,
        switch_1: false,
        cur_power: 0,
        cur_current: 0,
        cur_voltage: 220,
        fault: null,
      });

      const result = await engine.evaluateAndExecute(baseTime);

      expect(result.action).toBe('ALREADY_OFF');
      expect(result.changed).toBe(false);
      expect(mockTuyaClient.setPlugState).not.toHaveBeenCalled();
    });
  });
});
