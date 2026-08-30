import { AutomationEngine, SHUTDOWN_DELAY_MS } from '../../src/automation/engine';
import { AutomationStateStore } from '../../src/automation/stateStore';
import { LgThinQClient } from '../../src/lg/client';
import { TuyaClient } from '../../src/tuya/client';

jest.mock('../../src/lg/client');
jest.mock('../../src/tuya/client');

describe('AutomationEngine — Core Logic & 3-Minute Shutdown Delay', () => {
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

  it('should turn hood ON when induction becomes active (plug currently OFF)', async () => {
    mockLgClient.getCooktopStatus.mockResolvedValueOnce({
      deviceId: 'lg_cooktop',
      deviceName: 'LG Induction',
      modelName: 'BEF3AMB4E',
      online: true,
      isOperating: true,
      powerState: 'ON',
      burners: [{ burnerId: 'b1', isOperating: true, powerLevel: 7 }],
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
      message: 'Plug turned ON',
    });

    const result = await engine.evaluateAndExecute(baseTime);

    expect(result.action).toBe('TURN_ON');
    expect(result.inductionState).toBe('ON');
    expect(result.hoodState).toBe('ON');
    expect(result.changed).toBe(true);
    expect(mockTuyaClient.setPlugState).toHaveBeenCalledWith(true);
  });

  it('should return ALREADY_ON when induction is active and plug is already ON', async () => {
    mockLgClient.getCooktopStatus.mockResolvedValueOnce({
      deviceId: 'lg_cooktop',
      deviceName: 'LG Induction',
      modelName: 'BEF3AMB4E',
      online: true,
      isOperating: true,
      powerState: 'ON',
      burners: [{ burnerId: 'b1', isOperating: true, powerLevel: 5 }],
    });

    mockTuyaClient.getStatus.mockResolvedValueOnce({
      online: true,
      switch_1: true,
      cur_power: 120,
      cur_current: 500,
      cur_voltage: 220,
      fault: null,
    });

    const result = await engine.evaluateAndExecute(baseTime);

    expect(result.action).toBe('ALREADY_ON');
    expect(result.changed).toBe(false);
    expect(mockTuyaClient.setPlugState).not.toHaveBeenCalled();
  });

  it('should WAIT 3-minute delay when cooking stops (keeping hood ON)', async () => {
    // 1st run: Cooktop active at T = 0
    mockLgClient.getCooktopStatus.mockResolvedValueOnce({
      deviceId: 'lg_cooktop',
      deviceName: 'LG Induction',
      modelName: 'BEF3AMB4E',
      online: true,
      isOperating: true,
      powerState: 'ON',
      burners: [{ burnerId: 'b1', isOperating: true, powerLevel: 8 }],
    });
    mockTuyaClient.getStatus.mockResolvedValueOnce({
      online: true,
      switch_1: true,
      cur_power: 120,
      cur_current: 500,
      cur_voltage: 220,
      fault: null,
    });
    await engine.evaluateAndExecute(baseTime);

    // 2nd run: 1 minute later (T = +60s < 180s), cooktop turned OFF
    const tPlus1Min = baseTime + 60 * 1000;
    mockLgClient.getCooktopStatus.mockResolvedValueOnce({
      deviceId: 'lg_cooktop',
      deviceName: 'LG Induction',
      modelName: 'BEF3AMB4E',
      online: true,
      isOperating: false,
      powerState: 'OFF',
      burners: [],
    });
    mockTuyaClient.getStatus.mockResolvedValueOnce({
      online: true,
      switch_1: true,
      cur_power: 120,
      cur_current: 500,
      cur_voltage: 220,
      fault: null,
    });

    const result2 = await engine.evaluateAndExecute(tPlus1Min);

    expect(result2.action).toBe('WAITING_SHUTDOWN_DELAY');
    expect(result2.inductionState).toBe('OFF');
    expect(result2.hoodState).toBe('ON');
    expect(result2.remainingDelaySeconds).toBe(120); // 180s - 60s = 120s
    expect(mockTuyaClient.setPlugState).not.toHaveBeenCalled();
  });

  it('should turn hood OFF after 3 minutes have elapsed since cooking stopped', async () => {
    // 1st run: Cooktop active at T = 0
    mockLgClient.getCooktopStatus.mockResolvedValueOnce({
      deviceId: 'lg_cooktop',
      deviceName: 'LG Induction',
      modelName: 'BEF3AMB4E',
      online: true,
      isOperating: true,
      powerState: 'ON',
      burners: [{ burnerId: 'b1', isOperating: true, powerLevel: 8 }],
    });
    mockTuyaClient.getStatus.mockResolvedValueOnce({
      online: true,
      switch_1: true,
      cur_power: 120,
      cur_current: 500,
      cur_voltage: 220,
      fault: null,
    });
    await engine.evaluateAndExecute(baseTime);

    // 2nd run: 3.5 minutes later (T = +210s >= 180s), cooktop OFF
    const tPlus3Min30s = baseTime + 210 * 1000;
    mockLgClient.getCooktopStatus.mockResolvedValueOnce({
      deviceId: 'lg_cooktop',
      deviceName: 'LG Induction',
      modelName: 'BEF3AMB4E',
      online: true,
      isOperating: false,
      powerState: 'OFF',
      burners: [],
    });
    mockTuyaClient.getStatus.mockResolvedValueOnce({
      online: true,
      switch_1: true,
      cur_power: 120,
      cur_current: 500,
      cur_voltage: 220,
      fault: null,
    });
    mockTuyaClient.setPlugState.mockResolvedValueOnce({
      success: true,
      changed: true,
      currentState: false,
      message: 'Plug turned OFF',
    });

    const result2 = await engine.evaluateAndExecute(tPlus3Min30s);

    expect(result2.action).toBe('TURN_OFF');
    expect(result2.inductionState).toBe('OFF');
    expect(result2.hoodState).toBe('OFF');
    expect(result2.changed).toBe(true);
    expect(mockTuyaClient.setPlugState).toHaveBeenCalledWith(false);
  });

  it('SAFEGUARD: should NOT turn hood OFF if LG ThinQ API fails', async () => {
    mockLgClient.getCooktopStatus.mockRejectedValueOnce(new Error('LG API Timeout'));

    const result = await engine.evaluateAndExecute(baseTime);

    expect(result.action).toBe('SKIPPED_LG_ERROR');
    expect(result.inductionState).toBe('UNKNOWN');
    expect(mockTuyaClient.setPlugState).not.toHaveBeenCalled();
  });

  it('SAFEGUARD: should log error and return safely if Tuya API fails', async () => {
    mockLgClient.getCooktopStatus.mockResolvedValueOnce({
      deviceId: 'lg_cooktop',
      deviceName: 'LG Induction',
      modelName: 'BEF3AMB4E',
      online: true,
      isOperating: true,
      powerState: 'ON',
      burners: [{ burnerId: 'b1', isOperating: true, powerLevel: 5 }],
    });
    mockTuyaClient.getStatus.mockRejectedValueOnce(new Error('Tuya Cloud Network Error'));

    const result = await engine.evaluateAndExecute(baseTime);

    expect(result.action).toBe('SKIPPED_TUYA_ERROR');
    expect(result.inductionState).toBe('ON');
    expect(mockTuyaClient.setPlugState).not.toHaveBeenCalled();
  });
});
