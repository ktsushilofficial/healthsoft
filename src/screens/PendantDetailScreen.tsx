// src/screens/PendantDetailScreen.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ImageBackground,
  Dimensions,
  Platform,
} from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_HORIZONTAL_MARGIN = 10;
const CARD_GAP = 8;
const GRID_AVAILABLE_WIDTH = SCREEN_WIDTH - CARD_HORIZONTAL_MARGIN * 2;
const HALF_TILE_WIDTH = (GRID_AVAILABLE_WIDTH - CARD_GAP * 3) / 2;
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { useAuth } from '../context/AuthContext';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { emptySeniorHomeSnapshot } from '../types/seniorHomeSnapshot';
import type { SeniorDashboardDeviceRecord } from '../types/seniorDashboard';
import type { GuardianSeniorProfileRow } from '../types/guardianDashboard';
import {
  getSeniorDashboardDeviceLabel,
  mapSeniorDashboardDeviceToSnapshot,
} from '../utils/mapSeniorDashboardDeviceToSnapshot';
import {
  formatDashboardGeofenceValue,
  getDashboardGeofenceStatus,
} from '../utils/dashboardGeofenceStatus';

const SENIOR_ROLE = 'SENIOR';
const CARETAKER_ROLE = 'CARE_TAKER';
const GUARDIAN_ROLE = 'GUARDIAN';
const NA = 'NA';
const DASHBOARD_AUTO_REFRESH_MS = 30_000;
const MAP_PROVIDER_NAME = Platform.OS === 'ios' ? 'Apple Maps' : 'Google Maps';

function displayStr(value: string | null | undefined): string {
  if (value == null || String(value).trim() === '') {
    return NA;
  }
  return value;
}

function displayDeg(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return NA;
  }
  return `${value.toFixed(6)}°`;
}

function displayBatteryPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return NA;
  }
  return `${Math.round(value)}%`;
}

function chargingCaption(charging: boolean | null): string {
  if (charging === null) {
    return NA;
  }
  return charging ? 'Charging now' : 'On battery power';
}

function joinDisplayParts(...parts: Array<string | null | undefined>): string {
  const filtered = parts
    .map(part => displayStr(part))
    .filter(part => part !== NA);
  return filtered.length > 0 ? filtered.join(' · ') : NA;
}

