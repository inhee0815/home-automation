export interface LgConfig {
  pat: string;
  clientId: string;
  deviceId: string;
  endpoint: string;
  country: string;
  apiKey: string;
}

export interface LgDeviceItem {
  deviceId: string;
  alias: string;
  deviceType: string;
  modelName: string;
  online: boolean;
}

export interface BurnerState {
  burnerId: string;
  isOperating: boolean;
  powerLevel: number;
}

export interface LgStatusResponse {
  deviceId: string;
  deviceName: string;
  modelName: string;
  online: boolean;
  isOperating: boolean;
  powerState: 'ON' | 'OFF' | 'UNKNOWN';
  burners: BurnerState[];
  rawState?: Record<string, any>;
}
