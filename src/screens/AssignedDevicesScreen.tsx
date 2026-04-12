import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import type { SeniorAssignedDevice } from '../utils/deviceAssignments';

const SENIOR_ROLE = 'SENIOR';

function displayImei(device: SeniorAssignedDevice): string {
  return device.imei ?? device.serialNumber ?? device.deviceIdentifier ?? '—';
}

const AssignedDevicesScreen = () => {
  const navigation = useNavigation();
  const { user, isCaretaker, selectedSenior, getAssignedDevicesForSenior } = useAuth();
  const [devices, setDevices] = useState<SeniorAssignedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSeniorId = useMemo(() => {
    if (isCaretaker) {
      return selectedSenior?.userId ?? null;
    }
    return user?.role === SENIOR_ROLE ? user.user_id : null;
  }, [isCaretaker, selectedSenior?.userId, user?.role, user?.user_id]);

  const load = useCallback(async () => {
    if (!activeSeniorId) {
      setDevices([]);
      setError(
        isCaretaker
          ? 'Select a senior profile first to view assigned devices.'
          : 'Unable to determine profile for devices.',
      );
      setLoading(false);
      return;
    }

    setError(null);
    try {
      const next = await getAssignedDevicesForSenior(activeSeniorId);
      setDevices(next);
    } catch (e) {
      setDevices([]);
      setError(e instanceof Error ? e.message : 'Failed to load devices.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeSeniorId, getAssignedDevicesForSenior, isCaretaker]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    if (!activeSeniorId) return;
    setRefreshing(true);
    load();
  }, [activeSeniorId, load]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Icon name="arrow-back" size={22} color="#F28C28" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Assigned devices
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#F28C28"
            enabled={!!activeSeniorId}
          />
        }
      >
        <View style={styles.introCard}>
          <Icon name="server-outline" size={28} color="#F28C28" />
          <Text style={styles.introTitle}>From your care plan</Text>
          <Text style={styles.introSubtitle}>
            Devices registered for this profile on the server. This list does not use Bluetooth.
          </Text>
        </View>

        {loading && !refreshing ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#F28C28" />
            <Text style={styles.loadingText}>Loading devices…</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.card}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {!loading && !error && devices.length === 0 && activeSeniorId ? (
          <View style={styles.card}>
            <Text style={styles.emptyTitle}>No devices assigned</Text>
            <Text style={styles.emptyBody}>
              There are no devices linked to this senior in the system yet.
            </Text>
          </View>
        ) : null}

        {devices.map(device => (
          <View key={device.id} style={styles.deviceCard}>
            <View style={styles.deviceCardHeader}>
              <Icon name="hardware-chip-outline" size={22} color="#F28C28" />
              <Text style={styles.deviceName} numberOfLines={2}>
                {device.name ?? 'Unnamed device'}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>IMEI / ID</Text>
              <Text style={styles.detailValue} selectable>
                {displayImei(device)}
              </Text>
            </View>

            {device.status ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Status</Text>
                <Text style={styles.detailValue}>{device.status}</Text>
              </View>
            ) : null}

            {device.deviceId && device.deviceId !== displayImei(device) ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Device ID</Text>
                <Text style={styles.detailValue} selectable>
                  {device.deviceId}
                </Text>
              </View>
            ) : null}

            {device.serialNumber &&
            device.serialNumber !== device.imei &&
            device.serialNumber !== displayImei(device) ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Serial</Text>
                <Text style={styles.detailValue} selectable>
                  {device.serialNumber}
                </Text>
              </View>
            ) : null}

            {device.bluetoothMacAddress ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Bluetooth MAC</Text>
                <Text style={styles.detailValue} selectable>
                  {device.bluetoothMacAddress}
                </Text>
              </View>
            ) : null}

            {device.assignmentId ? (
              <View style={styles.detailRowMuted}>
                <Text style={styles.mutedLabel}>Assignment</Text>
                <Text style={styles.mutedValue} selectable numberOfLines={1}>
                  {device.assignmentId}
                </Text>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

export default AssignedDevicesScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F2EE',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E2DA',
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#2E2A27',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  headerSpacer: {
    width: 22,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  introCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  introTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2E2A27',
    marginTop: 10,
  },
  introSubtitle: {
    fontSize: 13,
    color: '#7A726A',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
  },
  centered: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    color: '#7A726A',
  },
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 18,
    padding: 16,
  },
  errorText: {
    color: '#B00020',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2E2A27',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 14,
    color: '#7A726A',
    textAlign: 'center',
    lineHeight: 20,
  },
  deviceCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  deviceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  deviceName: {
    flex: 1,
    marginLeft: 10,
    fontSize: 17,
    fontWeight: '700',
    color: '#2E2A27',
  },
  detailRow: {
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EEE6DD',
  },
  detailRowMuted: {
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F0EBE6',
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A827A',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2E2A27',
  },
  mutedLabel: {
    fontSize: 11,
    color: '#A09890',
    marginBottom: 2,
  },
  mutedValue: {
    fontSize: 12,
    color: '#7A726A',
  },
});
