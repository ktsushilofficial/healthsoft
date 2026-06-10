import React, { useMemo } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { DeviceStackParamList } from '../types/navigation';
import { usePillBox } from '../pillbox/PillBoxBleProvider';

const normalizeId = (id?: string | null) => (id ?? '').trim().toLowerCase();

const PillBoxDeviceTab = () => {
  const navigation = useNavigation<NativeStackNavigationProp<DeviceStackParamList>>();
  const {
    bleState,
    devices,
    isScanning,
    scanError,
    connectionStates,
    activeSnapshot,
    startScan,
    stopScan,
    connect,
    disconnect,
    clearScanResults,
  } = usePillBox();

  const connectedDeviceIds = useMemo(
    () =>
      new Set(
        Object.entries(connectionStates)
          .filter(([, state]) => state === 'connected' || state === 'dataSynced')
          .map(([deviceId]) => deviceId),
      ),
    [connectionStates],
  );

  const sortedDevices = useMemo(() => {
    return [...devices].sort((a, b) => {
      const aConnected = connectedDeviceIds.has(normalizeId(a.id));
      const bConnected = connectedDeviceIds.has(normalizeId(b.id));
      if (aConnected !== bConnected) {
        return aConnected ? -1 : 1;
      }
      return (a.name ?? a.localName ?? a.id).localeCompare(b.name ?? b.localName ?? b.id);
    });
  }, [connectedDeviceIds, devices]);

  const connectedCount = connectedDeviceIds.size;
  const activeDeviceId = activeSnapshot?.deviceId ?? null;

  const openManage = async (deviceId: string, deviceName?: string | null) => {
    navigation.navigate('PillBoxDeviceManage', {
      deviceId,
      deviceName: deviceName ?? 'Pill Dispenser',
    });
  };

  const handleDeviceAction = async (deviceId: string, deviceName?: string | null) => {
    const state = connectionStates[normalizeId(deviceId)] ?? 'disconnected';
    const connected = state === 'connected' || state === 'dataSynced';

    try {
      if (connected) {
        await disconnect(deviceId);
        return;
      }
      await connect(deviceId);
      await openManage(deviceId, deviceName);
    } catch (error) {
      Alert.alert(
        'Pill dispenser',
        error instanceof Error ? error.message : 'Unable to connect to the selected pill dispenser.',
      );
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Pill Dispenser</Text>
      <Text style={styles.cardSubtitle}>
        Independent pill dispenser flow for scanning, connecting, and alarm setup.
      </Text>

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => (isScanning ? stopScan() : startScan())}
        activeOpacity={0.85}
      >
        {isScanning ? <ActivityIndicator color="#FFFFFF" /> : <Icon name="bluetooth" size={18} color="#FFFFFF" />}
        <Text style={styles.primaryButtonText}>
          {bleState === 'Unsupported'
            ? 'Pill Dispenser Not Supported'
            : isScanning
              ? 'Scanning Pill Dispenser...'
              : 'Scan Pill Dispensers'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={() => clearScanResults()} activeOpacity={0.85}>
        <Icon name="trash-outline" size={16} color="#8C5A19" />
        <Text style={styles.secondaryButtonText}>Clear Scan Results</Text>
      </TouchableOpacity>

      {scanError ? <Text style={styles.warningText}>{scanError}</Text> : null}

      <View style={styles.summaryBox}>
        <Text style={styles.summaryTitle}>Current state</Text>
        <Text style={styles.summaryText}>
          {bleState === 'Unsupported'
            ? 'Native pill dispenser module is unavailable on this build.'
            : connectedCount > 0
              ? `${connectedCount} connected device${connectedCount === 1 ? '' : 's'}`
              : 'No pill dispenser connected yet.'}
        </Text>
        <Text style={styles.summaryText}>
          {activeDeviceId ? `Active device: ${activeDeviceId}` : 'No active device selected.'}
        </Text>
      </View>

      {sortedDevices.length === 0 ? (
        <Text style={styles.emptyText}>
          Scan nearby pill dispensers to start the connection flow.
        </Text>
      ) : (
        sortedDevices.map(device => {
          const state = connectionStates[normalizeId(device.id)] ?? 'disconnected';
          const connected = state === 'connected' || state === 'dataSynced';
          const busy = state === 'connecting' || state === 'disconnecting';
          const snapshot = activeSnapshot?.deviceId && normalizeId(activeSnapshot.deviceId) === normalizeId(device.id)
            ? activeSnapshot
            : null;

          return (
            <View key={device.id} style={styles.deviceRow}>
              <View style={styles.deviceIconWrap}>
                <Icon name="cube-outline" size={20} color="#C06A00" />
              </View>
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName}>{device.name ?? device.localName ?? 'Pill Dispenser'}</Text>
                <Text style={styles.deviceMeta}>ID: {device.id}</Text>
                <Text style={styles.deviceMeta}>
                  {typeof device.rssi === 'number' ? `RSSI: ${device.rssi}` : 'Nearby'}
                </Text>
                <Text style={styles.deviceMeta}>Status: {state}</Text>
                {snapshot?.batteryPercent != null ? (
                  <Text style={styles.deviceMeta}>Battery: {snapshot.batteryPercent}%</Text>
                ) : null}
                {snapshot?.nextAlarmTime ? (
                  <Text style={styles.deviceMeta}>Next alarm: {snapshot.nextAlarmTime}</Text>
                ) : null}
              </View>
              <View style={styles.deviceActions}>
                <TouchableOpacity
                  style={[styles.linkButton, connected ? styles.linkButtonSecondary : null, busy ? styles.disabled : null]}
                  disabled={busy}
                  onPress={() => handleDeviceAction(device.id, device.name ?? device.localName)}
                >
                  <Text style={styles.linkButtonText}>
                    {connected ? 'Disconnect' : busy ? 'Working...' : 'Connect'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.manageButton, busy ? styles.disabled : null]}
                  disabled={busy}
                  onPress={() => openManage(device.id, device.name ?? device.localName)}
                >
                  <Text style={styles.manageButtonText}>Manage</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
};

export default PillBoxDeviceTab;

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
    backgroundColor: '#C86A12',
    borderRadius: 22,
    paddingVertical: 12,
    marginBottom: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    marginLeft: 6,
  },
  secondaryButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F4E5D3',
    borderRadius: 22,
    paddingVertical: 11,
    marginBottom: 14,
  },
  secondaryButtonText: {
    color: '#8C5A19',
    fontWeight: '600',
    marginLeft: 6,
  },
  summaryBox: {
    backgroundColor: '#FFF8F0',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#F3D7B3',
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7A4C12',
    marginBottom: 6,
  },
  summaryText: {
    fontSize: 13,
    color: '#5C4A38',
    lineHeight: 18,
  },
  emptyText: {
    fontSize: 13,
    color: '#7A726A',
    textAlign: 'center',
    lineHeight: 18,
    paddingVertical: 8,
  },
  warningText: {
    color: '#B23A25',
    fontSize: 12,
    marginBottom: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FBF7F2',
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F2E4D4',
  },
  deviceIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFECD7',
    marginRight: 10,
    marginTop: 2,
  },
  deviceInfo: {
    flex: 1,
    paddingRight: 10,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2E2A27',
    marginBottom: 3,
  },
  deviceMeta: {
    fontSize: 12,
    color: '#6F665C',
    lineHeight: 16,
  },
  deviceActions: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  linkButton: {
    backgroundColor: '#C86A12',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    minWidth: 90,
    alignItems: 'center',
  },
  linkButtonSecondary: {
    backgroundColor: '#8B5E34',
  },
  linkButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  manageButton: {
    backgroundColor: '#F1E4D6',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 90,
    alignItems: 'center',
  },
  manageButtonText: {
    color: '#7B5835',
    fontSize: 12,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.55,
  },
});
