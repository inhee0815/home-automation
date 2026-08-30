import crypto from 'crypto';
import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';
import {
  LgConfig,
  LgDeviceItem,
  LgStatusResponse,
  BurnerState,
} from './types';

dotenv.config();

export function generateMessageId(): string {
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
  return bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, ''); // 22 characters url-safe base64 without padding
}

export class LgThinQClient {
  private config: LgConfig;
  private axiosInstance: AxiosInstance;

  constructor(config?: Partial<LgConfig>) {
    this.config = {
      pat: config?.pat || process.env.LG_THINQ_PAT || '',
      clientId: config?.clientId || process.env.LG_CLIENT_ID || '',
      deviceId: config?.deviceId || process.env.LG_DEVICE_ID || '',
      country: config?.country || process.env.LG_COUNTRY || 'KR',
      apiKey:
        config?.apiKey ||
        process.env.LG_API_KEY ||
        'v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3',
      endpoint: (
        config?.endpoint ||
        process.env.LG_API_ENDPOINT ||
        'https://api-kic.lgthinq.com'
      ).replace(/\/$/, ''),
    };

    this.axiosInstance = axios.create({
      baseURL: this.config.endpoint,
      timeout: 10000,
    });

    this.axiosInstance.interceptors.request.use((req) => {
      req.headers['Content-Type'] = 'application/json';
      req.headers['Authorization'] = `Bearer ${this.config.pat}`;
      req.headers['x-api-key'] = this.config.apiKey;
      req.headers['x-client-id'] = this.config.clientId;
      req.headers['x-country'] = this.config.country;
      req.headers['x-service-phase'] = 'OP';
      req.headers['x-message-id'] = generateMessageId();
      return req;
    });
  }

  public async getDevices(): Promise<LgDeviceItem[]> {
    if (!this.config.pat) {
      throw new Error('LG_THINQ_PAT environment variable is missing in .env.');
    }

    try {
      let response: any;
      try {
        response = await this.axiosInstance.get('/devices');
      } catch (err: any) {
        if (err.response?.status === 404) {
          response = await this.axiosInstance.get('/v2/devices');
        } else {
          throw err;
        }
      }

      const rawItems =
        response.data?.response ||
        response.data?.result?.response ||
        response.data?.result?.items ||
        response.data?.items ||
        response.data?.result ||
        response.data ||
        [];

      const deviceList = Array.isArray(rawItems) ? rawItems : [rawItems];

      return deviceList.map((item: any) => {
        const info = item.deviceInfo || {};
        return {
          deviceId: item.deviceId || item.id || '',
          alias: info.alias || item.alias || item.deviceName || 'LG Device',
          deviceType: info.deviceType || item.deviceType || 'DEVICE_COOKTOP',
          modelName: info.modelName || item.modelName || 'BEF3AMB4E',
          online: item.online ?? info.online ?? true,
          raw: item,
        };
      });
    } catch (err: any) {
      const status = err.response?.status;
      const apiMsg =
        err.response?.data?.message ||
        err.response?.data?.error?.message ||
        err.response?.data?.code ||
        err.message;

      throw new Error(`LG ThinQ List Devices Error [HTTP ${status || 'Network'}]: ${apiMsg}`);
    }
  }

