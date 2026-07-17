export type DeviceStackParamList = {
  DeviceDetail: {
    deviceId: string;
    deviceName?: string | null;
    assignedImei?: string | null;
  };
  AssignedDevices: undefined;
  V8DeviceManage: {
    deviceId: string;
    deviceName?: string | null;
    showSyncLatestPrompt?: boolean;
    promptToken?: string | number | null;
  };
  ECGMeasurement: undefined;
};
