import React, { createContext, useContext } from 'react';
import { useBleDeviceManager } from './useBleDeviceManager';

const BleContext = createContext<ReturnType<typeof useBleDeviceManager> | null>(null);

export const BleProvider = ({ children }: { children: React.ReactNode }) => {
  const ble = useBleDeviceManager();
  return <BleContext.Provider value={ble}>{children}</BleContext.Provider>;
};

export function useBle() {
  const ctx = useContext(BleContext);
  if (!ctx) {
    throw new Error('useBle must be used within BleProvider');
  }
  return ctx;
}
