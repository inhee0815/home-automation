import axios from 'axios';
import { TuyaClient } from '../../src/tuya/client';
import { handler as tuyaStatusHandler } from '../../netlify/functions/tuya-status';
import { handler as tuyaControlHandler } from '../../netlify/functions/tuya-control';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Tuya Client & API Endpoints', () => {
  const dummyConfig = {
    accessId: 'test_access_id',
    accessSecret: 'test_access_secret',
    deviceId: 'test_device_id',
    endpoint: 'https://openapi.tuyaus.com',
  };

  let mockGet: jest.Mock;
  let mockPost: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGet = jest.fn();
    mockPost = jest.fn();
    mockedAxios.create.mockReturnValue({
      get: mockGet,
      post: mockPost,
    } as any);
  });

  describe('TuyaClient', () => {
    it('should fetch access token and retrieve device status', async () => {
      // Mock token response
      mockGet.mockResolvedValueOnce({
        data: {
          success: true,
          result: { access_token: 'mock_token_123', expire_time: 7200 },
        },
      });

      // Mock device details response
      mockGet.mockResolvedValueOnce({
        data: {
          success: true,
          result: {
            id: 'test_device_id',
            name: 'Smart Plug',
            online: true,
            status: [
              { code: 'switch_1', value: true },
              { code: 'cur_power', value: 150 },
              { code: 'cur_current', value: 680 },
              { code: 'cur_voltage', value: 2200 },
              { code: 'fault', value: 0 },
            ],
          },
        },
      });

      const client = new TuyaClient(dummyConfig);
      const status = await client.getStatus();

      expect(status).toEqual({
        online: true,
        switch_1: true,
        cur_power: 150,
        cur_current: 680,
        cur_voltage: 2200,
        fault: 0,
      });

      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('should be idempotent when requesting state that matches current state', async () => {
      // Mock token response
      mockGet.mockResolvedValueOnce({
        data: {
          success: true,
          result: { access_token: 'mock_token_123', expire_time: 7200 },
        },
      });

      // Mock device details: switch_1 is already true
      mockGet.mockResolvedValueOnce({
        data: {
          success: true,
          result: {
            id: 'test_device_id',
            online: true,
            status: [{ code: 'switch_1', value: true }],
          },
        },
      });

      const client = new TuyaClient(dummyConfig);
      const result = await client.setPlugState(true);

      expect(result.changed).toBe(false);
      expect(result.currentState).toBe(true);
      // Post command should NOT be called because plug is already ON
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should send control command when target state differs from current state', async () => {
      // Mock token response
      mockGet.mockResolvedValueOnce({
        data: {
          success: true,
          result: { access_token: 'mock_token_123', expire_time: 7200 },
        },
      });

      // Mock device status: currently OFF (switch_1: false)
      mockGet.mockResolvedValueOnce({
        data: {
          success: true,
          result: {
            id: 'test_device_id',
            online: true,
            status: [{ code: 'switch_1', value: false }],
          },
        },
      });

      // Mock command post response
      mockPost.mockResolvedValueOnce({
        data: {
          success: true,
          result: true,
        },
      });

      const client = new TuyaClient(dummyConfig);
      const result = await client.setPlugState(true);

      expect(result.changed).toBe(true);
      expect(result.currentState).toBe(true);
      expect(mockPost).toHaveBeenCalledWith(
        '/v1.0/devices/test_device_id/commands',
        { commands: [{ code: 'switch_1', value: true }] },
        expect.any(Object)
      );
    });
  });

  describe('GET /api/tuya-status function', () => {
    it('should return 405 for non-GET requests', async () => {
      const response = await tuyaStatusHandler({ httpMethod: 'POST' } as any, {} as any);
      expect(response?.statusCode).toBe(405);
    });
  });

  describe('POST /api/tuya-control function', () => {
    it('should validate request body and reject invalid JSON or non-boolean "on"', async () => {
      const responseInvalidJson = await tuyaControlHandler(
        { httpMethod: 'POST', body: 'invalid-json' } as any,
        {} as any
      );
      expect(responseInvalidJson?.statusCode).toBe(400);

      const responseNonBoolean = await tuyaControlHandler(
        { httpMethod: 'POST', body: JSON.stringify({ on: 'yes' }) } as any,
        {} as any
      );
      expect(responseNonBoolean?.statusCode).toBe(400);
    });
  });
});
