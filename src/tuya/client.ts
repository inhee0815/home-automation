import crypto from 'crypto';
import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';
import {
  TuyaConfig,
  TuyaDeviceInfo,
  TuyaStatusResponse,
  TuyaControlResponse,
} from './types';

dotenv.config();

export class TuyaClient {
  private config: TuyaConfig;
  private axiosInstance: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpireTime: number = 0;

  constructor(config?: Partial<TuyaConfig>) {
    this.config = {
      accessId: config?.accessId || process.env.TUYA_ACCESS_ID || '',
      accessSecret: config?.accessSecret || process.env.TUYA_ACCESS_SECRET || '',
      deviceId: config?.deviceId || process.env.TUYA_DEVICE_ID || '',
      endpoint: (
        config?.endpoint ||
        process.env.TUYA_API_ENDPOINT ||
        'https://openapi.tuyaus.com'
      ).replace(/\/$/, ''),
    };

    this.axiosInstance = axios.create({
      baseURL: this.config.endpoint,
      timeout: 10000,
    });
  }

  private sha256(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  private calcSign(
    method: string,
    pathAndQuery: string,
    bodyString: string = '',
    accessToken: string = ''
  ): { sign: string; timestamp: string; nonce: string } {
    const timestamp = Date.now().toString();
    const nonce = '';
    const contentSha256 = this.sha256(bodyString);
    const headersString = '';
    const stringToSign = [method.toUpperCase(), contentSha256, headersString, pathAndQuery].join('\n');
    
    const signStr = this.config.accessId + accessToken + timestamp + nonce + stringToSign;
    const sign = crypto
      .createHmac('sha256', this.config.accessSecret)
      .update(signStr, 'utf8')
      .digest('hex')
      .toUpperCase();

    return { sign, timestamp, nonce };
  }

  public async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpireTime - 60000) {
      return this.accessToken;
    }

    if (!this.config.accessId || !this.config.accessSecret) {
      throw new Error('TUYA_ACCESS_ID or TUYA_ACCESS_SECRET environment variable is missing.');
    }

    const path = '/v1.0/token?grant_type=1';
    const { sign, timestamp } = this.calcSign('GET', path, '', '');

    const response = await this.axiosInstance.get(path, {
      headers: {
        client_id: this.config.accessId,
        sign,
        t: timestamp,
        sign_method: 'HMAC-SHA256',
      },
    });

    if (!response.data?.success) {
      throw new Error(`Tuya token fetch failed: ${response.data?.msg || 'Unknown error'}`);
    }

    const { access_token, expire_time } = response.data.result;
    this.accessToken = access_token;
    // expire_time is given in seconds (e.g. 7200)
    this.tokenExpireTime = Date.now() + (expire_time || 7200) * 1000;

    return access_token;
  }

  public async getDeviceDetails(): Promise<TuyaDeviceInfo> {
    if (!this.config.deviceId) {
      throw new Error('TUYA_DEVICE_ID environment variable is missing.');
    }

    const token = await this.getAccessToken();
    const path = `/v1.0/devices/${this.config.deviceId}`;
    const { sign, timestamp } = this.calcSign('GET', path, '', token);

    const response = await this.axiosInstance.get(path, {
      headers: {
        client_id: this.config.accessId,
        access_token: token,
        sign,
        t: timestamp,
        sign_method: 'HMAC-SHA256',
      },
    });

    if (!response.data?.success) {
      throw new Error(`Tuya get device details failed: ${response.data?.msg || 'Unknown error'}`);
    }

    return response.data.result as TuyaDeviceInfo;
  }

  public async getStatus(): Promise<TuyaStatusResponse> {
    const device = await this.getDeviceDetails();
    const statusArray = device.status || [];

    const getVal = (code: string, defaultVal: any = null) => {
      const dp = statusArray.find((item) => item.code === code);
      return dp !== undefined ? dp.value : defaultVal;
    };

    return {
      online: device.online ?? false,
      switch_1: Boolean(getVal('switch_1', false)),
      cur_power: Number(getVal('cur_power', 0)),
      cur_current: Number(getVal('cur_current', 0)),
      cur_voltage: Number(getVal('cur_voltage', 0)),
      fault: getVal('fault', null),
    };
  }

  public async setPlugState(targetOn: boolean): Promise<TuyaControlResponse> {
    const currentStatus = await this.getStatus();

    if (currentStatus.switch_1 === targetOn) {
      return {
        success: true,
        changed: false,
        currentState: targetOn,
        message: `Plug is already ${targetOn ? 'ON' : 'OFF'}. No action needed.`,
      };
    }

    const token = await this.getAccessToken();
    const path = `/v1.0/devices/${this.config.deviceId}/commands`;
    const payload = {
      commands: [
        {
          code: 'switch_1',
          value: targetOn,
        },
      ],
    };
    const bodyString = JSON.stringify(payload);
    const { sign, timestamp } = this.calcSign('POST', path, bodyString, token);

    const response = await this.axiosInstance.post(path, payload, {
      headers: {
        'Content-Type': 'application/json',
        client_id: this.config.accessId,
        access_token: token,
        sign,
        t: timestamp,
        sign_method: 'HMAC-SHA256',
      },
    });

    if (!response.data?.success) {
      throw new Error(`Tuya send command failed: ${response.data?.msg || 'Unknown error'}`);
    }

    return {
      success: true,
      changed: true,
      currentState: targetOn,
      message: `Plug successfully turned ${targetOn ? 'ON' : 'OFF'}.`,
    };
  }
}
