import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';

import { encodeUtf8ToBase64 } from '../bluetooth/base64';
import { buildReminderCommand } from '../blufi/pillDispenserProtocol';
import {
  isPillDispenserBridgeAvailable,
  pillDispenserBridge,
  pillDispenserEmitter,
  type PillDispenserConnectionEvent,
  type PillDispenserCustomDataEvent,
  type PillDispenserErrorEvent,
  type PillDispenserScanResult,
  type PillDispenserStatusEvent,
  type PillDispenserVersionEvent,
  type PillDispenserWifiScanEvent,
} from '../blufi/nativePillDispenser';
import {
  loadPillDispenserIdentityPreference,
  savePillDispenserIdentityPreference,
  type PillDispenserIdentityPreference,
} from '../utils/pillDispenserIdentityCache';

type DeviceState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error';

type DeviceRow = PillDispenserScanResult & {
  lastSeenAt: number;
};

const SCAN_WINDOW_MS = 15000;

async function requestAndroidBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const permissions =
    Platform.Version >= 31
      ? ([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ] as const)
      : ([PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] as const);

  try {
    const result = await PermissionsAndroid.requestMultiple(permissions as any);
    return Object.values(result).every(value => value === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

function stableSortDevices(values: DeviceRow[]): DeviceRow[] {
  return [...values].sort((left, right) => {
    if (!!left.isLikelyBlufi !== !!right.isLikelyBlufi) {
      return left.isLikelyBlufi ? -1 : 1;
    }
    const leftSignal = typeof left.rssi === 'number' ? left.rssi : -999;
    const rightSignal = typeof right.rssi === 'number' ? right.rssi : -999;
    if (leftSignal !== rightSignal) return rightSignal - leftSignal;
    const leftName = (left.name ?? left.localName ?? '').toString();
    const rightName = (right.name ?? right.localName ?? '').toString();
    return leftName.localeCompare(rightName);
  });
}

function bluetoothBadgeLabel(isReady: boolean, isAvailable: boolean): { label: string; color: string } {
  if (!isAvailable) return { label: 'Bridge unavailable', color: '#B45309' };
  return isReady ? { label: 'Bluetooth ready', color: '#166534' } : { label: 'Bluetooth needs attention', color: '#B45309' };
}

const BlufiDeviceTab = () => {
  const [devicesById, setDevicesById] = useState<Record<string, DeviceRow>>({});
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [connectionState, setConnectionState] = useState<DeviceState>('disconnected');
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [statusPayload, setStatusPayload] = useState<PillDispenserStatusEvent | null>(null);
  const [versionPayload, setVersionPayload] = useState<PillDispenserVersionEvent | null>(null);
  const [wifiScanPayload, setWifiScanPayload] = useState<PillDispenserWifiScanEvent | null>(null);
  const [customDataPayload, setCustomDataPayload] = useState<PillDispenserCustomDataEvent | null>(null);
  const [bridgeError, setBridgeError] = useState<PillDispenserErrorEvent | null>(null);
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [alarmTime, setAlarmTime] = useState('08:00');
  const [alarmLabel, setAlarmLabel] = useState('Morning medicine');
  const [alarmRepeat, setAlarmRepeat] = useState('Mon-Fri');
  const [savedIdentity, setSavedIdentity] = useState<PillDispenserIdentityPreference | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushLog = useCallback((entry: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${entry}`].slice(-25));
  }, []);

  const devices = useMemo(() => stableSortDevices(Object.values(devicesById)), [devicesById]);
  const selectedDevice = selectedDeviceId ? devicesById[selectedDeviceId] ?? null : null;
  const bluetoothBadge = bluetoothBadgeLabel(connectionState === 'connected' || connectionState === 'connecting', isPillDispenserBridgeAvailable);

  useEffect(() => {
    let cancelled = false;

    const loadSavedIdentity = async () => {
      try {
        const nextIdentity = await loadPillDispenserIdentityPreference();
        if (!cancelled) {
          setSavedIdentity(nextIdentity);
        }
      } finally {
        if (!cancelled) {
          setIdentityLoading(false);
        }
      }
    };

    loadSavedIdentity();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedDeviceId && devicesById[selectedDeviceId]) {
      return;
    }
    if (devices.length === 0) {
      setSelectedDeviceId(null);
      return;
    }
    setSelectedDeviceId(devices[0]!.id);
  }, [devices, devicesById, selectedDeviceId]);

  useEffect(() => {
    if (!pillDispenserEmitter) return;

    const subs = [
      pillDispenserEmitter.addListener('PillDispenserScanResult', (event: PillDispenserScanResult) => {
        if (!event.id) return;
        setDevicesById(prev => {
          const next: DeviceRow = {
            ...prev[event.id],
            ...event,
            lastSeenAt: Date.now(),
          };
          return { ...prev, [event.id]: next };
        });
      }),
      pillDispenserEmitter.addListener('PillDispenserConnectionState', (event: PillDispenserConnectionEvent) => {
        setConnectionState((event.state as DeviceState) ?? 'disconnected');
        setConnectedDeviceId(event.state === 'connected' ? event.deviceId ?? null : null);
        pushLog(`Connection: ${event.state}${event.deviceId ? ` (${event.deviceId})` : ''}`);
      }),
      pillDispenserEmitter.addListener('PillDispenserLog', (event: { message?: string }) => {
        if (event.message) pushLog(event.message);
      }),
      pillDispenserEmitter.addListener('PillDispenserStatus', (event: PillDispenserStatusEvent) => {
        setStatusPayload(event);
        pushLog(`Status received: opMode=${event.opMode ?? 'n/a'}`);
      }),
      pillDispenserEmitter.addListener('PillDispenserVersion', (event: PillDispenserVersionEvent) => {
        setVersionPayload(event);
        pushLog(`Version received: ${event.versionString ?? 'unknown'}`);
      }),
      pillDispenserEmitter.addListener('PillDispenserWifiScan', (event: PillDispenserWifiScanEvent) => {
        setWifiScanPayload(event);
        pushLog(`Wi-Fi scan received (${event.results?.length ?? 0} networks)`);
      }),
      pillDispenserEmitter.addListener('PillDispenserCustomData', (event: PillDispenserCustomDataEvent) => {
        setCustomDataPayload(event);
        pushLog(`Custom data ${event.direction ?? 'received'}`);
      }),
      pillDispenserEmitter.addListener('PillDispenserError', (event: PillDispenserErrorEvent) => {
        setBridgeError(event);
        pushLog(`Error ${event.code ?? 'UNKNOWN'}: ${event.message ?? 'Unknown error'}`);
      }),
    ];

    return () => {
      subs.forEach(sub => sub.remove());
    };
  }, [pushLog]);

  useEffect(() => () => {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (pillDispenserBridge) {
      pillDispenserBridge.stopScan().catch(() => {});
    }
  }, []);

  const stopScan = useCallback(async () => {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    setIsScanning(false);
    if (!pillDispenserBridge) return;
    try {
      await pillDispenserBridge.stopScan();
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Failed to stop scan.');
    }
  }, []);

  const startScan = useCallback(async () => {
    const permissionGranted = await requestAndroidBlePermissions();
    if (!permissionGranted) {
      setScanError('Bluetooth permissions are required to scan BluFi devices.');
      return;
    }
    if (!pillDispenserBridge) {
      setScanError('BluFi bridge is not available in this build.');
      return;
    }

    setScanError(null);
    setBridgeError(null);
    setDevicesById({});
    setStatusPayload(null);
    setVersionPayload(null);
    setWifiScanPayload(null);
    setCustomDataPayload(null);
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    setIsScanning(true);

    try {
      await pillDispenserBridge.stopScan().catch(() => {});
      await pillDispenserBridge.startScan(savedIdentity?.advertisedName ? [savedIdentity.advertisedName] : null);
      scanTimerRef.current = setTimeout(() => {
        stopScan().catch(() => {});
      }, SCAN_WINDOW_MS);
      pushLog(savedIdentity?.advertisedName ? `Scanning for ${savedIdentity.advertisedName}...` : 'Scanning for named BluFi devices...');
    } catch (error) {
      setIsScanning(false);
      setScanError(error instanceof Error ? error.message : 'Failed to scan for BluFi devices.');
    }
  }, [pushLog, savedIdentity?.advertisedName, stopScan]);

  const rememberDeviceIdentity = useCallback(async (device: DeviceRow) => {
    const advertisedName = (device.name ?? device.localName ?? '').trim();
    if (!advertisedName) {
      setScanError('This device is not advertising a name yet.');
      return;
    }

    try {
      const nextIdentity = await savePillDispenserIdentityPreference(advertisedName, device.id);
      setSavedIdentity(nextIdentity);
      setSelectedDeviceId(device.id);
      pushLog(`Saved dispenser identity: ${advertisedName}`);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Failed to save dispenser identity.');
    }
  }, [pushLog]);

  const connectSelectedDevice = useCallback(async (deviceId?: string) => {
    const targetDeviceId = deviceId ?? selectedDeviceId;
    if (!targetDeviceId || !pillDispenserBridge) return;
    try {
      await pillDispenserBridge.connect(targetDeviceId);
      setConnectionState('connecting');
      pushLog(`Connecting to ${targetDeviceId}`);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Failed to connect.');
    }
  }, [selectedDeviceId, pushLog]);

  const disconnect = useCallback(async () => {
    if (!pillDispenserBridge) return;
    try {
      setConnectionState('disconnecting');
      await pillDispenserBridge.disconnect();
      setConnectedDeviceId(null);
      setConnectionState('disconnected');
      pushLog('Disconnected');
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Failed to disconnect.');
    }
  }, [pushLog]);

  const runNegotiation = useCallback(async () => {
    if (!pillDispenserBridge) return;
    try {
      await pillDispenserBridge.negotiateSecurity();
      pushLog('Security negotiation requested');
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Failed to negotiate security.');
    }
  }, [pushLog]);

  const requestVersion = useCallback(async () => {
    if (!pillDispenserBridge) return;
    try {
      await pillDispenserBridge.requestDeviceVersion();
      pushLog('Version requested');
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Failed to request device version.');
    }
  }, [pushLog]);

  const requestStatus = useCallback(async () => {
    if (!pillDispenserBridge) return;
    try {
      await pillDispenserBridge.requestDeviceStatus();
      pushLog('Status requested');
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Failed to request device status.');
    }
  }, [pushLog]);

  const requestWifiScan = useCallback(async () => {
    if (!pillDispenserBridge) return;
    try {
      await pillDispenserBridge.requestDeviceScan();
      pushLog('Wi-Fi scan requested');
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Failed to request Wi-Fi scan.');
    }
  }, [pushLog]);

  const sendWiFiProvisioning = useCallback(async () => {
    if (!pillDispenserBridge) return;
    try {
      await pillDispenserBridge.configureStation(wifiSsid.trim(), wifiPassword, null);
      pushLog(`Wi-Fi provisioning sent for SSID "${wifiSsid.trim()}"`);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Failed to configure Wi-Fi.');
    }
  }, [pushLog, wifiPassword, wifiSsid]);

  const sendAlarmCommand = useCallback(async () => {
    if (!pillDispenserBridge) return;

    try {
      const payload = buildReminderCommand({
        title: 'Reminder',
        label: alarmLabel,
        time: alarmTime,
        repeatRaw: alarmRepeat,
      });
      await pillDispenserBridge.postCustomData(encodeUtf8ToBase64(JSON.stringify(payload)));
      pushLog(`Alarm payload sent for ${alarmTime}`);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Failed to send alarm payload.');
    }
  }, [alarmLabel, alarmRepeat, alarmTime, pushLog]);

  const reminderPreview = useMemo(() => {
    try {
      return JSON.stringify(
        buildReminderCommand({
          title: 'Reminder',
          label: alarmLabel,
          time: alarmTime,
          repeatRaw: alarmRepeat,
        }),
        null,
        2,
      );
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid reminder payload';
    }
  }, [alarmLabel, alarmRepeat, alarmTime]);

  const statusText = useMemo(() => {
    if (!pillDispenserBridge) return 'BluFi bridge not linked';
    if (connectionState === 'connected') return 'Connected and ready';
    if (connectionState === 'connecting') return 'Connecting';
    if (connectionState === 'disconnecting') return 'Disconnecting';
    return 'Ready to scan';
  }, [connectionState]);

  const likelyCount = useMemo(() => devices.filter(item => item.isLikelyBlufi).length, [devices]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroIconWrap}>
              <Icon name="bluetooth" size={22} color="#FFFFFF" />
            </View>
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroTitle}>BluFi Control</Text>
              <Text style={styles.heroSubtitle}>
                Scan, connect, provision Wi-Fi, and send reminder commands through Espressif BluFi.
              </Text>
            </View>
          </View>

          <View style={styles.statusPill}>
            <Icon name={isPillDispenserBridgeAvailable ? 'checkmark-circle' : 'warning-outline'} size={15} color={bluetoothBadge.color} />
            <Text style={[styles.statusPillText, { color: bluetoothBadge.color }]}>{bluetoothBadge.label}</Text>
          </View>

          <Text style={styles.helperText}>{statusText}</Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardTitle}>Device Identity</Text>
          <Text style={styles.cardSubtitle}>
            {identityLoading
              ? 'Loading the saved dispenser identity...'
              : savedIdentity
                ? <>
                    BluFi is locked to the device it learned from the dispenser itself: {' '}
                    <Text style={styles.inlineStrong}>{savedIdentity.advertisedName}</Text>.
                  </>
                : 'No dispenser is locked yet. Scan nearby named devices, then tap "Use as dispenser" on the correct one.'}
          </Text>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.primaryButton, !isPillDispenserBridgeAvailable || isScanning ? styles.primaryButtonDisabled : null]}
            onPress={startScan}
            disabled={!isPillDispenserBridgeAvailable || isScanning}
            activeOpacity={0.85}
          >
            {isScanning ? <ActivityIndicator color="#FFFFFF" /> : <Icon name="scan-outline" size={18} color="#FFFFFF" />}
            <Text style={styles.primaryButtonText}>{isScanning ? 'Scanning...' : 'Scan Devices'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, !isScanning ? styles.secondaryButtonIdle : null]}
            onPress={stopScan}
            disabled={!isScanning}
            activeOpacity={0.85}
          >
            <Icon name="stop-circle-outline" size={18} color={isScanning ? '#8B5E34' : '#C4A574'} />
            <Text style={[styles.secondaryButtonText, !isScanning ? styles.secondaryButtonTextIdle : null]}>Stop</Text>
          </TouchableOpacity>
        </View>

        {scanError ? (
          <View style={styles.errorCard}>
            <Icon name="alert-circle-outline" size={18} color="#B45309" />
            <Text style={styles.errorText}>{scanError}</Text>
          </View>
        ) : null}

        {bridgeError ? (
          <View style={styles.errorCard}>
            <Icon name="warning-outline" size={18} color="#B45309" />
            <Text style={styles.errorText}>{bridgeError.message ?? bridgeError.code ?? 'BluFi bridge error'}</Text>
          </View>
        ) : null}

        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            {devices.length > 0 ? `${devices.length} nearby device${devices.length === 1 ? '' : 's'}` : 'No devices discovered yet'}
          </Text>
          <Text style={styles.summaryMeta}>{likelyCount > 0 ? `${likelyCount} likely BluFi match${likelyCount === 1 ? '' : 'es'}` : 'Waiting for advertisements'}</Text>
        </View>

        {!isPillDispenserBridgeAvailable ? (
          <View style={styles.emptyCard}>
            <Icon name="alert-circle-outline" size={26} color="#B45309" />
            <Text style={styles.emptyTitle}>BluFi bridge not linked</Text>
            <Text style={styles.emptyBody}>
              The native Espressif BluFi module is missing in this build. Once the bridge is linked, this screen will scan and connect.
            </Text>
          </View>
        ) : null}

        {devices.length === 0 && isPillDispenserBridgeAvailable ? (
          <View style={styles.emptyCard}>
            <Icon name="radio-outline" size={26} color="#B9A89C" />
            <Text style={styles.emptyTitle}>Start a scan to find the dispenser</Text>
            <Text style={styles.emptyBody}>
              Put the dispenser in BluFi mode, then scan. If a dispenser has already been saved, the app narrows to that advertised name automatically.
            </Text>
          </View>
        ) : null}

        {devices.map(device => {
          const isSelected = selectedDeviceId === device.id;
          const isConnected = connectedDeviceId === device.id && connectionState === 'connected';
          return (
            <TouchableOpacity
              key={device.id}
              style={[styles.deviceCard, isSelected ? styles.deviceCardSelected : null]}
              activeOpacity={0.85}
              onPress={() => setSelectedDeviceId(device.id)}
            >
              <View style={styles.deviceHeader}>
                <View style={[styles.deviceIconWrap, device.isLikelyBlufi ? styles.deviceIconLikely : styles.deviceIconNeutral]}>
                  <Icon name={device.isLikelyBlufi ? 'rocket-outline' : 'bluetooth-outline'} size={18} color="#FFFFFF" />
                </View>
                <View style={styles.deviceHeaderText}>
                  <View style={styles.deviceTitleRow}>
                    <Text style={styles.deviceName} numberOfLines={1}>
                      {device.name?.trim() || device.localName?.trim() || 'Unnamed device'}
                    </Text>
                    {device.isLikelyBlufi ? (
                      <View style={styles.matchChip}>
                        <Text style={styles.matchChipText}>BluFi</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.deviceMeta}>{device.id}</Text>
                </View>
              </View>

              <View style={styles.deviceDetailRow}>
                <Text style={styles.deviceDetailLabel}>RSSI</Text>
                <Text style={styles.deviceDetailValue}>{typeof device.rssi === 'number' ? `${device.rssi} dBm` : 'Unknown'}</Text>
              </View>
              <View style={styles.deviceDetailRow}>
                <Text style={styles.deviceDetailLabel}>Connectable</Text>
                <Text style={styles.deviceDetailValue}>
                  {device.isConnectable == null ? 'Unknown' : device.isConnectable ? 'Yes' : 'No'}
                </Text>
              </View>

              <View style={styles.deviceActionRow}>
                <TouchableOpacity
                  style={[styles.linkButton, isConnected ? styles.linkButtonSecondary : null]}
                  onPress={() => {
                    setSelectedDeviceId(device.id);
                    if (isConnected) {
                      disconnect().catch(() => {});
                    } else {
                      connectSelectedDevice(device.id).catch(() => {});
                    }
                  }}
                >
                  <Text style={styles.linkButtonText}>{isConnected ? 'Disconnect' : isSelected ? 'Connect selected' : 'Connect'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryChip} onPress={() => setSelectedDeviceId(device.id)}>
                  <Text style={styles.secondaryChipText}>{isSelected ? 'Selected' : 'Select'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryChip}
                  onPress={() => rememberDeviceIdentity(device).catch(() => {})}
                >
                  <Text style={styles.secondaryChipText}>Use as dispenser</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}

        <View style={styles.sectionCard}>
          <Text style={styles.cardTitle}>Selected Device</Text>
          <Text style={styles.cardSubtitle}>
            {selectedDevice ? selectedDevice.name?.trim() || selectedDevice.localName?.trim() || selectedDevice.id : 'Pick a discovered device first.'}
          </Text>

          <View style={styles.actionGrid}>
            <TouchableOpacity style={styles.secondaryAction} onPress={() => connectSelectedDevice().catch(() => {})} disabled={!selectedDeviceId}>
              <Icon name="link-outline" size={16} color="#8B5E34" />
              <Text style={styles.secondaryActionText}>Connect</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryAction} onPress={() => disconnect().catch(() => {})}>
              <Icon name="unlink-outline" size={16} color="#8B5E34" />
              <Text style={styles.secondaryActionText}>Disconnect</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryAction} onPress={() => runNegotiation().catch(() => {})} disabled={connectionState !== 'connected'}>
              <Icon name="shield-checkmark-outline" size={16} color="#8B5E34" />
              <Text style={styles.secondaryActionText}>Secure</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryAction} onPress={() => requestStatus().catch(() => {})} disabled={connectionState !== 'connected'}>
              <Icon name="information-circle-outline" size={16} color="#8B5E34" />
              <Text style={styles.secondaryActionText}>Status</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryAction} onPress={() => requestVersion().catch(() => {})} disabled={connectionState !== 'connected'}>
              <Icon name="document-text-outline" size={16} color="#8B5E34" />
              <Text style={styles.secondaryActionText}>Version</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryAction} onPress={() => requestWifiScan().catch(() => {})} disabled={connectionState !== 'connected'}>
              <Icon name="wifi-outline" size={16} color="#8B5E34" />
              <Text style={styles.secondaryActionText}>Wi-Fi Scan</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardTitle}>Wi-Fi Provisioning</Text>
          <Text style={styles.cardSubtitle}>
            Send SSID and password through BluFi if the dispenser needs network onboarding.
          </Text>

          <TextInput
            style={styles.input}
            value={wifiSsid}
            onChangeText={setWifiSsid}
            placeholder="Wi-Fi SSID"
            placeholderTextColor="#A79B90"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            value={wifiPassword}
            onChangeText={setWifiPassword}
            placeholder="Wi-Fi password"
            placeholderTextColor="#A79B90"
            autoCapitalize="none"
            secureTextEntry
          />

          <TouchableOpacity style={styles.primaryAction} onPress={() => sendWiFiProvisioning().catch(() => {})} disabled={connectionState !== 'connected'}>
            <Icon name="cloud-upload-outline" size={16} color="#FFFFFF" />
            <Text style={styles.primaryActionText}>Send Wi-Fi Credentials</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardTitle}>Reminder Command</Text>
          <Text style={styles.cardSubtitle}>
            Healthsoft sends a versioned reminder command envelope here. The pill dispenser firmware should parse this JSON and turn it into an alarm/reminder.
          </Text>

          <TextInput
            style={styles.input}
            value={alarmTime}
            onChangeText={setAlarmTime}
            placeholder="Alarm time, e.g. 08:00"
            placeholderTextColor="#A79B90"
          />
          <TextInput
            style={styles.input}
            value={alarmLabel}
            onChangeText={setAlarmLabel}
            placeholder="Label, e.g. Morning medicine"
            placeholderTextColor="#A79B90"
          />
          <TextInput
            style={styles.input}
            value={alarmRepeat}
            onChangeText={setAlarmRepeat}
            placeholder="Repeat, e.g. Mon-Fri"
            placeholderTextColor="#A79B90"
          />

          <TouchableOpacity style={styles.primaryAction} onPress={() => sendAlarmCommand().catch(() => {})} disabled={connectionState !== 'connected'}>
            <Icon name="alarm-outline" size={16} color="#FFFFFF" />
            <Text style={styles.primaryActionText}>Send Reminder Command</Text>
          </TouchableOpacity>

          <Text style={styles.previewLabel}>Command preview</Text>
          <Text style={styles.payloadValue} selectable>
            {reminderPreview}
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardTitle}>Latest Payloads</Text>

          {versionPayload ? (
            <View style={styles.payloadBlock}>
              <Text style={styles.payloadLabel}>Version</Text>
              <Text style={styles.payloadValue}>{versionPayload.versionString ?? 'Unknown'}</Text>
            </View>
          ) : null}

          {statusPayload ? (
            <View style={styles.payloadBlock}>
              <Text style={styles.payloadLabel}>Status</Text>
              <Text style={styles.payloadValue} selectable>
                {JSON.stringify(statusPayload, null, 2)}
              </Text>
            </View>
          ) : null}

          {wifiScanPayload ? (
            <View style={styles.payloadBlock}>
              <Text style={styles.payloadLabel}>Wi-Fi scan</Text>
              <Text style={styles.payloadValue} selectable>
                {JSON.stringify(wifiScanPayload.results ?? [], null, 2)}
              </Text>
            </View>
          ) : null}

          {customDataPayload ? (
            <View style={styles.payloadBlock}>
              <Text style={styles.payloadLabel}>Custom data</Text>
              <Text style={styles.payloadValue} selectable>
                {customDataPayload.direction === 'received' ? 'Received' : 'Sent'}
                {'\n'}
                {customDataPayload.dataUtf8?.trim() || customDataPayload.dataBase64 || ''}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardTitle}>Activity Log</Text>
          {logs.slice().reverse().map((entry, index) => (
            <Text key={`${entry}-${index}`} style={styles.logEntry}>
              {entry}
            </Text>
          ))}
          {logs.length === 0 ? <Text style={styles.emptyLog}>No activity yet.</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default BlufiDeviceTab;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9F6F0',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#1B2A4A',
    shadowOpacity: 0.05,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F28C28',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  heroTextWrap: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1F2937',
  },
  heroSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#6B7280',
  },
  statusPill: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFF7ED',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusPillText: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  helperText: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 17,
    color: '#8B7F74',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#F28C28',
    borderRadius: 18,
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    width: 108,
    borderRadius: 18,
    minHeight: 52,
    borderWidth: 1,
    borderColor: '#F0D6B8',
    backgroundColor: '#FFF9F1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryButtonIdle: {
    opacity: 0.8,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#8B5E34',
  },
  secondaryButtonTextIdle: {
    color: '#C4A574',
  },
  errorCard: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FDBA74',
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#9A3412',
    lineHeight: 16,
  },
  summaryRow: {
    marginBottom: 12,
  },
  summaryText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1F2937',
  },
  summaryMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#8B7F74',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 20,
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '800',
    color: '#1F2937',
    textAlign: 'center',
  },
  emptyBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: '#8B7F74',
    textAlign: 'center',
  },
  deviceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#1B2A4A',
    shadowOpacity: 0.03,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  deviceCardSelected: {
    borderWidth: 1,
    borderColor: '#F28C28',
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  deviceIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  deviceIconLikely: {
    backgroundColor: '#F28C28',
  },
  deviceIconNeutral: {
    backgroundColor: '#9CA3AF',
  },
  deviceHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  deviceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deviceName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#1F2937',
  },
  matchChip: {
    backgroundColor: '#FFF7ED',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  matchChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
  },
  deviceMeta: {
    marginTop: 4,
    fontSize: 11,
    color: '#8B7F74',
  },
  deviceDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 6,
  },
  deviceDetailLabel: {
    width: 92,
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
  },
  deviceDetailValue: {
    flex: 1,
    fontSize: 12,
    color: '#1F2937',
    textAlign: 'right',
  },
  deviceActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  linkButton: {
    backgroundColor: '#F28C28',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  linkButtonSecondary: {
    backgroundColor: '#F2B046',
  },
  linkButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  secondaryChip: {
    backgroundColor: '#F6F1EA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F1E2CF',
  },
  secondaryChipText: {
    color: '#8B5E34',
    fontSize: 12,
    fontWeight: '700',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1F2937',
  },
  cardSubtitle: {
    marginTop: 6,
    marginBottom: 12,
    fontSize: 12,
    lineHeight: 18,
    color: '#8B7F74',
  },
  inlineStrong: {
    color: '#1F2937',
    fontWeight: '800',
  },
  previewLabel: {
    marginTop: 12,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '800',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  secondaryAction: {
    minWidth: '48%',
    flexGrow: 1,
    borderRadius: 16,
    backgroundColor: '#FFF9F1',
    borderWidth: 1,
    borderColor: '#F0D6B8',
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8B5E34',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E8D8C6',
    backgroundColor: '#FFFDF9',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#1F2937',
    marginBottom: 10,
  },
  primaryAction: {
    marginTop: 4,
    backgroundColor: '#F28C28',
    borderRadius: 16,
    minHeight: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  payloadBlock: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#FFF9F1',
    borderWidth: 1,
    borderColor: '#F0D6B8',
    marginBottom: 10,
  },
  payloadLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#8B5E34',
    marginBottom: 6,
  },
  payloadValue: {
    fontSize: 12,
    color: '#1F2937',
  },
  logEntry: {
    fontSize: 12,
    lineHeight: 18,
    color: '#4B5563',
    paddingVertical: 3,
  },
  emptyLog: {
    fontSize: 12,
    color: '#8B7F74',
  },
});
