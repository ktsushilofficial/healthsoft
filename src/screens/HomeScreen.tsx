// src/screens/HomeScreen.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  ImageBackground,
  TouchableOpacity,
  Modal,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { useAuth } from '../context/AuthContext';
import SeniorSelectionModal from '../components/SeniorSelectionModal';
import GuardianWelcomeModal from '../components/GuardianWelcomeModal';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { emptySeniorHomeSnapshot } from '../types/seniorHomeSnapshot';
import { buildOpenStreetMapMarkerUrl } from '../utils/openStreetMap';
import type { SeniorDashboardDeviceRecord } from '../types/seniorDashboard';
import type { GuardianSeniorProfileRow } from '../types/guardianDashboard';
import {
  getSeniorDashboardDeviceLabel,
  mapSeniorDashboardDeviceToSnapshot,
} from '../utils/mapSeniorDashboardDeviceToSnapshot';
import { isMacAddressLike } from '../utils/deviceAssignments';
import type { SeniorHomeSnapshot } from '../types/seniorHomeSnapshot';

const HERO_IMAGES = [
  { uri: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80' },
  { uri: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80' },
  { uri: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=80' },
  { uri: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?auto=format&fit=crop&w=1200&q=80' },
  { uri: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&w=1200&q=80' },
];

const SENIOR_ROLE = 'SENIOR';
const CARETAKER_ROLE = 'CARE_TAKER';
const GUARDIAN_ROLE = 'GUARDIAN';
const NA = 'NA';
const DASHBOARD_AUTO_REFRESH_MS = 30_000;

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

function capitalizeWord(s: string) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function buildGreetingName(firstName: string, lastName: string, fallbackEmail?: string) {
  const fn = capitalizeWord((firstName || '').trim());
  const ln = (lastName || '').trim();
  if (fn || ln) {
    return fn ? `${fn}${ln ? ` ${ln}` : ''}!` : `${capitalizeWord(ln)}!`;
  }

  const emailLocal = (fallbackEmail || '').split('@')[0]?.replace(/[._]+/g, ' ').trim();
  if (emailLocal) {
    const firstToken = emailLocal.split(/\s+/)[0] || emailLocal;
    return `${capitalizeWord(firstToken)}!`;
  }

  return 'Welcome!';
}

function buildDisplayName(firstName: string, lastName: string, fallbackEmail?: string) {
  const fn = capitalizeWord((firstName || '').trim());
  const ln = capitalizeWord((lastName || '').trim());
  const fullName = [fn, ln].filter(Boolean).join(' ').trim();
  if (fullName) {
    return fullName;
  }

  const emailLocal = (fallbackEmail || '').split('@')[0]?.replace(/[._]+/g, ' ').trim();
  if (emailLocal) {
    return emailLocal
      .split(/\s+/)
      .filter(Boolean)
      .map(capitalizeWord)
      .join(' ');
  }

  return 'Guardian';
}

/** Same index rule as device list: match selected senior’s userId, else first profile. */
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

function readBooleanField(record: SeniorDashboardDeviceRecord, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
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

function getGreetingFromDate(date: Date) {
  const h = date.getHours();
  if (h >= 5 && h < 12) {
    return { title: 'Good morning', icon: 'sunny' as const, iconColor: '#F4C24D' };
  }
  if (h >= 12 && h < 17) {
    return { title: 'Good afternoon', icon: 'sunny' as const, iconColor: '#FFB347' };
  }
  if (h >= 17 && h < 21) {
    return {
      title: 'Good evening',
      icon: 'partly-sunny' as const,
      iconColor: '#FF9F1C',
    };
  }
  return { title: 'Good night', icon: 'moon' as const, iconColor: '#C5D4EB' };
}

type VitalsSummaryRow = {
  recordDate: string;
  steps: number | null;
  hrAvg: number | null;
  spo2Avg: number | null;
  tempAvg: number | null;
  systolicBpAvg: number | null;
  diastolicBpAvg: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeRecordDateKey(value: string): string | null {
  const match = value.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function normalizeSummaryRows(payload: unknown): VitalsSummaryRow[] {
  const root = asRecord(payload);
  const candidates: unknown[] =
    Array.isArray(payload)
      ? payload
      : Array.isArray(root?.vitalSummaries)
        ? root?.vitalSummaries
        : Array.isArray(root?.summaries)
          ? root?.summaries
          : Array.isArray(root?.data)
            ? root?.data
            : Array.isArray(asRecord(root?.data)?.vitalSummaries)
              ? (asRecord(root?.data)?.vitalSummaries as unknown[])
              : [];

  return candidates
    .map(item => {
      const row = asRecord(item);
      if (!row) return null;
      const recordDate = asString(row.recordDate) ?? asString(row.date);
      if (!recordDate) return null;
      return {
        recordDate,
        steps: asNumber(row.steps),
        hrAvg: asNumber(row.hrAvg) ?? asNumber(row.heartRateAvg),
        spo2Avg: asNumber(row.spo2Avg),
        tempAvg: asNumber(row.tempAvg) ?? asNumber(row.temperatureAvgC),
        systolicBpAvg: asNumber(row.systolicBpAvg),
        diastolicBpAvg: asNumber(row.diastolicBpAvg),
      };
    })
    .filter((row): row is VitalsSummaryRow => row !== null)
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate));
}

function findTodaySummaryRow(rows: VitalsSummaryRow[]): VitalsSummaryRow | null {
  const todayKey = localDateKey(new Date());
  return rows.find(row => normalizeRecordDateKey(row.recordDate) === todayKey) ?? null;
}

function formatHomeSteps(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return NA;
  const rounded = Math.round(value);
  return rounded >= 1000 ? `${(rounded / 1000).toFixed(1)}k` : `${rounded}`;
}

function formatHomeMetric(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return NA;
  return `${Math.round(value)}`;
}

function formatHomeBp(row: VitalsSummaryRow | null): string {
  if (
    row?.systolicBpAvg == null ||
    row?.diastolicBpAvg == null ||
    Number.isNaN(row.systolicBpAvg) ||
    Number.isNaN(row.diastolicBpAvg)
  ) {
    return NA;
  }
  return `${Math.round(row.systolicBpAvg)}/${Math.round(row.diastolicBpAvg)}`;
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

function formatDashboardBattery(snapshot: SeniorHomeSnapshot): string {
  return formatBatteryPercent(snapshot.batteryPercent);
}

const HomeScreen = () => {
  const navigation = useNavigation<any>();
  const {
    user,
    selectedSenior,
    seniors,
    selectSenior,
    getMySeniors,
    isCaretaker,
    getSeniorDashboard,
    getGuardianDashboard,
    selectedSeniorHandBandMacs,
    getAssignedDevicesForSenior,
    getV8VitalsSummary,
  } = useAuth();
  const [modalVisible, setModalVisible] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);
  const [nowTick, setNowTick] = useState(() => new Date());
  const [dashboardDevices, setDashboardDevices] = useState<SeniorDashboardDeviceRecord[]>([]);
  const [selectedDeviceIndex, setSelectedDeviceIndex] = useState(0);
  const [devicePickerVisible, setDevicePickerVisible] = useState(false);
  const [todayVitals, setTodayVitals] = useState<VitalsSummaryRow | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [guardianSeniorProfiles, setGuardianSeniorProfiles] = useState<GuardianSeniorProfileRow[]>([]);
  const [guardianDevicePositions, setGuardianDevicePositions] = useState<SeniorDashboardDeviceRecord[]>([]);
  const [guardianDeviceAlarms, setGuardianDeviceAlarms] = useState<SeniorDashboardDeviceRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [guardianWelcomeVisible, setGuardianWelcomeVisible] = useState(false);
  const shownGuardianWelcomeForUser = useRef<string | null>(null);
  const pendingSeniorPickerOpenRef = useRef(false);
  const pendingGuardianSelectionPromptRef = useRef(false);
  const isMountedRef = useRef(true);
  const dashboardRequestIdRef = useRef(0);
  const lastLoadedDashboardContextKeyRef = useRef<string>('');
  const initialDashboardLoadCountRef = useRef(0);
  const manualDashboardRefreshCountRef = useRef(0);
  const backgroundDashboardRefreshCountRef = useRef(0);
  const vitalsRequestIdRef = useRef(0);

  /** Senior id for `/api/v1/senior-dashboard/{id}` — logged-in senior, caretaker's or guardian's selected senior. */
  const activeDashboardSeniorId = useMemo(() => {
    if (!user) return null;
    if (user.role === SENIOR_ROLE) return user.user_id;
    if (user.role === CARETAKER_ROLE && selectedSenior?.userId) return selectedSenior.userId;
    if (user.role === GUARDIAN_ROLE && selectedSenior?.userId) return selectedSenior.userId;
    return null;
  }, [user, selectedSenior?.userId]);

  const showTelemetryBar = useMemo(() => {
    if (!user) return false;
    if (user.role === SENIOR_ROLE) return true;
    if (user.role === GUARDIAN_ROLE) return true;
    if (user.role === CARETAKER_ROLE && selectedSenior?.userId) return true;
    return false;
  }, [user, selectedSenior?.userId]);

  const showLocationCard = !!user && user.role !== SENIOR_ROLE;

  const dashboardContextKey = useMemo(() => {
    if (!user) return 'anonymous';
    if (user.role === GUARDIAN_ROLE) {
      return `${user.role}:${user.user_id}`;
    }
    if (user.role === CARETAKER_ROLE) {
      return `${user.role}:${user.user_id}:${activeDashboardSeniorId ?? ''}`;
    }
    return `${user.role}:${user.user_id}`;
  }, [activeDashboardSeniorId, user, user?.role, user?.user_id]);

  const guardianWelcomeName = useMemo(() => {
    if (!user || user.role !== GUARDIAN_ROLE) {
      return '';
    }
    return buildDisplayName(user.first_name, user.last_name, user.email);
  }, [user]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
  }, []);

  useEffect(() => {
    setDevicePickerVisible(false);
    setSelectedDeviceIndex(0);
  }, [activeDashboardSeniorId, user?.role, selectedSenior?.userId]);

  const loadV8VitalsForToday = useCallback(async () => {
    const requestId = ++vitalsRequestIdRef.current;
    const shouldIgnore = () =>
      !isMountedRef.current || vitalsRequestIdRef.current !== requestId;
    const targetSeniorId = activeDashboardSeniorId || (user?.role === SENIOR_ROLE ? user.user_id : null);
    if (!targetSeniorId) {
      setTodayVitals(null);
      return;
    }
    try {
      const assigned = await getAssignedDevicesForSenior(targetSeniorId);
      const handBandAssignment = assigned.find(
        device => !!device.deviceId && isMacAddressLike(device.deviceIdentifier)
      );
      const deviceUUID = handBandAssignment?.deviceId?.trim() ?? '';
      if (!deviceUUID) {
        if (shouldIgnore()) return;
        setTodayVitals(null);
        return;
      }
      const payload = await getV8VitalsSummary(deviceUUID, 1);
      const normalizedRows = normalizeSummaryRows(payload);
      if (shouldIgnore()) return;
      setTodayVitals(findTodaySummaryRow(normalizedRows));
    } catch (err) {
      if (shouldIgnore()) return;
      console.log('[HomeScreen] Failed to fetch V8 vitals summary for today:', err);
      setTodayVitals(null);
    }
  }, [activeDashboardSeniorId, user, getAssignedDevicesForSenior, getV8VitalsSummary]);

  useEffect(() => {
    loadV8VitalsForToday();
  }, [loadV8VitalsForToday]);

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
      lastLoadedDashboardContextKeyRef.current = '';
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
        lastLoadedDashboardContextKeyRef.current = dashboardContextKey;
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
        if (shouldIgnore()) return;
      }
      return;
    }

    if (shouldIgnore()) {
      releaseFetchSlot();
      return;
    }
    setGuardianSeniorProfiles([]);
    setGuardianDevicePositions([]);
    setGuardianDeviceAlarms([]);

    if (user.role === SENIOR_ROLE) {
      try {
        const res = await getSeniorDashboard(user.user_id);
        if (shouldIgnore()) return;
        const list = Array.isArray(res.deviceStatusEventDTOs) ? res.deviceStatusEventDTOs : [];
        setDashboardDevices(list);
        setSelectedDeviceIndex(prev => (list.length > 0 ? Math.min(prev, list.length - 1) : 0));
        lastLoadedDashboardContextKeyRef.current = dashboardContextKey;
      } catch (e) {
        if (shouldIgnore()) return;
        if (!shouldPreserveExistingData) {
          setDashboardDevices([]);
        }
        setDashboardError(e instanceof Error ? e.message : 'Dashboard request failed.');
      } finally {
        releaseFetchSlot();
        if (shouldIgnore()) return;
      }
      return;
    }

    if (user.role === CARETAKER_ROLE) {
      if (!selectedSenior?.userId) {
        if (shouldIgnore()) {
          releaseFetchSlot();
          return;
        }
        setDashboardDevices([]);
        setDashboardError(null);
        releaseFetchSlot();
        return;
      }
      try {
        const res = await getSeniorDashboard(activeDashboardSeniorId!);
        if (shouldIgnore()) return;
        const list = Array.isArray(res.deviceStatusEventDTOs) ? res.deviceStatusEventDTOs : [];
        setDashboardDevices(list);
        setSelectedDeviceIndex(prev => (list.length > 0 ? Math.min(prev, list.length - 1) : 0));
        lastLoadedDashboardContextKeyRef.current = dashboardContextKey;
      } catch (e) {
        if (shouldIgnore()) return;
        if (!shouldPreserveExistingData) {
          setDashboardDevices([]);
        }
        setDashboardError(e instanceof Error ? e.message : 'Dashboard request failed.');
      } finally {
        releaseFetchSlot();
        if (shouldIgnore()) return;
      }
      return;
    }

    if (shouldIgnore()) {
      releaseFetchSlot();
      return;
    }
    setDashboardDevices([]);
    setDashboardError(null);
    releaseFetchSlot();
  }, [activeDashboardSeniorId, dashboardContextKey, user, user?.role, user?.user_id, getSeniorDashboard, getGuardianDashboard]);

  useFocusEffect(
    useCallback(() => {
      if (!showTelemetryBar) {
        return;
      }

      const initialMode =
        lastLoadedDashboardContextKeyRef.current === dashboardContextKey
          ? 'background'
          : 'initial';

      void fetchDashboardData(initialMode);

      const intervalId = setInterval(() => {
        void fetchDashboardData('background');
      }, DASHBOARD_AUTO_REFRESH_MS);

      return () => clearInterval(intervalId);
    }, [dashboardContextKey, fetchDashboardData, showTelemetryBar])
  );

  const openSeniorSelectionModal = useCallback(() => {
    if (!isCaretaker || seniors.length === 0) {
      return;
    }

    if (guardianWelcomeVisible) {
      pendingSeniorPickerOpenRef.current = true;
      setGuardianWelcomeVisible(false);
      return;
    }

    setModalVisible(true);
  }, [guardianWelcomeVisible, isCaretaker, seniors.length]);

  useEffect(() => {
    if (guardianWelcomeVisible) {
      return;
    }
    if (!pendingSeniorPickerOpenRef.current) {
      return;
    }
    pendingSeniorPickerOpenRef.current = false;
    if (isCaretaker && seniors.length > 0) {
      setModalVisible(true);
    }
  }, [guardianWelcomeVisible, isCaretaker, seniors.length]);

  useEffect(() => {
    if (!user || user.role !== GUARDIAN_ROLE) {
      setDashboardDevices([]);
      setSelectedDeviceIndex(0);
      return;
    }
    setDevicePickerVisible(false);
    if (guardianSeniorProfiles.length === 0) {
      setDashboardDevices([]);
      setSelectedDeviceIndex(0);
      return;
    }
    const idx = guardianProfileIndex(guardianSeniorProfiles, selectedSenior?.userId);
    const row = guardianSeniorProfiles[idx];
    const baseList = Array.isArray(row?.deviceStatusEventDTOs) ? row.deviceStatusEventDTOs : [];
    const list = mergeGuardianDeviceStatusWithPosition(baseList, guardianDevicePositions, guardianDeviceAlarms);
    setDashboardDevices(list);
    setSelectedDeviceIndex(prev => (list.length > 0 ? Math.min(prev, list.length - 1) : 0));
  }, [user, user?.role, guardianSeniorProfiles, guardianDevicePositions, guardianDeviceAlarms, selectedSenior?.userId]);

  const activeGuardianSeniorDetails = useMemo(() => {
    if (!user || user.role !== GUARDIAN_ROLE || guardianSeniorProfiles.length === 0) {
      return null;
    }
    const idx = guardianProfileIndex(guardianSeniorProfiles, selectedSenior?.userId);
    return guardianSeniorProfiles[idx]?.seniorDetailsDTO ?? null;
  }, [user, user?.role, guardianSeniorProfiles, selectedSenior?.userId]);

  /** Guardian UI: names and photo from dashboard DTO, with my-seniors fallback when needed. */
  const guardianSeniorDisplay = useMemo(() => {
    if (!user || user.role !== GUARDIAN_ROLE) {
      return null;
    }
    const dto = activeGuardianSeniorDetails;
    if (dto) {
      const fnDto = (dto.firstName || '').trim();
      const lnDto = (dto.lastName || '').trim();
      return {
        firstName: fnDto || (selectedSenior?.firstName || '').trim(),
        lastName: lnDto || (selectedSenior?.lastName || '').trim(),
        profileImageUrl: dto.profileImageUrl ?? selectedSenior?.profileImageUrl ?? null,
      };
    }
    if (selectedSenior) {
      return {
        firstName: (selectedSenior.firstName || '').trim(),
        lastName: (selectedSenior.lastName || '').trim(),
        profileImageUrl: selectedSenior.profileImageUrl ?? null,
      };
    }
    return null;
  }, [user, user?.role, activeGuardianSeniorDetails, selectedSenior]);

  const caretakerHeaderSenior = useMemo(() => {
    if (!user || !isCaretaker) {
      return { firstName: '', profileImageUrl: null as string | null | undefined };
    }
    if (user.role === GUARDIAN_ROLE) {
      const g = guardianSeniorDisplay;
      return {
        firstName: (g?.firstName || '').trim() || (selectedSenior?.firstName || '').trim(),
        profileImageUrl: g?.profileImageUrl ?? selectedSenior?.profileImageUrl,
      };
    }
    return {
      firstName: (selectedSenior?.firstName || '').trim(),
      profileImageUrl: selectedSenior?.profileImageUrl,
    };
  }, [user, isCaretaker, guardianSeniorDisplay, selectedSenior]);

  const caretakerHeaderInitials = useMemo(() => {
    if (!user || !isCaretaker) return '?';
    if (user.role === GUARDIAN_ROLE && guardianSeniorDisplay) {
      const fn = guardianSeniorDisplay.firstName?.[0] || '';
      const ln = guardianSeniorDisplay.lastName?.[0] || '';
      if (fn || ln) return `${fn.toUpperCase()}${ln.toUpperCase()}`;
    }
    if (selectedSenior) {
      return `${(selectedSenior.firstName?.[0] || '').toUpperCase()}${(selectedSenior.lastName?.[0] || '').toUpperCase()}`;
    }
    return '?';
  }, [user, isCaretaker, guardianSeniorDisplay, selectedSenior]);

  const headerShowsActiveSenior = useMemo(() => {
    if (!isCaretaker || !user) return false;
    if (selectedSenior) return true;
    if (user.role === GUARDIAN_ROLE && guardianSeniorDisplay) {
      return !!(guardianSeniorDisplay.firstName?.trim() || guardianSeniorDisplay.lastName?.trim());
    }
    return false;
  }, [isCaretaker, user, selectedSenior, guardianSeniorDisplay]);

  const liveSnapshot = useMemo(() => {
    if (dashboardDevices.length > 0) {
      const idx = Math.min(Math.max(0, selectedDeviceIndex), dashboardDevices.length - 1);
      return mapSeniorDashboardDeviceToSnapshot(dashboardDevices[idx]!);
    }
    return emptySeniorHomeSnapshot();
  }, [dashboardDevices, selectedDeviceIndex]);

  const selectedDeviceLabel = useMemo(() => {
    if (dashboardDevices.length === 0) return '';
    const idx = Math.min(Math.max(0, selectedDeviceIndex), dashboardDevices.length - 1);
    return getSeniorDashboardDeviceLabel(dashboardDevices[idx]!);
  }, [dashboardDevices, selectedDeviceIndex]);

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

  const safetyIconName = useMemo(() => {
    if (liveSnapshot.alarmSeverity === 'ok') {
      return 'shield-checkmark' as const;
    }
    if (liveSnapshot.alarmSeverity === 'na') {
      return 'help-circle-outline' as const;
    }
    return 'warning' as const;
  }, [liveSnapshot.alarmSeverity]);

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

  const locationThumb = {
    uri: 'https://images.unsplash.com/photo-1524661135-423995f22d0f?auto=format&fit=crop&w=600&q=80',
  };

  const activeDeviceRecord = useMemo(() => {
    if (dashboardDevices.length === 0) return null;
    const idx = Math.min(Math.max(0, selectedDeviceIndex), dashboardDevices.length - 1);
    return dashboardDevices[idx];
  }, [dashboardDevices, selectedDeviceIndex]);

  const hasSosData =
    !!activeDeviceRecord &&
    hasAnyOwnField(activeDeviceRecord, ['alarmPanicStart', 'alarmPanicStop']);

  const hasFallAlarmData =
    !!activeDeviceRecord &&
    hasAnyOwnField(activeDeviceRecord, [
      'fallAlarmStart',
      'fallAlarmStop',
      'fallAlarmStatus',
      'fall.alarm.status',
    ]);

  const hasAlertHistoryData =
    !!activeDeviceRecord &&
    hasAnyOwnField(activeDeviceRecord, [
      'alarm.server.timestamp',
      'alarm.timestamp',
      'alarmPanicStart',
      'alarmPanicStop',
      'fallAlarmStart',
      'fallAlarmStop',
    ]);

  const activityAnalysis = useMemo(() => {
    if (!activeDeviceRecord) return { label: 'Unknown', icon: 'help-outline', colors: ['#E2E8F0', '#CBD5E1'] };
    const moving = activeDeviceRecord.movementStatus ?? activeDeviceRecord['movement.status'] ?? false;
    const speed = liveSnapshot.speedKph;
    if (speed != null && speed > 5) {
      return { label: 'In Transit', icon: 'car-sport', colors: ['#8B5CF6', '#6D28D9'] };
    }
    if (moving) {
      return { label: 'Active', icon: 'walk', colors: ['#0EA5E9', '#0369A1'] };
    }
    return { label: 'Stationary', icon: 'body', colors: ['#10B981', '#047857'] };
  }, [activeDeviceRecord, liveSnapshot.speedKph]);

  const envAnalysis = useMemo(() => {
    if (!activeDeviceRecord) return { label: 'Unknown', icon: 'help-outline', colors: ['#E2E8F0', '#CBD5E1'] };
    const indoor = activeDeviceRecord.indoorStatus ?? activeDeviceRecord['indoor.status'] ?? false;
    const wifiHome = activeDeviceRecord.wifiHomeStatus ?? activeDeviceRecord['wifi.home.status'] ?? false;
    if (wifiHome) {
      return { label: 'At Home', icon: 'home', colors: ['#F59E0B', '#EA580C'] };
    }
    if (indoor) {
      return { label: 'Indoors', icon: 'business', colors: ['#F43F5E', '#E11D48'] };
    }
    return { label: 'Outdoors', icon: 'leaf', colors: ['#84CC16', '#65A30D'] };
  }, [activeDeviceRecord]);

  const sosAnalysis = useMemo(() => {
    if (!activeDeviceRecord) return { label: 'Unknown', detail: 'Waiting for device', active: false };
    const panic = activeDeviceRecord.alarmPanicStart === true;
    if (panic) {
      return { label: 'SOS Triggered', detail: 'Panic button pressed!', active: true };
    }
    return { label: 'Safe', detail: 'No active SOS', active: false };
  }, [activeDeviceRecord]);

  const alarmAnalysis = useMemo(() => {
    if (!activeDeviceRecord) return { label: 'Unknown', active: false };
    const fall = activeDeviceRecord.fallAlarmStart === true || activeDeviceRecord.fallAlarmStatus === true || activeDeviceRecord['fall.alarm.status'] === true;
    if (fall) {
      return { label: 'Fall Detected', active: true };
    }
    return { label: 'Normal', active: false };
  }, [activeDeviceRecord]);

  useFocusEffect(
    useCallback(() => {
      setNowTick(new Date());
      if (!isCaretaker) return;
      const checkSeniorSelection = async () => {
        try {
          await getMySeniors();
        } catch (e) {
          // ignore
        }
      };
      checkSeniorSelection();
    }, [getMySeniors, isCaretaker])
  );

  useEffect(() => {
    if (!isCaretaker) {
      setModalVisible(false);
      pendingGuardianSelectionPromptRef.current = false;
      return;
    }

    if (user?.role === GUARDIAN_ROLE && pendingGuardianSelectionPromptRef.current && seniors.length > 1) {
      if (guardianWelcomeVisible) {
        return;
      }
      pendingGuardianSelectionPromptRef.current = false;
      setModalVisible(true);
      return;
    }

    if (selectedSenior) {
      setModalVisible(false);
      return;
    }

    if (seniors.length === 1) {
      void selectSenior(seniors[0].userId)
        .then(() => setModalVisible(false))
        .catch(() => {
          // Keep the picker reachable when automatic selection fails.
          setModalVisible(true);
        });
      return;
    }

    setModalVisible(seniors.length > 1);
  }, [selectedSenior, seniors, isCaretaker, selectSenior, user?.role, guardianWelcomeVisible]);

  // Only rotate hero images and tick the clock while this screen is visible,
  // so we don't trigger re-renders when the user is on another tab.
  useFocusEffect(
    useCallback(() => {
      setHeroIndex((prev) => (prev + 1) % HERO_IMAGES.length);
      const timer = setInterval(() => {
        setHeroIndex((prev) => (prev + 1) % HERO_IMAGES.length);
      }, 6000);
      return () => clearInterval(timer);
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      setNowTick(new Date());
      const id = setInterval(() => setNowTick(new Date()), 60_000);
      return () => clearInterval(id);
    }, []),
  );

  useEffect(() => {
    if (!user || user.role !== GUARDIAN_ROLE || !user.user_id) {
      shownGuardianWelcomeForUser.current = null;
      setGuardianWelcomeVisible(false);
      pendingGuardianSelectionPromptRef.current = false;
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (!user || user.role !== GUARDIAN_ROLE || !user.user_id) {
        return;
      }

      if (shownGuardianWelcomeForUser.current === user.user_id) {
        return;
      }

      shownGuardianWelcomeForUser.current = user.user_id;
      // Keep this pending until we can confirm senior count after fresh login data loads.
      // This prevents missing the picker when seniors arrive after the welcome modal opens.
      pendingGuardianSelectionPromptRef.current = true;
      setGuardianWelcomeVisible(true);
    }, [user])
  );

  const greeting = useMemo(() => getGreetingFromDate(nowTick), [nowTick]);

  const bannerDisplayName = useMemo(() => {
    if (!user) return { line: 'Welcome!', subtitleDay: '' };

    if (user.role === SENIOR_ROLE) {
      return {
        line: buildGreetingName(user.first_name, user.last_name, user.email),
        subtitleDay: '',
      };
    }

    if (user.role === GUARDIAN_ROLE) {
      return {
        line: buildGreetingName(user.first_name, user.last_name, user.email),
        subtitleDay: '',
      };
    }

    if (user.role === CARETAKER_ROLE && selectedSenior) {
      const fn = capitalizeWord((selectedSenior.firstName || '').trim());
      const ln = (selectedSenior.lastName || '').trim();
      const line = fn ? `${fn}${ln ? ` ${ln}` : ''}!` : ln ? `${capitalizeWord(ln)}!` : 'Welcome!';
      return { line, subtitleDay: '' };
    }

    if (user.role !== CARETAKER_ROLE) {
      return {
        line: buildGreetingName(user.first_name, user.last_name, user.email),
        subtitleDay: '',
      };
    }

    return {
      line: 'Your family',
      subtitleDay: 'Select a senior above to personalize this card.',
    };
  }, [user, selectedSenior, guardianSeniorDisplay]);

  const weekdayLine = useMemo(() => {
    const d = nowTick;
    const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
    const monthDay = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    return `Have a wonderful ${weekday} — ${monthDay}`;
  }, [nowTick]);

  const guardianSelectedSeniorLabel = useMemo(() => {
    if (!user || user.role !== GUARDIAN_ROLE) {
      return '';
    }

    const fn = capitalizeWord((guardianSeniorDisplay?.firstName || selectedSenior?.firstName || '').trim());
    const ln = capitalizeWord((guardianSeniorDisplay?.lastName || selectedSenior?.lastName || '').trim());
    const fullName = [fn, ln].filter(Boolean).join(' ').trim();

    if (seniors.length <= 1) {
      return fullName ? `Selected senior: ${fullName}` : 'Senior selected';
    }

    if (fullName) {
      return `Selected senior: ${fullName}`;
    }

    return 'Please select a senior to continue.';
  }, [user, guardianSeniorDisplay, selectedSenior, seniors.length]);

  const showGuardianSelectionButton = !!user && user.role === GUARDIAN_ROLE && seniors.length > 1;
  const homeGreetingLine = useMemo(() => {
    const viewerName = user?.first_name?.trim()
      ? capitalizeWord(user.first_name.trim())
      : 'User';

    if (user?.role === SENIOR_ROLE) {
      return {
        viewerName,
        action: 'viewing',
        target: 'own health dashboard',
      };
    }

    return {
      viewerName,
      action: 'checking on',
      target: caretakerHeaderSenior.firstName || 'your loved one',
    };
  }, [caretakerHeaderSenior.firstName, user?.first_name, user?.role]);
  const homeHeartValue = formatHomeMetric(todayVitals?.hrAvg);
  const homeStepsValue = formatHomeSteps(todayVitals?.steps);
  const homeBpValue = formatHomeBp(todayVitals);
  const healthCardStatus = formatDeviceActivityStatus(activeDeviceRecord);

  const openLastPositionMap = useCallback(() => {
    const lat = liveSnapshot.latitude;
    const lon = liveSnapshot.longitude;
    if (lat == null || lon == null) return;
    const url = buildOpenStreetMapMarkerUrl(lat, lon);
    navigation.navigate('WebView', {
      url,
      title: 'Last position (OpenStreetMap)',
    });
  }, [liveSnapshot.latitude, liveSnapshot.longitude, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <GuardianWelcomeModal
        visible={guardianWelcomeVisible}
        greetingTitle={greeting.title}
        guardianName={guardianWelcomeName}
        seniorsCount={seniors.length}
        devicesCount={dashboardDevices.length}
        onClose={() => setGuardianWelcomeVisible(false)}
      />
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void fetchDashboardData('manual');
              void loadV8VitalsForToday();
            }}
            colors={['#FF9500']}
            tintColor="#FF9500"
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoTextMain}>Healthsoft</Text>
            <Text style={styles.logoSubText}>CARE PORTAL</Text>
          </View>
          <View style={styles.headerRight}>
            {isCaretaker && (
              <TouchableOpacity
                style={styles.avatarBtn}
                onPress={openSeniorSelectionModal}
                disabled={seniors.length === 0}
                activeOpacity={0.7}
              >
                {caretakerHeaderSenior.profileImageUrl ? (
                  <Image
                    source={{ uri: caretakerHeaderSenior.profileImageUrl }}
                    style={styles.avatar}
                  />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarInitials}>{caretakerHeaderInitials}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        {isCaretaker && (
          <SeniorSelectionModal
            visible={modalVisible}
            onClose={() => setModalVisible(false)}
          />
        )}

        {/* Personalized checking greeting */}
        <View style={styles.greetingTextContainer}>
          <Text style={styles.greetingGreetingText}>
            {greeting.title},
          </Text>
          <Text style={styles.greetingSub}>
            {homeGreetingLine.viewerName}{' '}
            <Text style={styles.greetingDot}>·</Text>
            <Text style={styles.greetingChecking}> {homeGreetingLine.action} </Text>
            <Text style={styles.greetingSeniorName}>
              {homeGreetingLine.target}
            </Text>
          </Text>
        </View>

        {/* Senior Health Status Card (Today's Activity) */}
        {activeDashboardSeniorId && (
          <TouchableOpacity
            style={styles.healthStatusCard}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Activity')}
          >
            {/* Pill and updated time */}
            <View style={styles.healthCardHeader}>
              <View style={styles.activeNowBadge}>
                <View style={styles.greenDot} />
                <Text style={styles.activeNowText}>{healthCardStatus.toUpperCase()}</Text>
              </View>
              <Text style={styles.updatedTimeText}>
                {liveSnapshot.lastUpdatedLabel || NA}
              </Text>
            </View>

            {/* Senior Name and Location */}
            <Text style={styles.healthSeniorName}>
              {caretakerHeaderSenior.firstName || selectedSenior?.firstName || 'Senior'}
            </Text>
            <Text style={styles.healthLocationText}>
              📍 At Home · {displayStr(liveSnapshot.networkLabel || 'Cellular')}
            </Text>

            <View style={styles.cardDivider} />

            {/* Vitals Columns (Heart, Steps, BP) */}
            <View style={styles.vitalsColsRow}>
              {/* HEART COLUMN */}
              <View style={styles.vitalColItem}>
                <View style={[styles.vitalColIconWrap, styles.vitalIconHeartBg]}>
                  <Icon name="heart" size={20} color="#EF4444" />
                </View>
                <Text style={styles.vitalColVal}>
                  {homeHeartValue}
                  {homeHeartValue !== NA ? <Text style={styles.vitalColUnit}> bpm</Text> : null}
                </Text>
                <Text style={styles.vitalColLabel}>HEART</Text>
              </View>

              {/* STEPS COLUMN */}
              <View style={styles.vitalColItem}>
                <View style={[styles.vitalColIconWrap, styles.vitalIconStepsBg]}>
                  <Icon name="walk" size={20} color="#10B981" />
                </View>
                <Text style={styles.vitalColVal}>
                  {homeStepsValue}
                </Text>
                <Text style={styles.vitalColLabel}>STEPS</Text>
              </View>

              {/* BP COLUMN */}
              <View style={styles.vitalColItem}>
                <View style={[styles.vitalColIconWrap, styles.vitalIconDoseBg]}>
                  <Icon name="fitness" size={20} color="#3B82F6" />
                </View>
                <Text style={styles.vitalColVal}>
                  {homeBpValue}
                  {homeBpValue !== NA ? <Text style={styles.vitalColUnit}> mmHg</Text> : null}
                </Text>
                <Text style={styles.vitalColLabel}>BP</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* DEVICES Section */}
        <View style={styles.devicesSectionHeader}>
          <Text style={styles.devicesSectionTitle}>DEVICES</Text>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() =>
              navigation.navigate('HomeDevices', {
                dashboardDevices,
                activeSeniorId: activeDashboardSeniorId || user?.user_id || null,
                showV8HandBand: selectedSeniorHandBandMacs.length > 0,
              })
            }
          >
            <Text style={styles.devicesSeeAllText}>See all →</Text>
          </TouchableOpacity>
        </View>

        {/* Devices list */}
        <View style={styles.devicesListContainer}>
          {/* PENDANT DEVICES FROM REST DASHBOARD API */}
          {dashboardDevices.length > 0 ? (
            dashboardDevices.map((row, index) => {
              const snap = mapSeniorDashboardDeviceToSnapshot(row);
              const rowActivityStatus = formatDeviceActivityStatus(row);
              const rowBatteryValue = formatDashboardBattery(snap);
              const rowBatteryIcon = batteryIconFor(snap.batteryPercent, snap.charging);
              return (
                <TouchableOpacity
                  key={`pendant-${row.ident || index}`}
                  style={styles.deviceRowCard}
                  activeOpacity={0.8}
                  onPress={() => {
                    navigation.navigate('PendantDetail', {
                      seniorId: activeDashboardSeniorId || user?.user_id,
                      imei: row.ident || row.imei || '',
                      deviceName: getSeniorDashboardDeviceLabel(row),
                    });
                  }}
                >
                  <View style={[styles.deviceRowIconWrap, styles.deviceIconPendantBg]}>
                    <Icon name="sunny" size={22} color="#D97706" />
                  </View>
                  <View style={styles.deviceRowTextCol}>
                    <Text style={styles.deviceRowName}>
                      {getSeniorDashboardDeviceLabel(row)}
                    </Text>
                    <Text style={styles.deviceRowSub}>
                      {snap.alarmSeverity === 'critical' ? 'Fall Detected!' : 'Fall detection · Armed'}
                    </Text>
                  </View>
                  <View style={styles.deviceRowStatusCol}>
                    <Text style={[styles.deviceRowStatusText, styles.deviceRowStatusActive]}>
                      {rowActivityStatus}
                    </Text>
                    <View style={styles.deviceRowBatteryWrap}>
                      <Icon name={rowBatteryIcon} size={14} color="#8A827A" />
                      <Text style={styles.deviceRowBatteryText}>
                        {rowBatteryValue}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          ) : !dashboardLoading && (
            <View style={styles.noDevicesBox}>
              <Text style={styles.noDevicesText}>No active pendant devices assigned.</Text>
            </View>
          )}

          {/* V8 SMART BAND DEVICE */}
          {selectedSeniorHandBandMacs && selectedSeniorHandBandMacs.length > 0 && (
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
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9F6F0',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
  },
  logoContainer: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  logoTextMain: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1B2A4A',
    letterSpacing: -0.5,
  },
  logoSubText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8A827A',
    letterSpacing: 1,
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FF9500',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  greetingTextContainer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
  },
  greetingGreetingText: {
    fontSize: 16,
    color: '#8F8276',
    fontWeight: '500',
  },
  greetingSub: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1B2A4A',
    marginTop: 4,
    lineHeight: 32,
  },
  greetingDot: {
    color: '#FF9500',
    fontWeight: '900',
  },
  greetingChecking: {
    color: '#1B2A4A',
  },
  greetingSeniorName: {
    color: '#1B2A4A',
  },
  healthStatusCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    borderRadius: 30,
    padding: 24,
    shadowColor: '#1B2A4A',
    shadowOpacity: 0.04,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
    marginBottom: 16,
  },
  healthCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  activeNowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  activeNowText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 0.5,
  },
  updatedTimeText: {
    fontSize: 13,
    color: '#AF9F92',
    fontWeight: '500',
  },
  healthSeniorName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1B2A4A',
  },
  healthLocationText: {
    fontSize: 14,
    color: '#8F8276',
    fontWeight: '500',
    marginTop: 4,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E8E2DA',
    marginVertical: 20,
  },
  vitalsColsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  vitalColItem: {
    flex: 1,
    alignItems: 'center',
  },
  vitalColIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  vitalIconHeartBg: {
    backgroundColor: '#FEF2F2',
  },
  vitalIconStepsBg: {
    backgroundColor: '#E6F8ED',
  },
  vitalIconDoseBg: {
    backgroundColor: '#EFF6FF',
  },
  vitalColVal: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1B2A4A',
  },
  vitalColUnit: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8F8276',
  },
  vitalColLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#AF9F92',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  devicesSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 14,
  },
  devicesSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1B2A4A',
    letterSpacing: 1,
  },
  devicesSeeAllText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FF9500',
  },
  devicesListContainer: {
    paddingHorizontal: 16,
    paddingBottom: 40,
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
    backgroundColor: '#FFF8F0',
  },
  deviceRowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  deviceRowName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1B2A4A',
  },
  deviceRowSub: {
    fontSize: 13,
    color: '#8F8276',
    fontWeight: '500',
    marginTop: 2,
  },
  deviceRowStatusCol: {
    alignItems: 'flex-end',
  },
  deviceRowStatusText: {
    fontSize: 14,
    fontWeight: '800',
  },
  deviceRowStatusActive: {
    color: '#10B981',
  },
  deviceRowBatteryWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  deviceRowBatteryText: {
    fontSize: 12,
    color: '#8A827A',
    fontWeight: '600',
    marginLeft: 4,
  },
  noDevicesBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noDevicesText: {
    fontSize: 14,
    color: '#8F8276',
    fontWeight: '500',
  },
});

export default HomeScreen;