  public async getCooktopStatus(targetDeviceId?: string): Promise<LgStatusResponse> {
    const deviceId = targetDeviceId || this.config.deviceId;

    if (!this.config.pat) {
      throw new Error('LG_THINQ_PAT environment variable is missing in .env.');
    }

    try {
      let data: any;

      if (deviceId && deviceId !== 'your_lg_cooktop_device_id_here') {
        try {
          const res1 = await this.axiosInstance.get(`/devices/${deviceId}`);
          data = res1.data?.response || res1.data?.result || res1.data;
        } catch (err1: any) {
          if (err1.response?.status === 404) {
            try {
              const res2 = await this.axiosInstance.get(`/devices/${deviceId}/status`);
              data = res2.data?.response || res2.data?.result || res2.data;
            } catch (err2: any) {
              // Ignore and fall through to getDevices fallback
            }
          } else {
            throw err1;
          }
        }
      }

      if (!data) {
        const devices = await this.getDevices();
        const found =
          devices.find((d) => d.deviceId === deviceId) ||
          devices.find((d) => d.deviceType === 'DEVICE_COOKTOP' || d.deviceType === 'COOKTOP') ||
          devices[0];

        if (!found) {
          throw new Error(`LG Induction cooktop device not found in registered ThinQ devices.`);
        }

        data = (found as any).raw || found;
      }

      const activeDeviceId = deviceId || data.deviceId || '';
      return this.parseCooktopStatus(activeDeviceId, data);
    } catch (err: any) {
      const status = err.response?.status;
      const apiMsg =
        err.response?.data?.message ||
        err.response?.data?.error?.message ||
        err.response?.data?.code ||
        err.message;

      throw new Error(`LG ThinQ Device Status Error [HTTP ${status || 'Network'}]: ${apiMsg}`);
    }
  }

  public parseCooktopStatus(deviceId: string, rawData: any): LgStatusResponse {
    const root = rawData.response || rawData.result || rawData;
    const info = root.deviceInfo || rawData.deviceInfo || {};

    const deviceName = info.alias || rawData.alias || rawData.deviceName || '전기레인지';
    const modelName = info.modelName || rawData.modelName || rawData.model || 'BEF3AMB4E';
    const online = rawData.online ?? info.online ?? true;

    const burners: BurnerState[] = [];
    let isOperating = false;
    let powerState: 'ON' | 'OFF' | 'UNKNOWN' = 'OFF';

    // Check operationState from LG ThinQ API
    const opState = String(
      root.operation?.operationState ||
      root.operationState ||
      root.cooktopState ||
      root.powerState ||
      root.operation ||
      ''
    ).toUpperCase();

    if (['RUNNING', 'COOKING', 'POWER_ON', 'ON', 'WORKING', 'COOK'].includes(opState)) {
      isOperating = true;
      powerState = 'ON';
    }

    // Check official LG ThinQ cookingZone array
    const cookingZone = Array.isArray(root.cookingZone) ? root.cookingZone : [];
    if (cookingZone.length > 0) {
      for (const zone of cookingZone) {
        const locationName = zone.location?.locationName || zone.burnerId || 'BURNER';
        const zoneState = String(zone.cookingZone?.currentState || '').toUpperCase();
        const level = Number(zone.power?.powerLevel || zone.powerLevel || 0);

        const active = zoneState === 'COOK' || level > 0;
        burners.push({
          burnerId: locationName,
          isOperating: active,
          powerLevel: level,
        });

        if (active) {
          isOperating = true;
          powerState = 'ON';
        }
      }
    } else {
      // Fallback for flat state objects
      const stateObj = root.state || root.status || root;
      if (typeof stateObj === 'object' && stateObj !== null) {
        const burnerKeys = Object.keys(stateObj).filter((k) =>
          /burner|element|flex|left|right|center/i.test(k)
        );

        for (const key of burnerKeys) {
          const val = stateObj[key];
          let level = 0;
          let active = false;

          if (typeof val === 'number') {
            level = val;
            active = level > 0;
          } else if (typeof val === 'object' && val !== null) {
            level = Number(val.powerLevel || val.level || val.power || 0);
            active = val.state === 'ON' || val.isOperating || level > 0;
          }

          burners.push({
            burnerId: key,
            isOperating: active,
            powerLevel: level,
          });

          if (active) {
            isOperating = true;
            powerState = 'ON';
          }
        }
      }
    }

    return {
      deviceId: deviceId || rawData.deviceId || '',
      deviceName,
      modelName,
      online,
      isOperating,
      powerState,
      burners,
      rawState: root,
    };
  }
}
