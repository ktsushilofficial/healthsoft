import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useV8DeviceManager } from '../v8/useV8DeviceManager';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { DeviceStackParamList } from '../types/navigation';
import { useAuth } from '../context/AuthContext';
import {
  normalizeMacAddress,
  resolveConnectedHandBandMac,
} from '../utils/deviceAssignments';

type V8DeviceTabProps = {
  showSyncLatestPrompt?: boolean;
  promptToken?: string | number | null;
};

const V8DeviceTab = ({ showSyncLatestPrompt = false, promptToken = null }: V8DeviceTabProps) => {
  const normalizeId = (id?: string | null) => (id ?? '').trim().toLowerCase();
  const compactMac = (value?: string | null) => normalizeMacAddress(value);
  const navigation = useNavigation<NativeStackNavigationProp<DeviceStackParamList>>();
  const { user, selectedSeniorHandBandMacs } = useAuth();
  const isSenior = user?.role === 'SENIOR';
  const {
    bleState,
    devices,
    isScanning,
    scanError,
    connectionStates,
    startScan,
    stopScan,
    connect,
    disconnect,
    clearSavedSession,
    ensureAutoConnect,
    deviceInfo,
  } = useV8DeviceManager();
  const [clearingSession, setClearingSession] = useState(false);
  const [pendingSyncLatestPrompt, setPendingSyncLatestPrompt] = useState(showSyncLatestPrompt);

  const ensureAutoConnectRef = useRef(ensureAutoConnect);
  useEffect(() => {
    ensureAutoConnectRef.current = ensureAutoConnect;
  }, [ensureAutoConnect]);

  useEffect(() => {
    setPendingSyncLatestPrompt(showSyncLatestPrompt);
  }, [promptToken, showSyncLatestPrompt]);

  useFocusEffect(
    useCallback(() => {
      ensureAutoConnectRef.current().catch(() => {});
    }, []),
  );

  const selectedSeniorMacSet = useMemo(
    () => new Set(selectedSeniorHandBandMacs),
    [selectedSeniorHandBandMacs],
  );

  const matchedDeviceIds = useMemo(() => {
    const matched = new Set<string>();
    devices.forEach(device => {
      const scannedMac = compactMac(device.id);
      if (scannedMac && selectedSeniorMacSet.has(scannedMac)) {
        matched.add(device.id);
      }
    });

    const connectedDevice = devices.find(
      device => connectionStates[normalizeId(device.id)] === 'connected',
    );
    const connectedDeviceMac = resolveConnectedHandBandMac(
      deviceInfo.mac,
      connectedDevice?.id,
    );
    if (connectedDeviceMac && selectedSeniorMacSet.has(connectedDeviceMac)) {
      if (connectedDevice) {
        matched.add(connectedDevice.id);
      }
    }

    return matched;
  }, [connectionStates, deviceInfo.mac, devices, selectedSeniorMacSet]);

  const myHandBandDevices = useMemo(
    () => devices.filter(device => matchedDeviceIds.has(device.id)),
    [devices, matchedDeviceIds],
  );

  const otherHandBandDevices = useMemo(
    () => devices.filter(device => !matchedDeviceIds.has(device.id)),
    [devices, matchedDeviceIds],
  );

  const renderDeviceRow = (device: (typeof devices)[number]) => {
    const state = connectionStates[normalizeId(device.id)] ?? 'disconnected';
    const busy = state === 'connecting' || state === 'disconnecting';
    const connected = state === 'connected';
    const matchesSelectedSenior = matchedDeviceIds.has(device.id);
    const canVerifyMac = selectedSeniorHandBandMacs.length > 0;
    return (
      <View key={device.id} style={styles.deviceRow}>
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{device.name ?? device.localName ?? 'Hand Band'}</Text>
          <Text style={styles.deviceMeta}>{typeof device.rssi === 'number' ? `RSSI: ${device.rssi}` : 'Available'}</Text>
          <Text style={styles.deviceMeta}>ID: {device.id}</Text>
          {matchesSelectedSenior ? (
            <Text style={styles.matchChip}>Assigned to selected senior</Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={[
            styles.linkButton,
            connected ? styles.linkButtonSecondary : null,
            busy || (!connected && !canVerifyMac) ? styles.disabled : null,
          ]}
          disabled={busy || (!connected && !canVerifyMac)}
          onPress={async () => {
            if (connected) {
              await disconnect(device.id);
              return;
            }
            await connect(device.id);
            if (!matchesSelectedSenior) {
              return;
            }
            const shouldShowSyncPrompt = pendingSyncLatestPrompt;
            navigation.navigate('V8DeviceManage', {
              deviceId: device.id,
              deviceName: device.name ?? device.localName ?? 'Hand Band',
              showSyncLatestPrompt: shouldShowSyncPrompt,
              promptToken,
            });
            if (shouldShowSyncPrompt) {
              setPendingSyncLatestPrompt(false);
            }
          }}
        >
          <Text style={styles.linkButtonText}>
            {connected
              ? 'Disconnect'
              : busy
                ? 'Working...'
                : matchesSelectedSenior
                  ? 'Connect'
                  : canVerifyMac
                    ? 'Verify MAC'
                    : 'No Assigned MAC'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.linkButton,
            { marginLeft: 8, backgroundColor: '#EDE4DA' },
            !matchesSelectedSenior ? styles.disabled : null,
          ]}
          disabled={!matchesSelectedSenior}
          onPress={() => {
            const shouldShowSyncPrompt = pendingSyncLatestPrompt;
            navigation.navigate('V8DeviceManage', {
              deviceId: device.id,
              deviceName: device.name ?? device.localName ?? 'Hand Band',
              showSyncLatestPrompt: shouldShowSyncPrompt,
              promptToken,
            });
            if (shouldShowSyncPrompt) {
              setPendingSyncLatestPrompt(false);
            }
          }}
        >
          <Text style={[styles.linkButtonText, { color: '#7B5835' }]}>Manage</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Hand Band Manager</Text>
      <Text style={styles.cardSubtitle}>
        {isSenior
          ? 'Dedicated Hand Band detection and connection flow, isolated from your current device manager.'
          : 'View and manage assigned Hand Band devices for the selected senior profile.'}
      </Text>

      {isSenior ? (
        <TouchableOpacity style={styles.primaryButton} onPress={() => (isScanning ? stopScan() : startScan())}>
          {isScanning ? <ActivityIndicator color="#fff" /> : <Icon name="bluetooth" size={18} color="#fff" />}
          <Text style={styles.primaryButtonText}>
            {isScanning ? 'Scanning Hand Band...' : bleState === 'PoweredOn' ? 'Scan Hand Band Devices' : 'Enable Bluetooth'}
          </Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[styles.clearSessionButton, clearingSession ? styles.disabled : null]}
        disabled={clearingSession}
        onPress={async () => {
          setClearingSession(true);
          try {
            await clearSavedSession();
          } finally {
            setClearingSession(false);
          }
        }}
      >
        {clearingSession ? <ActivityIndicator color="#8B5E34" /> : <Icon name="trash-outline" size={16} color="#8B5E34" />}
        <Text style={styles.clearSessionButtonText}>
          {clearingSession ? 'Clearing Saved Session...' : 'Clear Saved Device Session'}
        </Text>
      </TouchableOpacity>

      {isSenior && scanError ? <Text style={styles.warningText}>{scanError}</Text> : null}
      {selectedSeniorHandBandMacs.length > 0 ? (
        <View style={styles.assignedInfoBox}>
          <Text style={styles.assignedInfoTitle}>Selected senior hand bands</Text>
          <Text style={styles.assignedInfoText}>
            {selectedSeniorHandBandMacs.length} assigned{isSenior ? ` · ${matchedDeviceIds.size} in scan range` : ''}
          </Text>
        </View>
      ) : null}
      {devices.length === 0 ? <Text style={styles.cardSubtitle}>No Hand Band device detected yet.</Text> : null}

      {myHandBandDevices.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>My Hand Band</Text>
          {myHandBandDevices.map(renderDeviceRow)}
        </>
      ) : null}

      {isSenior && otherHandBandDevices.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Other Hand Bands</Text>
          {otherHandBandDevices.map(renderDeviceRow)}
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2E2A27',
    textAlign: 'center',
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#7A726A',
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 18,
  },
  primaryButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F28C28',
    borderRadius: 22,
    paddingVertical: 12,
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    marginLeft: 6,
  },
  clearSessionButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D7C3AB',
    backgroundColor: '#F8EFE5',
    paddingVertical: 10,
    marginBottom: 12,
  },
  clearSessionButtonText: {
    color: '#8B5E34',
    fontWeight: '700',
    marginLeft: 6,
    fontSize: 13,
  },
  warningText: {
    color: '#B00020',
    textAlign: 'center',
    marginBottom: 10,
  },
  assignedInfoBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#B6E3C6',
    backgroundColor: '#F1FFF6',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  assignedInfoTitle: {
    color: '#1D6D3E',
    fontWeight: '700',
    fontSize: 13,
  },
  assignedInfoText: {
    color: '#2F7A4D',
    fontSize: 12,
    marginTop: 2,
  },
  sectionTitle: {
    marginTop: 4,
    marginBottom: 8,
    color: '#6A5643',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F7F4',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E2A27',
  },
  deviceMeta: {
    fontSize: 12,
    color: '#7A726A',
    marginTop: 2,
  },
  matchChip: {
    marginTop: 6,
    alignSelf: 'flex-start',
    color: '#0B7A43',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: '#E2F7EA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  linkButton: {
    backgroundColor: '#F28C28',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  linkButtonSecondary: {
    backgroundColor: '#F2B046',
  },
  linkButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.65,
  },
});

export default V8DeviceTab;
