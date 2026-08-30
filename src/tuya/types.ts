export interface TuyaConfig {
  accessId: string;
  accessSecret: string;
  deviceId: string;
  endpoint: string;
}

export interface TuyaDataPoint {
  code: string;
  value: any;
}

export interface TuyaDeviceInfo {
  id: string;
  name: string;
  online: boolean;
  status: TuyaDataPoint[];
}

export interface TuyaStatusResponse {
  online: boolean;
  switch_1: boolean;
  cur_power: number;
  cur_current: number;
  cur_voltage: number;
  fault: any;
  rawStatus?: Record<string, any>;
}

export interface TuyaControlRequest {
  on: boolean;
}

export interface TuyaControlResponse {
  success: boolean;
  changed: boolean;
  currentState: boolean;
  message: string;
}
