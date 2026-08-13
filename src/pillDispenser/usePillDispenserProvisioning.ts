import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { espBlufi } from './nativeEspBlufi';
import type {
  EspBlufiConnectionStage,
  EspBlufiDevice,
  EspBlufiWifiNetwork,
} from './types';

async function requestBluetoothPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  const permissions =
    Platform.Version >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every(
    permission => result[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
}

function readableError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export function usePillDispenserProvisioning() {
  const discoveredDeviceCountRef = useRef(0);
  const connectionEncryptedRef = useRef(false);
  const wifiScanRequestRef = useRef(0);
  const [devices, setDevices] = useState<EspBlufiDevice[]>([]);
  const [wifiNetworks, setWifiNetworks] = useState<EspBlufiWifiNetwork[]>([]);
  const [stage, setStage] = useState<EspBlufiConnectionStage>('idle');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [connectedWifiSsid, setConnectedWifiSsid] = useState<string | null>(
    null,
  );
  const [alternateModeAvailable, setAlternateModeAvailable] = useState(false);
  const [connectionEncrypted, setConnectionEncrypted] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    'Put the pill dispenser in Wi-Fi setup mode, then scan.',
  );
  const [error, setError] = useState<string | null>(
    espBlufi.isAvailable
      ? null
      : 'ESP-BluFi is unavailable until the native app is rebuilt.',
  );

  useEffect(() => {
    const requestWifiNetworks = () => {
      const requestId = ++wifiScanRequestRef.current;
      espBlufi
        .requestWifiScan()
        .then(() => {
          setTimeout(() => {
            if (wifiScanRequestRef.current !== requestId) return;
            setStatusMessage(current =>
              current.includes('Reading nearby Wi-Fi networks')
                ? 'The dispenser did not return a network list. Enter your 2.4 GHz Wi-Fi name manually below.'
                : current,
            );
          }, 8000);
        })
        .catch(requestError => {
          setError(
            readableError(requestError, 'Unable to scan Wi-Fi networks.'),
          );
        });
    };

    const deviceSubscription = espBlufi.onDeviceFound(device => {
      if (!device?.id) return;
      setDevices(previous => {
        const next = previous.filter(item => item.id !== device.id);
        next.push({
          id: device.id,
          name: device.name || 'Pill Dispenser',
          rssi: typeof device.rssi === 'number' ? device.rssi : null,
          isConnectable: device.isConnectable !== false,
          isLikelyBluFi: device.isLikelyBluFi === true,
        });
        discoveredDeviceCountRef.current = next.length;
        return next.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
      });
    });

    const stateSubscription = espBlufi.onState(event => {
      switch (event.state) {
        case 'scanning':
          setStage('scanning');
          setStatusMessage('Scanning for nearby BluFi pill dispensers…');
          break;
        case 'scanStopped':
          setStage(current => (current === 'scanning' ? 'idle' : current));
          setStatusMessage(current => {
            if (!current.startsWith('Scanning')) return current;
            return discoveredDeviceCountRef.current > 0
              ? 'Select your pill dispenser from the nearby BLE devices.'
              : 'No BLE devices found. Confirm the dispenser is in setup mode and nearby.';
          });
          break;
        case 'connecting':
          setStage('connecting');
          setStatusMessage(
            connectionEncryptedRef.current
              ? 'Connecting securely to the pill dispenser…'
              : 'Connecting to the pill dispenser in compatibility mode…',
          );
          break;
        case 'connected':
          setStage('securing');
          setStatusMessage(
            connectionEncryptedRef.current
              ? 'Connected. Establishing an encrypted BluFi session…'
              : 'Connected. Starting the BluFi compatibility session…',
          );
          break;
        case 'secure':
          connectionEncryptedRef.current = true;
          setConnectionEncrypted(true);
          setAlternateModeAvailable(false);
          setStage('ready');
          setStatusMessage(
            'Secure connection ready. Reading nearby Wi-Fi networks…',
          );
          setError(null);
          requestWifiNetworks();
          break;
        case 'compatible':
          connectionEncryptedRef.current = false;
          setConnectionEncrypted(false);
          setAlternateModeAvailable(false);
          setStage('ready');
          setStatusMessage(
            'Connected in compatibility mode. Reading nearby Wi-Fi networks…',
          );
          setError(null);
          requestWifiNetworks();
          break;
        case 'securityUnsupported':
          setStage('error');
          setAlternateModeAvailable(true);
          setError(
            event.message ||
              (connectionEncryptedRef.current
                ? 'This dispenser did not answer the standard encrypted BluFi handshake.'
                : 'This dispenser did not answer in BluFi compatibility mode.'),
          );
          break;
        case 'provisioning':
          setStage('provisioning');
          setStatusMessage(
            connectionEncryptedRef.current
              ? `Sending ${event.ssid || 'Wi-Fi'} credentials securely…`
              : `Sending ${
                  event.ssid || 'Wi-Fi'
                } credentials in compatibility mode…`,
          );
          break;
        case 'configured':
          setStage('provisioning');
          setStatusMessage(
            'Credentials sent. Waiting for the dispenser to join Wi-Fi…',
          );
          break;
        case 'wifiConnected':
          setStage('connected');
          setConnectedWifiSsid(event.ssid || null);
          setStatusMessage(
            event.ssid
              ? `Pill dispenser is connected to ${event.ssid}.`
              : 'Pill dispenser is connected to Wi-Fi.',
          );
          setError(null);
          break;
        case 'disconnected':
          setStage(current => (current === 'connected' ? current : 'idle'));
          setStatusMessage(current =>
            current === 'Pill dispenser is connected to Wi-Fi.'
              ? current
              : 'Bluetooth disconnected. Scan again if setup is not complete.',
          );
          break;
        case 'error':
          setStage('error');
          setError(event.message || 'Pill dispenser setup failed.');
          break;
      }
    });

    const wifiSubscription = espBlufi.onWifiNetworks(event => {
      wifiScanRequestRef.current += 1;
      const unique = new Map<string, EspBlufiWifiNetwork>();
      (event.networks || []).forEach(network => {
        const ssid = network.ssid?.trim();
        if (!ssid) return;
        const existing = unique.get(ssid);
        if (!existing || network.rssi > existing.rssi) {
          unique.set(ssid, { ssid, rssi: network.rssi });
        }
      });
      setWifiNetworks(
        Array.from(unique.values()).sort((a, b) => b.rssi - a.rssi),
      );
      setStatusMessage(
        unique.size > 0
          ? 'Choose the Wi-Fi network for this pill dispenser.'
          : 'No Wi-Fi networks were returned. You can enter the network name manually.',
      );
    });

    const statusSubscription = espBlufi.onWifiStatus(event => {
      if (event.connected) {
        setStage('connected');
        setConnectedWifiSsid(event.ssid || null);
        setStatusMessage(
          event.ssid
            ? `Pill dispenser is connected to ${event.ssid}.`
            : 'Pill dispenser is connected to Wi-Fi.',
        );
        setError(null);
      } else if (event.message) {
        setStatusMessage(event.message);
      }
    });

    return () => {
      deviceSubscription.remove();
      stateSubscription.remove();
      wifiSubscription.remove();
      statusSubscription.remove();
      wifiScanRequestRef.current += 1;
      espBlufi.stopScan().catch(() => {});
      espBlufi.disconnect().catch(() => {});
    };
  }, []);

  const startScan = useCallback(async () => {
    setError(null);
    wifiScanRequestRef.current += 1;
    discoveredDeviceCountRef.current = 0;
    setDevices([]);
    setWifiNetworks([]);
    setConnectedWifiSsid(null);
    setSelectedDeviceId(null);
    setAlternateModeAvailable(false);
    connectionEncryptedRef.current = false;
    setConnectionEncrypted(false);

    if (!espBlufi.isAvailable) {
      setStage('error');
      setError('ESP-BluFi is unavailable until the native app is rebuilt.');
      return;
    }

    try {
      const permissionGranted = await requestBluetoothPermission();
      if (!permissionGranted) {
        setStage('error');
        setError(
          'Bluetooth permission is required to find the pill dispenser.',
        );
        return;
      }
      await espBlufi.startScan();
    } catch (scanError) {
      setStage('error');
      setError(readableError(scanError, 'Unable to scan for pill dispensers.'));
    }
  }, []);

  const stopScan = useCallback(async () => {
    try {
      await espBlufi.stopScan();
    } catch {
      // A stopped native scan is already the desired state.
    }
  }, []);

  const connect = useCallback(async (deviceId: string) => {
    setError(null);
    setSelectedDeviceId(deviceId);
    setWifiNetworks([]);
    setAlternateModeAvailable(false);
    connectionEncryptedRef.current = false;
    setConnectionEncrypted(false);
    try {
      await espBlufi.stopScan();
      await espBlufi.connectCompatibility(deviceId);
    } catch (connectError) {
      setStage('error');
      setError(
        readableError(
          connectError,
          'Unable to connect to the pill dispenser in compatibility mode.',
        ),
      );
    }
  }, []);

  const connectAlternateMode = useCallback(async () => {
    if (!selectedDeviceId) {
      setError('Scan again and select the pill dispenser.');
      return;
    }
    setError(null);
    setAlternateModeAvailable(false);
    connectionEncryptedRef.current = true;
    setConnectionEncrypted(true);
    setStage('connecting');
    setStatusMessage('Reconnecting with encrypted BluFi…');
    try {
      await espBlufi.connect(selectedDeviceId);
    } catch (connectError) {
      setStage('error');
      setAlternateModeAvailable(true);
      setError(
        readableError(
          connectError,
          'Unable to connect with encrypted BluFi.',
        ),
      );
    }
  }, [selectedDeviceId]);

  const provision = useCallback(async (ssid: string, password: string) => {
    const trimmedSsid = ssid.trim();
    if (!trimmedSsid) {
      setError('Select or enter a Wi-Fi network name.');
      return;
    }

    setError(null);
    try {
      await espBlufi.provision(trimmedSsid, password);
    } catch (provisionError) {
      setStage('error');
      setError(
        readableError(
          provisionError,
          'Unable to send Wi-Fi settings to the dispenser.',
        ),
      );
    }
  }, []);

  const refreshWifi = useCallback(async () => {
    setError(null);
    setStatusMessage('Reading nearby Wi-Fi networks from the dispenser…');
    const requestId = ++wifiScanRequestRef.current;
    try {
      await espBlufi.requestWifiScan();
      setTimeout(() => {
        if (wifiScanRequestRef.current !== requestId) return;
        setStatusMessage(current =>
          current.includes('Reading nearby Wi-Fi networks')
            ? 'The dispenser did not return a network list. Enter your 2.4 GHz Wi-Fi name manually below.'
            : current,
        );
      }, 8000);
    } catch (scanError) {
      setError(readableError(scanError, 'Unable to scan Wi-Fi networks.'));
    }
  }, []);

  const checkWifiStatus = useCallback(async () => {
    setError(null);
    try {
      await espBlufi.requestWifiStatus();
    } catch (statusError) {
      setError(
        readableError(statusError, 'Unable to check the Wi-Fi connection.'),
      );
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await espBlufi.disconnect();
    } finally {
      wifiScanRequestRef.current += 1;
      setStage('idle');
      setSelectedDeviceId(null);
      setWifiNetworks([]);
      setAlternateModeAvailable(false);
      connectionEncryptedRef.current = false;
      setConnectionEncrypted(false);
      setStatusMessage(
        'Bluetooth disconnected. Scan to configure another dispenser.',
      );
    }
  }, []);

  return useMemo(
    () => ({
      isAvailable: espBlufi.isAvailable,
      devices,
      wifiNetworks,
      stage,
      selectedDeviceId,
      connectedWifiSsid,
      alternateModeAvailable,
      connectionEncrypted,
      statusMessage,
      error,
      startScan,
      stopScan,
      connect,
      connectAlternateMode,
      provision,
      refreshWifi,
      checkWifiStatus,
      disconnect,
    }),
    [
      checkWifiStatus,
      connect,
      connectAlternateMode,
      alternateModeAvailable,
      connectionEncrypted,
      connectedWifiSsid,
      devices,
      disconnect,
      error,
      provision,
      refreshWifi,
      selectedDeviceId,
      stage,
      startScan,
      statusMessage,
      stopScan,
      wifiNetworks,
    ],
  );
}