function readStringField(record: SeniorDashboardDeviceRecord, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumberField(record: SeniorDashboardDeviceRecord, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

function hasOwnField(record: SeniorDashboardDeviceRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasAnyOwnField(record: SeniorDashboardDeviceRecord, keys: string[]): boolean {
  return keys.some(key => hasOwnField(record, key));
}

function toEpochSeconds(value: number | null): number | null {
  if (value == null || value <= 0) return null;
  return value > 1e12 ? value / 1000 : value;
}

function pickLatestEpochValue(a: number | null, b: number | null): number | null {
  const aSec = toEpochSeconds(a);
  const bSec = toEpochSeconds(b);
  if (aSec == null) return b;
  if (bSec == null) return a;
  return aSec >= bSec ? a : b;
}

function withPositionAliases(position: SeniorDashboardDeviceRecord): SeniorDashboardDeviceRecord {
  return {
    ...position,
    ident: readStringField(position, 'imei') ?? readStringField(position, 'ident'),
    imei: readStringField(position, 'imei'),
    'device.uuid': readStringField(position, 'deviceUUID') ?? readStringField(position, 'deviceUuid'),
    'device.name': readStringField(position, 'deviceName') ?? readStringField(position, 'device.name'),
    deviceName: readStringField(position, 'deviceName') ?? readStringField(position, 'device.name'),
    'device.serial.number':
      readStringField(position, 'deviceSerialNumber') ?? readStringField(position, 'device.serial.number'),
    'device.id': readNumberField(position, 'deviceId') ?? readNumberField(position, 'device.id'),
    'position.latitude':
      readNumberField(position, 'positionLatitude') ?? readNumberField(position, 'position.latitude'),
    'position.longitude':
      readNumberField(position, 'positionLongitude') ?? readNumberField(position, 'position.longitude'),
    'position.altitude':
      readNumberField(position, 'positionAltitude') ?? readNumberField(position, 'position.altitude'),
    'position.direction':
      readNumberField(position, 'positionDirection') ?? readNumberField(position, 'position.direction'),
    'speed.kph': readNumberField(position, 'positionSpeed') ?? readNumberField(position, 'speed.kph'),
    hdop: readNumberField(position, 'positionHdop') ?? readNumberField(position, 'hdop'),
    satellites:
      readNumberField(position, 'positionSatellites') ?? readNumberField(position, 'satellites'),
    'server.timestamp':
      readNumberField(position, 'serverTimestamp') ?? readNumberField(position, 'server.timestamp'),
  };
}

function mergeGuardianDeviceStatusWithPosition(
  statusRows: SeniorDashboardDeviceRecord[],
  positionRows: SeniorDashboardDeviceRecord[],
  alarmRows: SeniorDashboardDeviceRecord[] = [],
): SeniorDashboardDeviceRecord[] {
  if (statusRows.length === 0) return [];
  if (positionRows.length === 0 && alarmRows.length === 0) return statusRows;

  const positions = positionRows.map(withPositionAliases);
  const byIdent = new Map<string, SeniorDashboardDeviceRecord>();
  const byDeviceName = new Map<string, SeniorDashboardDeviceRecord>();
  const byDeviceId = new Map<number, SeniorDashboardDeviceRecord>();
  const byUuid = new Map<string, SeniorDashboardDeviceRecord>();

  const alarmsByIdent = new Map<string, SeniorDashboardDeviceRecord>();
  const alarmsByUuid = new Map<string, SeniorDashboardDeviceRecord>();

  alarmRows.forEach(alarm => {
    const ident = readStringField(alarm, 'ident');
    if (ident) alarmsByIdent.set(ident, alarm);
    const uuid = readStringField(alarm, 'deviceUUID') ?? readStringField(alarm, 'deviceUuid') ?? readStringField(alarm, 'device.uuid');
    if (uuid) alarmsByUuid.set(uuid, alarm);
  });

  positions.forEach(pos => {
    const ident = readStringField(pos, 'ident');
    if (ident) byIdent.set(ident, pos);
    const uuid = readStringField(pos, 'device.uuid');
    if (uuid) byUuid.set(uuid, pos);

    const name = readStringField(pos, 'device.name');
    if (name) byDeviceName.set(name.toLowerCase(), pos);

    const id = readNumberField(pos, 'device.id') ?? readNumberField(pos, 'id');
    if (id != null) byDeviceId.set(id, pos);
  });

  return statusRows.map(status => {
    const normalizedStatus: SeniorDashboardDeviceRecord = {
      ...status,
      ident: readStringField(status, 'imei') ?? readStringField(status, 'ident'),
      'device.name': readStringField(status, 'deviceName') ?? readStringField(status, 'device.name'),
      'device.id': readNumberField(status, 'deviceId') ?? readNumberField(status, 'device.id'),
      'device.uuid': readStringField(status, 'deviceUuid') ?? readStringField(status, 'deviceUUID'),
      'battery.level': readNumberField(status, 'batteryLevel') ?? readNumberField(status, 'battery.level'),
      'battery.charging.status':
        (status['batteryChargingStatus'] as boolean | undefined) ??
        (status['battery.charging.status'] as boolean | undefined),
      'fall.alarm.status':
        (status['fallAlarmStatus'] as boolean | undefined) ??
        (status['fall.alarm.status'] as boolean | undefined),
      'movement.status':
        (status['movementStatus'] as boolean | undefined) ??
        (status['movement.status'] as boolean | undefined),
      'gsm.network.type': readStringField(status, 'gsmNetworkType') ?? readStringField(status, 'gsm.network.type'),
      'gsm.signal.dbm': readNumberField(status, 'gsmSignalDbm') ?? readNumberField(status, 'gsm.signal.dbm'),
      'wifi.status':
        (status['wifiStatus'] as boolean | undefined) ?? (status['wifi.status'] as boolean | undefined),
      'server.timestamp':
        readNumberField(status, 'serverTimestamp') ?? readNumberField(status, 'server.timestamp'),
    };

    const statusTimestamp = readNumberField(normalizedStatus, 'timestamp');
    const statusServerTimestamp = readNumberField(normalizedStatus, 'server.timestamp');

    const ident = readStringField(normalizedStatus, 'ident');
    const deviceName = readStringField(normalizedStatus, 'device.name');
    const deviceId = readNumberField(normalizedStatus, 'device.id');
    const deviceUuid = readStringField(normalizedStatus, 'device.uuid');
    const matched =
      (ident ? byIdent.get(ident) : undefined) ??
      (deviceUuid ? byUuid.get(deviceUuid) : undefined) ??
      (deviceId != null ? byDeviceId.get(deviceId) : undefined) ??
      (deviceName ? byDeviceName.get(deviceName.toLowerCase()) : undefined);

    const matchedAlarm =
      (ident ? alarmsByIdent.get(ident) : undefined) ??
      (deviceUuid ? alarmsByUuid.get(deviceUuid) : undefined);

    let merged: SeniorDashboardDeviceRecord = { ...normalizedStatus };
    if (matched) merged = { ...merged, ...matched };
    if (matchedAlarm) merged = { ...merged, ...matchedAlarm };

    const positionTimestamp = readNumberField(matched || {}, 'timestamp');
    const positionServerTimestamp =
      readNumberField(matched || {}, 'server.timestamp') ?? readNumberField(matched || {}, 'serverTimestamp');
    const alarmTimestamp = readNumberField(matchedAlarm || {}, 'timestamp');
    const alarmServerTimestamp =
      readNumberField(matchedAlarm || {}, 'server.timestamp') ??
      readNumberField(matchedAlarm || {}, 'serverTimestamp');

    if (statusTimestamp != null) {
      merged['status.timestamp'] = statusTimestamp;
      merged['battery.timestamp'] = statusTimestamp;
    }
    if (statusServerTimestamp != null) {
      merged['status.server.timestamp'] = statusServerTimestamp;
      merged['battery.server.timestamp'] = statusServerTimestamp;
    }
    if (positionTimestamp != null) {
      merged['position.timestamp'] = positionTimestamp;
    }
    if (positionServerTimestamp != null) {
      merged['position.server.timestamp'] = positionServerTimestamp;
    }
    if (alarmTimestamp != null) {
      merged['alarm.timestamp'] = alarmTimestamp;
    }
    if (alarmServerTimestamp != null) {
      merged['alarm.server.timestamp'] = alarmServerTimestamp;
    }

    const latestTimestamp = pickLatestEpochValue(
      readNumberField(normalizedStatus, 'timestamp'),
      readNumberField(matched || {}, 'timestamp'),
    );
    if (latestTimestamp != null) {
      merged.timestamp = latestTimestamp;
    }

    const latestServerTimestamp = pickLatestEpochValue(
      readNumberField(normalizedStatus, 'server.timestamp'),
      pickLatestEpochValue(readNumberField(matched || {}, 'server.timestamp'), readNumberField(matchedAlarm || {}, 'server.timestamp'))
    );
    if (latestServerTimestamp != null) {
      merged['server.timestamp'] = latestServerTimestamp;
      merged.serverTimestamp = latestServerTimestamp;
    }

    return merged;
  });
}

function guardianProfileIndex(
  profiles: GuardianSeniorProfileRow[],
  selectedSeniorUserId: string | null | undefined,
): number {
  if (profiles.length === 0) return 0;
  const trimmed = (selectedSeniorUserId || '').trim();
  if (!trimmed) return 0;
  const matchIdx = profiles.findIndex(
    p => (p.seniorDetailsDTO?.userId || '').trim() === trimmed,
  );
  return matchIdx >= 0 ? matchIdx : 0;
}

const PendantDetailScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { seniorId, imei, deviceUuid: routeDeviceUuid, deviceName } = route.params || {};

  const {
    user,
    getSeniorDashboard,
    getGuardianDashboard,
  } = useAuth();
  const [dashboardDevices, setDashboardDevices] = useState<SeniorDashboardDeviceRecord[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [guardianSeniorProfiles, setGuardianSeniorProfiles] = useState<GuardianSeniorProfileRow[]>([]);
  const [guardianDevicePositions, setGuardianDevicePositions] = useState<SeniorDashboardDeviceRecord[]>([]);
  const [guardianDeviceAlarms, setGuardianDeviceAlarms] = useState<SeniorDashboardDeviceRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const isMountedRef = useRef(true);
  const dashboardRequestIdRef = useRef(0);
  const initialDashboardLoadCountRef = useRef(0);
  const manualDashboardRefreshCountRef = useRef(0);
  const backgroundDashboardRefreshCountRef = useRef(0);

  const dashboardContextKey = useMemo(() => {
    if (!user) return 'anonymous';
    if (user.role === GUARDIAN_ROLE) {
      return `${user.role}:${user.user_id}`;
    }
    return `${user.role}:${user.user_id}:${seniorId || ''}`;
  }, [seniorId, user]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchDashboardData = useCallback(async (
    mode: 'initial' | 'manual' | 'background' = 'initial',
  ) => {
    const requestId = ++dashboardRequestIdRef.current;
    const shouldIgnore = () =>
      !isMountedRef.current || dashboardRequestIdRef.current !== requestId;
    const isManualRefresh = mode === 'manual';
    const isBackgroundRefresh = mode === 'background';
    const shouldShowLoader = mode === 'initial';
    const shouldPreserveExistingData = mode === 'background';
    const acquireFetchSlot = () => {
      if (isBackgroundRefresh) {
        if (
          initialDashboardLoadCountRef.current > 0 ||
          manualDashboardRefreshCountRef.current > 0 ||
          backgroundDashboardRefreshCountRef.current > 0
        ) {
          return false;
        }
        backgroundDashboardRefreshCountRef.current += 1;
        return true;
      }
      if (isManualRefresh) {
        manualDashboardRefreshCountRef.current += 1;
        return true;
      }
      if (shouldShowLoader) {
        initialDashboardLoadCountRef.current += 1;
      }
      return true;
    };
    const releaseFetchSlot = () => {
      if (isBackgroundRefresh) {
        backgroundDashboardRefreshCountRef.current = Math.max(
          0,
          backgroundDashboardRefreshCountRef.current - 1,
        );
        return;
      }
      if (isManualRefresh) {
        manualDashboardRefreshCountRef.current = Math.max(
          0,
          manualDashboardRefreshCountRef.current - 1,
        );
        if (manualDashboardRefreshCountRef.current === 0) {
          setRefreshing(false);
        }
        return;
      }
      if (shouldShowLoader) {
        initialDashboardLoadCountRef.current = Math.max(
          0,
          initialDashboardLoadCountRef.current - 1,
        );
        if (initialDashboardLoadCountRef.current === 0) {
          setDashboardLoading(false);
        }
      }
    };

    if (!acquireFetchSlot()) {
      return;
    }

    if (!user) {
      initialDashboardLoadCountRef.current = 0;
      manualDashboardRefreshCountRef.current = 0;
      backgroundDashboardRefreshCountRef.current = 0;
      if (shouldIgnore()) return;
      setGuardianSeniorProfiles([]);
      setGuardianDevicePositions([]);
      setGuardianDeviceAlarms([]);
      setDashboardDevices([]);
      setDashboardError(null);
      setDashboardLoading(false);
      setRefreshing(false);
      return;
    }

    if (shouldIgnore()) {
      releaseFetchSlot();
      return;
    }
    if (isManualRefresh) setRefreshing(true);
    else if (shouldShowLoader) setDashboardLoading(true);
    setDashboardError(null);

    if (user.role === GUARDIAN_ROLE) {
      try {
        const res = await getGuardianDashboard(user.user_id);
        if (shouldIgnore()) return;
        const rows = Array.isArray(res.seniorProfilesDTO) ? res.seniorProfilesDTO : [];
        const positions = Array.isArray(res.seniorDevicePositions?.devicePositionEventDTOs)
          ? res.seniorDevicePositions?.devicePositionEventDTOs
          : [];
        const alarms = Array.isArray(res.seniorDeviceAlarms?.deviceAlarmEventDTOs)
          ? res.seniorDeviceAlarms?.deviceAlarmEventDTOs
          : [];
        setGuardianSeniorProfiles(rows);
        setGuardianDevicePositions(positions);
        setGuardianDeviceAlarms(alarms);
      } catch (e) {
        if (shouldIgnore()) return;
        if (!shouldPreserveExistingData) {
          setGuardianSeniorProfiles([]);
          setGuardianDevicePositions([]);
          setGuardianDeviceAlarms([]);
        }
        setDashboardError(e instanceof Error ? e.message : 'Guardian dashboard request failed.');
      } finally {
        releaseFetchSlot();
      }
      return;
    }

    // Caretaker or Senior
    if (!seniorId) {
      setDashboardDevices([]);
      setDashboardError(null);
      releaseFetchSlot();
      return;
    }

    try {
      const res = await getSeniorDashboard(seniorId);
      if (shouldIgnore()) return;
      const list = Array.isArray(res.deviceStatusEventDTOs) ? res.deviceStatusEventDTOs : [];
      setDashboardDevices(list);
    } catch (e) {
      if (shouldIgnore()) return;
      if (!shouldPreserveExistingData) {
        setDashboardDevices([]);
      }
      setDashboardError(e instanceof Error ? e.message : 'Dashboard request failed.');
    } finally {
      releaseFetchSlot();
    }
  }, [seniorId, user, getSeniorDashboard, getGuardianDashboard]);

  useFocusEffect(
    useCallback(() => {
      void fetchDashboardData('initial');
      const intervalId = setInterval(() => {
        void fetchDashboardData('background');
      }, DASHBOARD_AUTO_REFRESH_MS);
      return () => clearInterval(intervalId);
    }, [fetchDashboardData])
  );

  useEffect(() => {
    if (!user || user.role !== GUARDIAN_ROLE) {
      return;
    }
    if (guardianSeniorProfiles.length === 0) {
      setDashboardDevices([]);
      return;
    }
    const idx = guardianProfileIndex(guardianSeniorProfiles, seniorId);
    const row = guardianSeniorProfiles[idx];
    const baseList = Array.isArray(row?.deviceStatusEventDTOs) ? row.deviceStatusEventDTOs : [];
    const list = mergeGuardianDeviceStatusWithPosition(baseList, guardianDevicePositions, guardianDeviceAlarms);
    setDashboardDevices(list);
  }, [user, guardianSeniorProfiles, guardianDevicePositions, guardianDeviceAlarms, seniorId]);

  // Find the specific device status record matching the parameter imei/ident
  const matchedDeviceRecord = useMemo(() => {
    if (dashboardDevices.length === 0) return null;
    return (
      dashboardDevices.find(
        d =>
          (typeof d.ident === 'string' && d.ident.toLowerCase() === imei?.toLowerCase()) ||
          (typeof d.imei === 'string' && d.imei.toLowerCase() === imei?.toLowerCase())
      ) || dashboardDevices[0]
    );
  }, [dashboardDevices, imei]);

  const pendantDeviceUuid = useMemo(() => {
    const routeValue = typeof routeDeviceUuid === 'string' ? routeDeviceUuid.trim() : '';
    if (routeValue) return routeValue;
    if (!matchedDeviceRecord) return '';
    return (
      readStringField(matchedDeviceRecord, 'device.uuid') ??
      readStringField(matchedDeviceRecord, 'deviceUUID') ??
      readStringField(matchedDeviceRecord, 'deviceUuid') ??
      ''
    );
  }, [matchedDeviceRecord, routeDeviceUuid]);

  const liveSnapshot = useMemo(() => {
    if (matchedDeviceRecord) {
      return mapSeniorDashboardDeviceToSnapshot(matchedDeviceRecord);
    }
    return emptySeniorHomeSnapshot();
  }, [matchedDeviceRecord]);

  const hasLiveCoordinates =
    liveSnapshot.latitude != null &&
    liveSnapshot.longitude != null &&
    !Number.isNaN(liveSnapshot.latitude) &&
    !Number.isNaN(liveSnapshot.longitude);

  const batteryIconName = useMemo(() => {
    if (liveSnapshot.charging === true) {
      return 'battery-charging' as const;
    }
    if (liveSnapshot.batteryPercent == null || Number.isNaN(liveSnapshot.batteryPercent)) {
      return 'battery-dead-outline' as const;
    }
    const p = liveSnapshot.batteryPercent;
    if (p > 75) return 'battery-full' as const;
    if (p > 30) return 'battery-half' as const;
    return 'battery-dead-outline' as const;
  }, [liveSnapshot.batteryPercent, liveSnapshot.charging]);

  const speedAndUpdatedLine = useMemo(() => {
    const speedPart =
      liveSnapshot.speedKph != null && !Number.isNaN(liveSnapshot.speedKph)
        ? `${Math.round(liveSnapshot.speedKph)} km/h`
        : NA;
    const updatedPart = liveSnapshot.locationUpdatedLabel ?? liveSnapshot.lastUpdatedLabel;
    return joinDisplayParts(speedPart, updatedPart);
  }, [liveSnapshot.locationUpdatedLabel, liveSnapshot.lastUpdatedLabel, liveSnapshot.speedKph]);

  const batteryStatusLine = useMemo(() => {
    return joinDisplayParts(chargingCaption(liveSnapshot.charging), liveSnapshot.batteryUpdatedLabel);
  }, [liveSnapshot.batteryUpdatedLabel, liveSnapshot.charging]);

  const fixQualityLine = useMemo(() => {
    if (
      liveSnapshot.hdop != null &&
      liveSnapshot.satellites != null &&
      !Number.isNaN(liveSnapshot.hdop) &&
      !Number.isNaN(liveSnapshot.satellites)
    ) {
      return `HDOP ${liveSnapshot.hdop} · ${liveSnapshot.satellites} satellites`;
    }
    return NA;
  }, [liveSnapshot.hdop, liveSnapshot.satellites]);

  const hasSosData =
    !!matchedDeviceRecord &&
    hasAnyOwnField(matchedDeviceRecord, ['alarmPanicStart', 'alarmPanicStop']);

  const hasFallAlarmData =
    !!matchedDeviceRecord &&
    hasAnyOwnField(matchedDeviceRecord, [
      'fallAlarmStart',
      'fallAlarmStop',
      'fallAlarmStatus',
      'fall.alarm.status',
    ]);

  const hasAlertHistoryData =
    !!matchedDeviceRecord &&
    hasAnyOwnField(matchedDeviceRecord, [
      'alarm.server.timestamp',
      'alarm.timestamp',
      'alarmPanicStart',
      'alarmPanicStop',
      'fallAlarmStart',
      'fallAlarmStop',
    ]);

  const sosAnalysis = useMemo(() => {
    if (!matchedDeviceRecord) return { label: 'Unknown', detail: 'Waiting for device', active: false };
    const panic = matchedDeviceRecord.alarmPanicStart === true;
    if (panic) {
      return { label: 'SOS Triggered', detail: 'Panic button pressed!', active: true };
    }
    return { label: 'Safe', detail: 'No active SOS', active: false };
  }, [matchedDeviceRecord]);

  const alarmAnalysis = useMemo(() => {
    if (!matchedDeviceRecord) return { label: 'Unknown', active: false };
    const fall = matchedDeviceRecord.fallAlarmStart === true || matchedDeviceRecord.fallAlarmStatus === true || matchedDeviceRecord['fall.alarm.status'] === true;
    if (fall) {
      return { label: 'Fall Detected', active: true };
    }
    return { label: 'Normal', active: false };
  }, [matchedDeviceRecord]);

  const geofenceStatus = useMemo(
    () => getDashboardGeofenceStatus(matchedDeviceRecord),
    [matchedDeviceRecord],
  );

  const openLastPositionMap = useCallback(() => {
    const lat = liveSnapshot.latitude;
    const lon = liveSnapshot.longitude;
    if (lat == null || lon == null) return;
    navigation.navigate('LocationMap', {
      latitude: lat,
      longitude: lon,
      title: 'Last position',
      deviceUuid: pendantDeviceUuid,
    });
  }, [
    pendantDeviceUuid,
    liveSnapshot.latitude,
    liveSnapshot.longitude,
    navigation,
  ]);

  const locationThumb = {
    uri: 'https://images.unsplash.com/photo-1524661135-423995f22d0f?auto=format&fit=crop&w=600&q=80',
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{deviceName || 'Pendant Details'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void fetchDashboardData('manual');
            }}
            colors={['#FF9500']}
            tintColor="#FF9500"
          />
        }
      >
        {dashboardLoading && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#FF9500" />
            <Text style={styles.loadingText}>Fetching real-time status...</Text>
          </View>
        )}

        {dashboardError && (
          <View style={styles.errorWrap}>
            <Icon name="alert-circle-outline" size={32} color="#EF4444" />
            <Text style={styles.errorText}>{dashboardError}</Text>
          </View>
        )}

        {!dashboardLoading && matchedDeviceRecord ? (
          <>
            {/* Live Map Coordinates Card */}
            <View style={styles.weatherCard}>
              <View style={styles.weatherLeft}>
                <View style={styles.weatherHeader}>
                  <Icon name="location" size={18} color="#FF9500" />
                  <Text style={styles.weatherLocation}>Last known position</Text>
                </View>
                <View style={styles.coordBlock}>
                  <Text style={styles.coordLabel}>Latitude</Text>
                  <Text style={[styles.coordValue, styles.coordValueLat]} selectable>
                    {displayDeg(liveSnapshot.latitude)}
                  </Text>
                  <Text style={[styles.coordLabel, styles.coordLabelLon]}>Longitude</Text>
                  <Text style={[styles.coordValue, styles.coordValueLon]} selectable>
                    {displayDeg(liveSnapshot.longitude)}
                  </Text>
                </View>
                <Text style={styles.weatherRangeTight}>{speedAndUpdatedLine}</Text>
                <Text style={styles.weatherRange}>{displayStr(liveSnapshot.networkLabel)}</Text>
                <TouchableOpacity
                  style={[styles.mapButton, !hasLiveCoordinates && styles.mapButtonDisabled]}
                  onPress={openLastPositionMap}
                  activeOpacity={0.85}
                  disabled={!hasLiveCoordinates}
                >
                  <Icon name="map-outline" size={18} color={hasLiveCoordinates ? '#FF9500' : '#C7C1BA'} />
                  <View style={styles.mapButtonTextCol}>
                    <Text style={[styles.mapButtonTitle, !hasLiveCoordinates && styles.mapButtonTitleDisabled]}>
                      View on map
                    </Text>
                    <Text style={styles.mapButtonSubtitle}>
                      {hasLiveCoordinates ? `${MAP_PROVIDER_NAME} · marker at this point` : NA}
                    </Text>
                  </View>
                  <Icon name="chevron-forward" size={18} color="#C7C1BA" />
                </TouchableOpacity>
              </View>
              <Image source={locationThumb} style={styles.weatherImage} />
            </View>

            {/* Geofence status from the dashboard device DTO */}
            <View
              style={[
                styles.dashboardGeofenceCard,
                geofenceStatus.hasActiveAlarm
                  ? styles.dashboardGeofenceCardAlarm
                  : null,
              ]}
            >
              <View style={styles.dashboardGeofenceHeader}>
                <View
                  style={[
                    styles.dashboardGeofenceIcon,
                    geofenceStatus.hasActiveAlarm
                      ? styles.dashboardGeofenceIconAlarm
                      : null,
                  ]}
                >
                  <Icon
                    name={
                      geofenceStatus.hasActiveAlarm
                        ? 'warning'
                        : 'location-outline'
                    }
                    size={21}
                    color={
                      geofenceStatus.hasActiveAlarm ? '#FFFFFF' : '#B45309'
                    }
                  />
                </View>
                <View style={styles.dashboardGeofenceTitleCol}>
                  <Text style={styles.dashboardGeofenceTitle}>
                    Geofence alarm status
                  </Text>
                  <Text style={styles.dashboardGeofenceSubtitle}>
                    Latest pendant dashboard event
                  </Text>
                </View>
                <View
                  style={[
                    styles.dashboardGeofenceBadge,
                    geofenceStatus.hasActiveAlarm
                      ? styles.dashboardGeofenceBadgeAlarm
                      : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.dashboardGeofenceBadgeText,
                      geofenceStatus.hasActiveAlarm
                        ? styles.dashboardGeofenceBadgeTextAlarm
                        : null,
                    ]}
                  >
                    {geofenceStatus.summary}
                  </Text>
                </View>
              </View>

              <View style={styles.dashboardGeofenceAlarmRow}>
                {[geofenceStatus.alarm1, geofenceStatus.alarm2].map(
                  (value, index) => (
                    <View
                      key={`geofence-alarm-${index + 1}`}
                      style={styles.dashboardGeofenceAlarmItem}
                    >
                      <Text style={styles.dashboardGeofenceItemLabel}>
                        Alarm {index + 1}
                      </Text>
                      <Text
                        style={[
                          styles.dashboardGeofenceItemValue,
                          value === true
                            ? styles.dashboardGeofenceItemValueAlarm
                            : null,
                        ]}
                      >
                        {formatDashboardGeofenceValue(
                          value,
                          'Triggered',
                          'Clear',
                        )}
                      </Text>
                    </View>
                  ),
                )}
              </View>

              <View style={styles.dashboardGeofenceZones}>
                {geofenceStatus.statuses.map((value, index) => (
                  <View
                    key={`geofence-status-${index + 1}`}
                    style={[
                      styles.dashboardGeofenceZone,
                      value === true
                        ? styles.dashboardGeofenceZoneActive
                        : null,
                    ]}
                  >
                    <Text style={styles.dashboardGeofenceZoneLabel}>
                      Status {index + 1}
                    </Text>
                    <Text style={styles.dashboardGeofenceZoneValue}>
                      {formatDashboardGeofenceValue(
                        value,
                        'Active',
                        'Inactive',
                      )}
                    </Text>
                  </View>
                ))}
              </View>

              {!geofenceStatus.hasData ? (
                <Text style={styles.dashboardGeofenceUnavailable}>
                  Geofence fields were not included in the latest dashboard
                  response.
                </Text>
              ) : null}
            </View>

            {/* Active Emergency Banner */}
            {(liveSnapshot.alarmSeverity === 'critical' || liveSnapshot.alarmSeverity === 'warning') ? (
              <View style={styles.emergencyBanner}>
                <View style={styles.emergencyIconWrap}>
                  <Icon name="warning" size={24} color="#FFFFFF" />
                </View>
                <View style={styles.emergencyTextCol}>
                  <Text style={styles.emergencyTitle} numberOfLines={1}>ALERT: {displayStr(liveSnapshot.primaryAlarmLabel)}</Text>
                  <Text style={styles.emergencySubtitle}>{displayStr(liveSnapshot.alarmDetail)}</Text>
                </View>
              </View>
            ) : null}

            {/* Live Context Section */}
            <View style={styles.sectionHeaderWrap}>
              <Text style={styles.sectionTitle}>Live context</Text>
            </View>

            <View style={styles.vitalGrid}>
              {/* Battery Status */}
              <LinearGradient
                colors={
                  liveSnapshot.batteryPercent != null && liveSnapshot.batteryPercent <= 20
                    ? ['#EF4444', '#B91C1C']
                    : ['#F59E0B', '#B45309']
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.vitalTile}
              >
                <Icon name={batteryIconName} size={28} color="#FFFFFF" style={styles.vitalIcon} />
                <View style={styles.vitalTextCol}>
                  <Text style={styles.vitalTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>Battery</Text>
                  <Text style={styles.vitalValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{displayBatteryPct(liveSnapshot.batteryPercent)}</Text>
                  <Text style={styles.vitalSubtitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{batteryStatusLine}</Text>
                </View>
              </LinearGradient>

              {/* SOS Panic Button */}
              {hasSosData ? (
                <LinearGradient
                  colors={sosAnalysis.active ? ['#DC2626', '#991B1B'] : ['#059669', '#047857']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.vitalTile}
                >
                  <Icon name="medkit" size={28} color="#FFFFFF" style={styles.vitalIcon} />
                  <View style={styles.vitalTextCol}>
                    <Text style={styles.vitalTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>SOS Panic Button</Text>
                    <Text style={styles.vitalValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{sosAnalysis.label}</Text>
                    <Text style={styles.vitalSubtitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{sosAnalysis.detail}</Text>
                  </View>
                </LinearGradient>
              ) : null}

              {/* Device Alarms */}
              {hasFallAlarmData ? (
                <LinearGradient
                  colors={alarmAnalysis.active ? ['#F97316', '#C2410C'] : ['#0891B2', '#164E63']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.vitalTile}
                >
                  <Icon name="warning" size={28} color="#FFFFFF" style={styles.vitalIcon} />
                  <View style={styles.vitalTextCol}>
                    <Text style={styles.vitalTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>Device Alarms</Text>
                    <Text style={styles.vitalValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{alarmAnalysis.label}</Text>
                    <Text style={styles.vitalSubtitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{alarmAnalysis.active ? 'Check immediately' : 'Sensors clear'}</Text>
                  </View>
                </LinearGradient>
              ) : null}

            </View>

            {/* Alert History Section */}
            {hasAlertHistoryData && liveSnapshot.lastAlarmKind && liveSnapshot.lastAlarmKind !== NA ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderWrap}>
                  <Text style={styles.sectionTitle}>Alert History</Text>
                </View>
                <View style={styles.alarmHistoryCard}>
                  <View style={styles.alarmHistoryHeader}>
                    <View style={styles.alarmHistoryIconBox}>
                      <Icon name="alert-circle" size={26} color="#DC2626" />
                    </View>
                    <View style={styles.alarmHistoryTitleCol}>
                      <Text style={styles.alarmHistoryKind}>{displayStr(liveSnapshot.lastAlarmKind)}</Text>
                      <Text style={styles.alarmHistoryTime}>{displayStr(liveSnapshot.lastAlarmAt)}</Text>
                    </View>
                  </View>
                  <View style={styles.alarmHistoryBody}>
                     <Text style={styles.alarmHistoryDesc}>This event was automatically logged by the device. Please verify the senior's safety if required.</Text>
                  </View>
                </View>
              </View>
            ) : null}

            {/* Technical Status Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderWrap}>
                <Text style={styles.sectionTitle}>Technical status</Text>
              </View>
              <View style={styles.timeCard}>
                <View style={styles.timeRow}>
                  <View style={[styles.timeSlot, styles.timeSlotGreen]}>
                    <Text style={styles.timeSlotTitle}>Signal & network</Text>
                    <Text style={styles.timeSlotValue}>{displayStr(liveSnapshot.networkLabel)}</Text>
                  </View>
                  <View style={[styles.timeSlot, styles.timeSlotPeach]}>
                    <Text style={styles.timeSlotTitle}>Fix quality</Text>
                    <Text style={styles.timeSlotValue}>{fixQualityLine}</Text>
                  </View>
                </View>
              </View>
            </View>
          </>
        ) : !dashboardLoading && (
          <View style={styles.errorWrap}>
            <Icon name="alert-circle-outline" size={32} color="#EF4444" />
            <Text style={styles.errorText}>No status details found for this pendant.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F2EE',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E2DA',
  },
  backBtn: {
    padding: 4,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  headerSpacer: {
    width: 32,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  loadingWrap: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  errorWrap: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    marginTop: 8,
    fontSize: 14,
    color: '#EF4444',
    textAlign: 'center',
  },
  weatherCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  weatherLeft: {
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  weatherHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  weatherLocation: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
  },
  coordBlock: {
    marginBottom: 6,
  },
  coordLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8A827A',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  coordLabelLon: {
    marginTop: 8,
  },
  coordValue: {
    fontSize: 17,
    fontWeight: '700',
    color: '#333',
    fontVariant: ['tabular-nums'],
  },
  coordValueLat: {
    color: '#FF9500',
  },
  coordValueLon: {
    color: '#333',
  },
  weatherRangeTight: {
    fontSize: 12,
    color: '#666',
    marginTop: 6,
  },
  weatherRange: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  weatherImage: {
    width: 90,
    height: 60,
    borderRadius: 12,
    marginLeft: 8,
    marginTop: 28,
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#FFF8F0',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FFD4A8',
  },
  mapButtonDisabled: {
    backgroundColor: '#F3F0EC',
    borderColor: '#E8E2DA',
  },
  mapButtonTextCol: {
    flex: 1,
    marginLeft: 10,
    minWidth: 0,
  },
  mapButtonTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  mapButtonTitleDisabled: {
    color: '#9A938C',
  },
  mapButtonSubtitle: {
    fontSize: 11,
    color: '#8A7565',
    marginTop: 2,
  },
  dashboardGeofenceCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F3D4A5',
    backgroundColor: '#FFFBEB',
  },
  dashboardGeofenceCardAlarm: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  dashboardGeofenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dashboardGeofenceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF3C7',
  },
  dashboardGeofenceIconAlarm: {
    backgroundColor: '#DC2626',
  },
  dashboardGeofenceTitleCol: {
    flex: 1,
    minWidth: 0,
    marginLeft: 11,
  },
  dashboardGeofenceTitle: {
    color: '#493A2D',
    fontSize: 15,
    fontWeight: '800',
  },
  dashboardGeofenceSubtitle: {
    marginTop: 2,
    color: '#8A7565',
    fontSize: 10,
  },
  dashboardGeofenceBadge: {
    maxWidth: 106,
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
  },
  dashboardGeofenceBadgeAlarm: {
    backgroundColor: '#FEE2E2',
  },
  dashboardGeofenceBadgeText: {
    color: '#92400E',
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
  },
  dashboardGeofenceBadgeTextAlarm: {
    color: '#991B1B',
  },
  dashboardGeofenceAlarmRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  dashboardGeofenceAlarmItem: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  dashboardGeofenceItemLabel: {
    color: '#8A7565',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  dashboardGeofenceItemValue: {
    marginTop: 4,
    color: '#4B5563',
    fontSize: 12,
    fontWeight: '800',
  },
  dashboardGeofenceItemValueAlarm: {
    color: '#DC2626',
  },
  dashboardGeofenceZones: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 10,
  },
  dashboardGeofenceZone: {
    width: '48%',
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 9,
    backgroundColor: '#F5F0E9',
  },
  dashboardGeofenceZoneActive: {
    backgroundColor: '#DCFCE7',
  },
  dashboardGeofenceZoneLabel: {
    color: '#8A7565',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  dashboardGeofenceZoneValue: {
    marginTop: 2,
    color: '#4B5563',
    fontSize: 11,
    fontWeight: '700',
  },
  dashboardGeofenceUnavailable: {
    marginTop: 10,
    color: '#8A7565',
    fontSize: 11,
    lineHeight: 15,
  },
  emergencyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EF4444',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 14,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  emergencyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  emergencyTextCol: {
    flex: 1,
  },
  emergencyTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emergencySubtitle: {
    color: '#FEE2E2',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  sectionHeaderWrap: {
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginHorizontal: 16,
    marginBottom: 12,
  },
  vitalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: CARD_HORIZONTAL_MARGIN,
    marginBottom: 16,
    gap: CARD_GAP,
    paddingHorizontal: CARD_GAP / 2,
  },
  vitalTileFull: {
    width: GRID_AVAILABLE_WIDTH - CARD_GAP,
    minHeight: 100,
    borderRadius: 20,
    padding: 16,
    flexDirection: 'column',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
  vitalTile: {
    width: HALF_TILE_WIDTH,
    minHeight: 120,
    borderRadius: 20,
    padding: 16,
    paddingBottom: 20,
    flexDirection: 'column',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
  vitalIcon: {
    marginBottom: 8,
    opacity: 0.95,
  },
  vitalTextCol: {
    flex: 1,
  },
  vitalTitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  vitalValue: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  vitalSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
  },
  section: {
    marginTop: 8,
  },
  alarmHistoryCard: {
    backgroundColor: '#FEF2F2',
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  alarmHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  alarmHistoryIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  alarmHistoryTitleCol: {
    flex: 1,
  },
  alarmHistoryKind: {
    fontSize: 16,
    fontWeight: '700',
    color: '#991B1B',
    marginBottom: 2,
  },
  alarmHistoryTime: {
    fontSize: 13,
    color: '#B91C1C',
    fontWeight: '500',
  },
  alarmHistoryBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#FECACA',
    paddingTop: 12,
  },
  alarmHistoryDesc: {
    fontSize: 13,
    color: '#7F1D1D',
    lineHeight: 18,
  },
  timeCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  timeRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  timeSlot: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    marginHorizontal: 4,
  },
  timeSlotGreen: {
    backgroundColor: '#E9F3E5',
  },
  timeSlotPeach: {
    backgroundColor: '#F9EEE1',
  },
  timeSlotTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4E4A44',
    marginBottom: 6,
  },
  timeSlotValue: {
    fontSize: 12,
    color: '#6E655D',
  },
});

export default PendantDetailScreen;
