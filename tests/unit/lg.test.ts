import axios from 'axios';
import { LgThinQClient, generateMessageId } from '../../src/lg/client';
import { handler as lgDevicesHandler } from '../../netlify/functions/lg-devices';
import { handler as lgStatusHandler } from '../../netlify/functions/lg-status';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('LG ThinQ Client & API Endpoints', () => {
  const dummyConfig = {
    pat: 'mock_lg_pat_123',
    clientId: 'mock_client_id_456',
    deviceId: 'mock_device_id_789',
    country: 'KR',
    apiKey: 'v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3',
    endpoint: 'https://thinq-connect.lgthinq.com',
  };

  let mockGet: jest.Mock;
  let mockInterceptorsUse: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGet = jest.fn();
    mockInterceptorsUse = jest.fn();
    mockedAxios.create.mockReturnValue({
      get: mockGet,
      interceptors: {
        request: {
          use: mockInterceptorsUse,
        },
      },
    } as any);
  });

  describe('generateMessageId', () => {
    it('should generate a 22-character url-safe base64 string without padding', () => {
      const msgId = generateMessageId();
      expect(msgId).toHaveLength(22);
      expect(msgId).not.toContain('+');
      expect(msgId).not.toContain('/');
      expect(msgId).not.toContain('=');
    });
  });

  describe('LgThinQClient', () => {
    it('should list registered devices', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          result: {
            items: [
              {
                deviceId: 'cooktop_001',
                alias: 'My LG Induction',
                deviceType: 'COOKTOP',
                modelName: 'BEF3AMB4E',
                online: true,
              },
            ],
          },
        },
      });

      const client = new LgThinQClient(dummyConfig);
      const devices = await client.getDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0]).toEqual(
        expect.objectContaining({
          deviceId: 'cooktop_001',
          alias: 'My LG Induction',
          deviceType: 'COOKTOP',
          modelName: 'BEF3AMB4E',
          online: true,
        })
      );
      expect(mockInterceptorsUse).toHaveBeenCalled();
    });

    it('should detect operating state when a burner is active', () => {
      const client = new LgThinQClient(dummyConfig);

      const activeState = {
        alias: 'Kitchen Cooktop',
        modelName: 'BEF3AMB4E',
        online: true,
        state: {
          burner1Power: 7,
          burner2Power: 0,
          operationState: 'RUNNING',
        },
      };

      const parsed = client.parseCooktopStatus('mock_device_id_789', activeState);

      expect(parsed.isOperating).toBe(true);
      expect(parsed.powerState).toBe('ON');
      expect(parsed.burners).toEqual(
        expect.arrayContaining([
          { burnerId: 'burner1Power', isOperating: true, powerLevel: 7 },
          { burnerId: 'burner2Power', isOperating: false, powerLevel: 0 },
        ])
      );
    });

    it('should detect stopped state when all burners are OFF', () => {
      const client = new LgThinQClient(dummyConfig);

      const stoppedState = {
        alias: 'Kitchen Cooktop',
        modelName: 'BEF3AMB4E',
        online: true,
        state: {
          burner1Power: 0,
          burner2Power: 0,
          operationState: 'STANDBY',
        },
      };

      const parsed = client.parseCooktopStatus('mock_device_id_789', stoppedState);

      expect(parsed.isOperating).toBe(false);
      expect(parsed.powerState).toBe('OFF');
    });
  });

  describe('GET /api/lg-devices function', () => {
    it('should return 405 for non-GET requests', async () => {
      const response = await lgDevicesHandler({ httpMethod: 'POST' } as any, {} as any);
      expect(response?.statusCode).toBe(405);
    });
  });

  describe('GET /api/lg-status function', () => {
    it('should return 405 for non-GET requests', async () => {
      const response = await lgStatusHandler({ httpMethod: 'POST' } as any, {} as any);
      expect(response?.statusCode).toBe(405);
    });
  });
});
