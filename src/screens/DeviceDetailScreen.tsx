import React, { useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBle } from '../bluetooth/BleProvider';
import type { BleServiceSummary } from '../bluetooth/types';

type RouteParams = {
  deviceId: string;
  deviceName?: string | null;
};

const DeviceDetailScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { deviceId, deviceName } = (route.params as RouteParams) ?? {};

  const {
    connectionStates,
    deviceIdentityById,
    gattDetailsById,
    connectToDevice,
  } = useBle();

  const state = connectionStates[deviceId] ?? 'disconnected';
  const identity = deviceIdentityById[deviceId];
  const gatt = gattDetailsById[deviceId];

  const services: BleServiceSummary[] = useMemo(() => gatt?.services ?? [], [gatt]);

  useEffect(() => {
    // Ensure we have a connection to fetch details when entering the screen.
    if (deviceId && state === 'disconnected') {
      connectToDevice(deviceId);
    }
  }, [connectToDevice, deviceId, state]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={22} color="#F28C28" />
        </TouchableOpacity>
        <Text style={styles.title}>{deviceName || 'Device'}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Status</Text>
          <Text style={styles.subtitle}>{state}</Text>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Identity</Text>
          <DetailRow label="IMEI / Serial" value={identity?.serialNumber ?? '—'} />
          <DetailRow label="Manufacturer" value={identity?.manufacturer ?? '—'} />
          <DetailRow label="Model" value={identity?.model ?? '—'} />
          <DetailRow label="Battery" value={identity?.batteryLevel != null ? `${identity.batteryLevel}%` : '—'} />
          <DetailRow label="Firmware" value={identity?.firmwareRevision ?? '—'} />
          <DetailRow label="Hardware" value={identity?.hardwareRevision ?? '—'} />
          <DetailRow label="Software" value={identity?.softwareRevision ?? '—'} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Services & Characteristics</Text>
          {services.length === 0 ? (
            <Text style={styles.subtitle}>No services cached. Connect and discover.</Text>
          ) : null}
          {services.map(service => {
            const writable = service.characteristics.filter(
              c => c.isWritableWithResponse || c.isWritableWithoutResponse,
            );
            const readableOnly = service.characteristics.filter(
              c => c.isReadable && !(c.isWritableWithResponse || c.isWritableWithoutResponse),
            );
            const notifyOnly = service.characteristics.filter(
              c =>
                (c.isNotifiable || c.isIndicatable) &&
                !c.isReadable &&
                !(c.isWritableWithResponse || c.isWritableWithoutResponse),
            );
            const other = service.characteristics.filter(
              c =>
                !writable.includes(c) &&
                !readableOnly.includes(c) &&
                !notifyOnly.includes(c),
            );
            if (!writable.length && !readableOnly.length && !notifyOnly.length && !other.length)
              return null;
            return (
              <View key={service.uuid} style={styles.serviceBlock}>
                <Text style={styles.serviceTitle}>{service.uuid}</Text>

                {writable.length ? (
                  <>
                    <Text style={styles.groupLabel}>Writable</Text>
                    {writable.map(ch => (
                      <CharRow key={ch.uuid} ch={ch} />
                    ))}
                  </>
                ) : null}

                {readableOnly.length ? (
                  <>
                    <Text style={styles.groupLabel}>Readable Only</Text>
                    {readableOnly.map(ch => (
                      <CharRow key={ch.uuid} ch={ch} />
                    ))}
                  </>
                ) : null}

                {notifyOnly.length ? (
                  <>
                    <Text style={styles.groupLabel}>Notify/Indicate Only</Text>
                    {notifyOnly.map(ch => (
                      <CharRow key={ch.uuid} ch={ch} />
                    ))}
                  </>
                ) : null}

                {other.length ? (
                  <>
                    <Text style={styles.groupLabel}>Other</Text>
                    {other.map(ch => (
                      <CharRow key={ch.uuid} ch={ch} />
                    ))}
                  </>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const CharRow = ({ ch }: { ch: BleServiceSummary['characteristics'][number] }) => (
  <View style={styles.charRow}>
    <View style={styles.charInfo}>
      <Text style={styles.charLabel}>{labelForUuid(ch.uuid)}</Text>
      <Text style={styles.charUuid}>{ch.uuid}</Text>
      <Text style={styles.charMeta}>
        {ch.isReadable ? 'R ' : ''}
        {ch.isWritableWithResponse || ch.isWritableWithoutResponse ? 'W ' : ''}
        {ch.isNotifiable || ch.isIndicatable ? 'N ' : ''}
      </Text>
    </View>
  </View>
);

const labelForUuid = (uuid: string) => {
  const u = uuid.toLowerCase();
  const map: Record<string, string> = {
    '1800': 'Generic Access',
    '1801': 'Generic Attribute',
    '180a': 'Device Information',
    '180f': 'Battery Service',
    '2a00': 'Device Name',
    '2a01': 'Appearance',
    '2a04': 'Connection Params',
    '2a05': 'Service Changed',
    '2a19': 'Battery Level',
    '2a24': 'Model Number',
    '2a25': 'Serial Number',
    '2a26': 'Firmware Revision',
    '2a27': 'Hardware Revision',
    '2a28': 'Software Revision',
    '2a29': 'Manufacturer',
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e': 'NUS Service',
    '6e400002-b5a3-f393-e0a9-e50e24dcca9e': 'NUS RX (write)',
    '6e400003-b5a3-f393-e0a9-e50e24dcca9e': 'NUS TX (notify)',
  };
  return map[u] ?? 'Unknown';
};

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F2EE' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#2E2A27' },
  content: { paddingBottom: 24 },
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
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#2E2A27', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#7A726A', marginBottom: 8 },
  divider: { height: 1, backgroundColor: '#EFE7DD', marginVertical: 10 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  detailLabel: { fontSize: 13, color: '#7A726A' },
  detailValue: { fontSize: 13, color: '#2E2A27', fontWeight: '600' },
  serviceBlock: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#EFE7DD', paddingTop: 10 },
  serviceTitle: { fontSize: 13, fontWeight: '700', color: '#2E2A27', marginBottom: 6 },
  groupLabel: { fontSize: 12, fontWeight: '700', color: '#7A726A', marginTop: 6, marginBottom: 4 },
  charRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1E8DE',
  },
  charInfo: { flex: 1 },
  charUuid: { fontSize: 12, color: '#2E2A27' },
  charMeta: { fontSize: 11, color: '#7A726A', marginTop: 2 },
});

export default DeviceDetailScreen;
