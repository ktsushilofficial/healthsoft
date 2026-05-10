import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useV8DeviceManager } from '../v8/useV8DeviceManager';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { DeviceStackParamList } from '../types/navigation';

const V8DeviceTab = () => {
  const normalizeId = (id?: string | null) => (id ?? '').trim().toLowerCase();
  const navigation = useNavigation<NativeStackNavigationProp<DeviceStackParamList>>();
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
  } = useV8DeviceManager();
  const [clearingSession, setClearingSession] = useState(false);

  const ensureAutoConnectRef = useRef(ensureAutoConnect);
  useEffect(() => {
    ensureAutoConnectRef.current = ensureAutoConnect;
  }, [ensureAutoConnect]);

  useFocusEffect(
    useCallback(() => {
      ensureAutoConnectRef.current().catch(() => {});
    }, []),
  );

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Hand Band Manager</Text>
      <Text style={styles.cardSubtitle}>
        Dedicated Hand Band detection and connection flow, isolated from your current device manager.
      </Text>

      <TouchableOpacity style={styles.primaryButton} onPress={() => (isScanning ? stopScan() : startScan())}>
        {isScanning ? <ActivityIndicator color="#fff" /> : <Icon name="bluetooth" size={18} color="#fff" />}
        <Text style={styles.primaryButtonText}>
          {isScanning ? 'Scanning Hand Band...' : bleState === 'PoweredOn' ? 'Scan Hand Band Devices' : 'Enable Bluetooth'}
        </Text>
      </TouchableOpacity>

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

      {scanError ? <Text style={styles.warningText}>{scanError}</Text> : null}
      {devices.length === 0 ? <Text style={styles.cardSubtitle}>No Hand Band device detected yet.</Text> : null}

      {devices.map(device => {
        const state = connectionStates[normalizeId(device.id)] ?? 'disconnected';
        const busy = state === 'connecting' || state === 'disconnecting';
        const connected = state === 'connected';
        return (
          <View key={device.id} style={styles.deviceRow}>
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName}>{device.name ?? device.localName ?? 'Hand Band'}</Text>
              <Text style={styles.deviceMeta}>{typeof device.rssi === 'number' ? `RSSI: ${device.rssi}` : 'Available'}</Text>
              <Text style={styles.deviceMeta}>ID: {device.id}</Text>
            </View>
            <TouchableOpacity
              style={[styles.linkButton, connected ? styles.linkButtonSecondary : null, busy ? styles.disabled : null]}
              disabled={busy}
              onPress={async () => {
                if (connected) {
                  await disconnect(device.id);
                  return;
                }
                await connect(device.id);
                navigation.navigate('V8DeviceManage', {
                  deviceId: device.id,
                  deviceName: device.name ?? device.localName ?? 'Hand Band',
                });
              }}
            >
              <Text style={styles.linkButtonText}>
                {connected ? 'Disconnect' : busy ? 'Working...' : 'Connect'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.linkButton, { marginLeft: 8, backgroundColor: '#EDE4DA' }]}
              onPress={() =>
                navigation.navigate('V8DeviceManage', {
                  deviceId: device.id,
                  deviceName: device.name ?? device.localName ?? 'Hand Band',
                })
              }
            >
              <Text style={[styles.linkButtonText, { color: '#7B5835' }]}>Manage</Text>
            </TouchableOpacity>
          </View>
        );
      })}
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
