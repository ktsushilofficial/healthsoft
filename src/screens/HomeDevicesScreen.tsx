import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  getSeniorDashboardDeviceLabel,
  mapSeniorDashboardDeviceToSnapshot,
} from '../utils/mapSeniorDashboardDeviceToSnapshot';
import type { SeniorDashboardDeviceRecord } from '../types/seniorDashboard';

const NA = 'NA';

type HomeDevicesRouteParams = {
  dashboardDevices?: SeniorDashboardDeviceRecord[];
  activeSeniorId?: string | null;
  showV8HandBand?: boolean;
};

function capitalizeWord(value: string) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function readStringField(record: SeniorDashboardDeviceRecord, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBooleanField(record: SeniorDashboardDeviceRecord, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function formatBatteryPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return NA;
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function batteryIconFor(
  batteryPercent: number | null | undefined,
  charging?: boolean | null,
): string {
  if (charging === true) return 'battery-charging';
  if (batteryPercent == null || Number.isNaN(batteryPercent)) return 'battery-dead-outline';
  if (batteryPercent > 75) return 'battery-full';
  if (batteryPercent > 30) return 'battery-half';
  return 'battery-dead';
}

function formatDeviceActivityStatus(record: SeniorDashboardDeviceRecord | null): string {
  if (!record) return NA;

  const explicitStatus =
    readStringField(record, 'status') ??
    readStringField(record, 'deviceStatus') ??
    readStringField(record, 'assignmentStatus') ??
    readStringField(record, 'device.status');
  if (explicitStatus) {
    return explicitStatus
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map(capitalizeWord)
      .join(' ');
  }

  const moving =
    readBooleanField(record, 'movementStatus') ??
    readBooleanField(record, 'movement.status');
  if (moving != null) {
    return moving ? 'Active' : 'Stationary';
  }

  return NA;
}

function readDeviceIdentifier(row: SeniorDashboardDeviceRecord): string {
  return readStringField(row, 'ident') ?? readStringField(row, 'imei') ?? '';
}

function readDeviceUuid(row: SeniorDashboardDeviceRecord): string {
  return (
    readStringField(row, 'device.uuid') ??
    readStringField(row, 'deviceUUID') ??
    readStringField(row, 'deviceUuid') ??
    ''
  );
}

const HomeDevicesScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const params = (route.params || {}) as HomeDevicesRouteParams;
  const dashboardDevices = useMemo(
    () => (Array.isArray(params.dashboardDevices) ? params.dashboardDevices : []),
    [params.dashboardDevices],
  );
  const showV8HandBand = params.showV8HandBand === true;

  const hasAnyDevice = dashboardDevices.length > 0 || showV8HandBand;

  const pendantRows = useMemo(
    () =>
      dashboardDevices.map((row, index) => {
        const snap = mapSeniorDashboardDeviceToSnapshot(row);
        return {
          key: `pendant-${readDeviceIdentifier(row) || index}`,
          row,
          label: getSeniorDashboardDeviceLabel(row),
          subtitle: snap.alarmSeverity === 'critical' ? 'Fall Detected!' : 'Fall detection · Armed',
          status: formatDeviceActivityStatus(row),
          batteryValue: formatBatteryPercent(snap.batteryPercent),
          batteryIcon: batteryIconFor(snap.batteryPercent, snap.charging),
        };
      }),
    [dashboardDevices],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Icon name="arrow-back" size={22} color="#F28C28" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          All devices
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!hasAnyDevice ? (
          <View style={styles.emptyCard}>
            <Icon name="hardware-chip-outline" size={28} color="#AF9F92" />
            <Text style={styles.emptyTitle}>No devices available</Text>
            <Text style={styles.emptyBody}>Devices shown on Home will appear here.</Text>
          </View>
        ) : null}

        {pendantRows.map(item => (
          <TouchableOpacity
            key={item.key}
            style={styles.deviceRowCard}
            activeOpacity={0.8}
            onPress={() => {
              navigation.navigate('PendantDetail', {
                seniorId: params.activeSeniorId || undefined,
                imei: readDeviceIdentifier(item.row),
                deviceUuid: readDeviceUuid(item.row),
                deviceName: item.label,
              });
            }}
          >
            <View style={[styles.deviceRowIconWrap, styles.deviceIconPendantBg]}>
              <Icon name="sunny" size={22} color="#D97706" />
            </View>
            <View style={styles.deviceRowTextCol}>
              <Text style={styles.deviceRowName}>{item.label}</Text>
              <Text style={styles.deviceRowSub}>{item.subtitle}</Text>
            </View>
            <View style={styles.deviceRowStatusCol}>
              <Text style={[styles.deviceRowStatusText, styles.deviceRowStatusActive]}>
                {item.status}
              </Text>
              <View style={styles.deviceRowBatteryWrap}>
                <Icon name={item.batteryIcon} size={14} color="#8A827A" />
                <Text style={styles.deviceRowBatteryText}>{item.batteryValue}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}

        {showV8HandBand ? (
          <TouchableOpacity
            style={styles.deviceRowCard}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Activity')}
          >
            <View style={[styles.deviceRowIconWrap, styles.vitalIconHeartBg]}>
              <Icon name="heart" size={22} color="#EF4444" />
            </View>
            <View style={styles.deviceRowTextCol}>
              <Text style={styles.deviceRowName}>Smart Band</Text>
              <Text style={styles.deviceRowSub}>Heart rate</Text>
            </View>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

export default HomeDevicesScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9F6F0',
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
  content: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 40,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 17,
    fontWeight: '800',
    color: '#1B2A4A',
  },
  emptyBody: {
    marginTop: 6,
    fontSize: 13,
    color: '#8F8276',
    textAlign: 'center',
  },
  deviceRowCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#1B2A4A',
    shadowOpacity: 0.02,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  deviceRowIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  deviceIconPendantBg: {
    backgroundColor: '#FFF7E6',
  },
  vitalIconHeartBg: {
    backgroundColor: '#FEF2F2',
  },
  deviceRowTextCol: {
    flex: 1,
  },
  deviceRowName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1B2A4A',
  },
  deviceRowSub: {
    fontSize: 12,
    color: '#8F8276',
    marginTop: 3,
  },
  deviceRowStatusCol: {
    alignItems: 'flex-end',
  },
  deviceRowStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  deviceRowStatusActive: {
    color: '#10B981',
  },
  deviceRowBatteryWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  deviceRowBatteryText: {
    fontSize: 12,
    color: '#8A827A',
    marginLeft: 4,
  },
});
