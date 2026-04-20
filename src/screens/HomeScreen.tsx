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

function lastAlarmLine(kind: string | null, at: string | null): string {
  const k = displayStr(kind);
  const a = displayStr(at);
  if (k === NA && a === NA) {
    return NA;
  }
  return `${k} · ${a}`;
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
  if (positionRows.length === 0) return statusRows;

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

const HomeScreen = () => {
  const navigation = useNavigation<any>();
  const { user, selectedSenior, seniors, selectSenior, getMySeniors, isCaretaker, getSeniorDashboard, getGuardianDashboard } =
    useAuth();
  const [modalVisible, setModalVisible] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);
  const [nowTick, setNowTick] = useState(() => new Date());
  const [dashboardDevices, setDashboardDevices] = useState<SeniorDashboardDeviceRecord[]>([]);
  const [selectedDeviceIndex, setSelectedDeviceIndex] = useState(0);
  const [devicePickerVisible, setDevicePickerVisible] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [guardianSeniorProfiles, setGuardianSeniorProfiles] = useState<GuardianSeniorProfileRow[]>([]);
  const [guardianDevicePositions, setGuardianDevicePositions] = useState<SeniorDashboardDeviceRecord[]>([]);
  const [guardianDeviceAlarms, setGuardianDeviceAlarms] = useState<SeniorDashboardDeviceRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [guardianWelcomeVisible, setGuardianWelcomeVisible] = useState(false);
  const shownGuardianWelcomeForUser = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const dashboardRequestIdRef = useRef(0);

  /** Senior id for `/api/v1/senior-dashboard/{id}` — logged-in senior, or caretaker’s selected senior only. */
  const activeDashboardSeniorId = useMemo(() => {
    if (!user) return null;
    if (user.role === SENIOR_ROLE) return user.user_id;
    if (user.role === CARETAKER_ROLE && selectedSenior?.userId) return selectedSenior.userId;
    return null;
  }, [user, selectedSenior?.userId]);

  const showTelemetryBar = useMemo(() => {
    if (!user) return false;
    if (user.role === SENIOR_ROLE) return true;
    if (user.role === GUARDIAN_ROLE) return true;
    if (user.role === CARETAKER_ROLE && selectedSenior?.userId) return true;
    return false;
  }, [user, selectedSenior?.userId]);

  const showLocationCard = user?.role === GUARDIAN_ROLE;

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

  const fetchDashboardData = useCallback(async (isRefresh = false) => {
    const requestId = ++dashboardRequestIdRef.current;
    const shouldIgnore = () =>
      !isMountedRef.current || dashboardRequestIdRef.current !== requestId;

    if (!user) {
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

    if (shouldIgnore()) return;
    if (isRefresh) setRefreshing(true);
    else setDashboardLoading(true);
    setDashboardError(null);

    if (user.role === GUARDIAN_ROLE) {
      setDashboardDevices([]);
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
        setGuardianSeniorProfiles([]);
        setGuardianDevicePositions([]);
        setGuardianDeviceAlarms([]);
        setDashboardError(e instanceof Error ? e.message : 'Guardian dashboard request failed.');
      } finally {
        if (shouldIgnore()) return;
        if (isRefresh) setRefreshing(false);
        else setDashboardLoading(false);
      }
      return;
    }

    if (shouldIgnore()) return;
    setGuardianSeniorProfiles([]);
    setGuardianDevicePositions([]);
    setGuardianDeviceAlarms([]);

    if (user.role === SENIOR_ROLE) {
      try {
        const res = await getSeniorDashboard(user.user_id);
        if (shouldIgnore()) return;
        const list = Array.isArray(res.deviceStatusEventDTOs) ? res.deviceStatusEventDTOs : [];
        setDashboardDevices(list);
        setSelectedDeviceIndex(0);
      } catch (e) {
        if (shouldIgnore()) return;
        setDashboardDevices([]);
        setDashboardError(e instanceof Error ? e.message : 'Dashboard request failed.');
      } finally {
        if (shouldIgnore()) return;
        if (isRefresh) setRefreshing(false);
        else setDashboardLoading(false);
      }
      return;
    }

    if (user.role === CARETAKER_ROLE) {
      if (!selectedSenior?.userId) {
        if (shouldIgnore()) return;
        setDashboardDevices([]);
        setDashboardError(null);
        if (isRefresh) setRefreshing(false);
        else setDashboardLoading(false);
        return;
      }
      try {
        const res = await getSeniorDashboard(selectedSenior.userId);
        if (shouldIgnore()) return;
        const list = Array.isArray(res.deviceStatusEventDTOs) ? res.deviceStatusEventDTOs : [];
        setDashboardDevices(list);
        setSelectedDeviceIndex(0);
      } catch (e) {
        if (shouldIgnore()) return;
        setDashboardDevices([]);
        setDashboardError(e instanceof Error ? e.message : 'Dashboard request failed.');
      } finally {
        if (shouldIgnore()) return;
        if (isRefresh) setRefreshing(false);
        else setDashboardLoading(false);
      }
      return;
    }

    if (shouldIgnore()) return;
    setDashboardDevices([]);
    setDashboardError(null);
    if (isRefresh) setRefreshing(false);
    else setDashboardLoading(false);
  }, [user, user?.role, user?.user_id, selectedSenior?.userId, getSeniorDashboard, getGuardianDashboard]);

  useEffect(() => {
    fetchDashboardData(false);
  }, [fetchDashboardData]);

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
    setSelectedDeviceIndex(0);
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
    const updatedPart = displayStr(liveSnapshot.lastUpdatedLabel);
    return `${speedPart} · ${updatedPart}`;
  }, [liveSnapshot.speedKph, liveSnapshot.lastUpdatedLabel]);

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
          setModalVisible(false);
        });
      return;
    }

    setModalVisible(seniors.length > 1);
  }, [selectedSenior, seniors, isCaretaker, selectSenior]);

  useEffect(() => {
    const timer = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % HERO_IMAGES.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user || user.role !== GUARDIAN_ROLE || !user.user_id) {
      shownGuardianWelcomeForUser.current = null;
      setGuardianWelcomeVisible(false);
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
              void fetchDashboardData(true);
            }}
            colors={['#FF9500']}
            tintColor="#FF9500"
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Icon name="fitness" size={24} color="#FF9500" />
          </View>
          {isCaretaker && (
            <TouchableOpacity
              style={styles.headerRight}
              onPress={() => {
                if (seniors.length > 1) {
                  setModalVisible(true);
                }
              }}
              disabled={seniors.length <= 1}
            >
              <View style={{ marginRight: 8, alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#333' }}>
                  {caretakerHeaderSenior.firstName || 'Select Senior'}
                </Text>
                <Text style={{ fontSize: 10, color: '#666' }}>
                  {headerShowsActiveSenior ? 'Active Profile' : 'Tap to select'}
                </Text>
              </View>
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

        {isCaretaker && (
          <SeniorSelectionModal
            visible={modalVisible}
            onClose={() => setModalVisible(false)}
          />
        )}

        {showTelemetryBar ? (
          <View style={styles.deviceBar}>
            {dashboardLoading ? (
              <View style={styles.deviceBarRow}>
                <ActivityIndicator size="small" color="#FF9500" />
                <Text style={styles.deviceBarLoadingText}>Loading device data…</Text>
              </View>
            ) : dashboardDevices.length > 0 ? (
              <TouchableOpacity
                style={styles.deviceBarRow}
                activeOpacity={dashboardDevices.length > 1 ? 0.7 : 1}
                onPress={() => {
                  if (dashboardDevices.length > 1) {
                    setDevicePickerVisible(true);
                  }
                }}
                disabled={dashboardDevices.length <= 1}
              >
                <Icon name="hardware-chip-outline" size={20} color="#FF9500" />
                <View style={styles.deviceBarTextCol}>
                  <Text style={styles.deviceBarLabel}>Device</Text>
                  <Text style={styles.deviceBarValue} numberOfLines={2}>
                    {selectedDeviceLabel}
                  </Text>
                </View>
                {dashboardDevices.length > 1 ? (
                  <Icon name="chevron-down" size={20} color="#8A7565" />
                ) : null}
              </TouchableOpacity>
            ) : (
              <View style={styles.deviceBarTextColFull}>
                <View style={styles.deviceBarRow}>
                  <Icon name="hardware-chip-outline" size={20} color="#FF9500" />
                  <View style={styles.deviceBarTextCol}>
                    <Text style={styles.deviceBarLabel}>Device</Text>
                    <Text style={styles.deviceBarValue}>{NA}</Text>
                  </View>
                </View>
                {dashboardError ? (
                  <Text style={styles.deviceBarErrorSmall}>{dashboardError}</Text>
                ) : null}
              </View>
            )}
          </View>
        ) : null}

        <Modal
          visible={devicePickerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setDevicePickerVisible(false)}
        >
          <Pressable style={styles.pickerBackdrop} onPress={() => setDevicePickerVisible(false)}>
            <Pressable style={styles.pickerSheet} onPress={e => e.stopPropagation()}>
              <Text style={styles.pickerTitle}>Select device</Text>
              {dashboardDevices.map((row, index) => (
                <TouchableOpacity
                  key={`${getSeniorDashboardDeviceLabel(row)}-${index}`}
                  style={[
                    styles.pickerRow,
                    index === selectedDeviceIndex && styles.pickerRowSelected,
                  ]}
                  onPress={() => {
                    setSelectedDeviceIndex(index);
                    setDevicePickerVisible(false);
                  }}
                >
                  <Text style={styles.pickerRowText}>{getSeniorDashboardDeviceLabel(row)}</Text>
                  {index === selectedDeviceIndex ? (
                    <Icon name="checkmark-circle" size={22} color="#FF9500" />
                  ) : (
                    <Icon name="ellipse-outline" size={22} color="#C7C1BA" />
                  )}
                </TouchableOpacity>
              ))}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Greeting Card */}
        <ImageBackground
          source={HERO_IMAGES[heroIndex]}
          style={styles.greetingCard}
          imageStyle={styles.greetingImage}
        >
          <View style={styles.greetingOverlay}>
            <Text style={styles.greetingTitle}>{greeting.title}</Text>
            <Text style={styles.greetingName}>{bannerDisplayName.line}</Text>
            <Text style={styles.greetingSubtitle}>
              {bannerDisplayName.subtitleDay || weekdayLine}
            </Text>
            <Text style={styles.greetingMessage}>
              {bannerDisplayName.subtitleDay
                ? weekdayLine
                : `Make today a great one — ${greeting.title.toLowerCase()} from Healthsoft.`}
            </Text>
            {user?.role === GUARDIAN_ROLE ? (
              <View style={styles.guardianSelectionCard}>
                <View style={styles.guardianSelectionHeader}>
                  <Icon name="people-outline" size={18} color="#8B4513" />
                  <Text style={styles.guardianSelectionTitle}>Senior profile</Text>
                </View>
                <Text style={styles.guardianSelectionText}>{guardianSelectedSeniorLabel}</Text>
                {showGuardianSelectionButton ? (
                  <TouchableOpacity
                    style={styles.guardianSelectionButton}
                    onPress={() => setModalVisible(true)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.guardianSelectionButtonText}>Open senior selection</Text>
                    <Icon name="chevron-forward" size={18} color="#FFFFFF" />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>
          <View style={styles.sunIcon}>
            <Icon name={greeting.icon} size={42} color={greeting.iconColor} />
          </View>
        </ImageBackground>

        {showLocationCard ? (
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
                    {hasLiveCoordinates ? 'OpenStreetMap · marker at this point' : NA}
                  </Text>
                </View>
                <Icon name="chevron-forward" size={18} color="#C7C1BA" />
              </TouchableOpacity>
            </View>
            <Image source={locationThumb} style={styles.weatherImage} />
          </View>
        ) : null}

        {/* Battery + safety (reuses Rahukalam / Yamagandam card row) */}
        <View style={styles.badgesRow}>
          <View style={[styles.badgeCard, styles.badgeWarm]}>
            <View style={styles.badgeHeader}>
              <Icon name={batteryIconName} size={16} color="#D18B2E" />
              <Text style={styles.badgeTitle}>Battery</Text>
            </View>
            <Text style={styles.badgeHighlight}>{displayBatteryPct(liveSnapshot.batteryPercent)}</Text>
            <Text style={styles.badgeTime}>{chargingCaption(liveSnapshot.charging)}</Text>
          </View>
          <View style={[styles.badgeCard, styles.badgeCool]}>
            <View style={styles.badgeHeader}>
              <Icon name={safetyIconName} size={16} color="#D7643C" />
              <Text style={styles.badgeTitle}>Safety</Text>
            </View>
            <Text style={styles.badgeHighlight} numberOfLines={2}>
              {displayStr(liveSnapshot.primaryAlarmLabel)}
            </Text>
            <Text style={styles.badgeTime} numberOfLines={2}>
              {displayStr(liveSnapshot.alarmDetail)}
            </Text>
            <View style={styles.badgeAlarmMeta}>
              <Icon
                name="alarm-outline"
                size={12}
                color="#8A7565"
                style={styles.badgeAlarmIcon}
              />
              <Text style={styles.badgeAlarmMetaText} numberOfLines={2}>
                {`Last: ${lastAlarmLine(liveSnapshot.lastAlarmKind, liveSnapshot.lastAlarmAt)}`}
              </Text>
            </View>
          </View>
        </View>

        {/* Watch summary (reuses “Best times” card) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Watch status</Text>
          <View style={styles.timeCard}>
            <View style={styles.timeHeaderRow}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.timeTitle}>{displayStr(liveSnapshot.primaryAlarmLabel)}</Text>
                <Text style={styles.timeSubtitle}>{displayStr(liveSnapshot.alarmDetail)}</Text>
                <View style={styles.lastAlarmRow}>
                  <Icon name="time-outline" size={16} color="#8A827A" />
                  <View style={styles.lastAlarmTextCol}>
                    <Text style={styles.lastAlarmLabel}>Last alarm</Text>
                    <Text style={styles.lastAlarmValue}>
                      {lastAlarmLine(liveSnapshot.lastAlarmKind, liveSnapshot.lastAlarmAt)}
                    </Text>
                  </View>
                </View>
              </View>
              <Icon name="pulse" size={18} color="#C7C1BA" />
            </View>

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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceBar: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E8E2DA',
  },
  deviceBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceBarTextCol: {
    flex: 1,
    marginLeft: 10,
    minWidth: 0,
  },
  deviceBarLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8A827A',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  deviceBarValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  deviceBarTextColFull: {
    width: '100%',
  },
  deviceBarErrorSmall: {
    marginTop: 8,
    fontSize: 12,
    color: '#A94442',
    lineHeight: 16,
  },
  deviceBarLoadingText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#666',
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  pickerSheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 8,
    maxHeight: '70%',
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8E2DA',
  },
  pickerRowSelected: {
    backgroundColor: '#FFF8F0',
  },
  pickerRowText: {
    flex: 1,
    fontSize: 15,
    color: '#333',
    marginRight: 8,
  },
  dots: {
    flexDirection: 'row',
    marginRight: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DCD6CF',
    marginHorizontal: 3,
  },
  dotActive: {
    backgroundColor: '#C9B9A7',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FF9500',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 8,
  },
  greetingCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    minHeight: 220,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 18,
    overflow: 'hidden',
  },
  greetingImage: {
    borderRadius: 16,
  },
  greetingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(255, 250, 242, 0.85)',
    padding: 16,
    borderRadius: 14,
  },
  greetingContent: {
    flex: 1,
  },
  greetingTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#8B4513',
  },
  greetingName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#8B4513',
    marginBottom: 8,
  },
  greetingSubtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  greetingMessage: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  guardianSelectionCard: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5D7C7',
  },
  guardianSelectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  guardianSelectionTitle: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '700',
    color: '#8B4513',
  },
  guardianSelectionText: {
    fontSize: 14,
    color: '#5E564F',
    lineHeight: 20,
  },
  guardianSelectionButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#D97706',
  },
  guardianSelectionButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginRight: 8,
  },
  sunIcon: {
    justifyContent: 'center',
    marginLeft: 12,
  },
  weatherCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
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
  badgesRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
  },
  badgeCard: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    marginHorizontal: 4,
  },
  badgeWarm: {
    backgroundColor: '#F8EEDB',
  },
  badgeCool: {
    backgroundColor: '#F6E6DE',
  },
  badgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  badgeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7D5A2E',
    marginLeft: 6,
  },
  badgeTime: {
    fontSize: 12,
    color: '#7A6B60',
  },
  badgeHighlight: {
    fontSize: 18,
    fontWeight: '700',
    color: '#5C4A3A',
    marginBottom: 4,
  },
  badgeAlarmMeta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  badgeAlarmIcon: {
    marginTop: 2,
    marginRight: 6,
  },
  badgeAlarmMetaText: {
    flex: 1,
    fontSize: 11,
    color: '#8A7565',
    lineHeight: 15,
  },
  lastAlarmRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8E2DA',
  },
  lastAlarmTextCol: {
    flex: 1,
    marginLeft: 8,
  },
  lastAlarmLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A827A',
    marginBottom: 4,
  },
  lastAlarmValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    lineHeight: 20,
  },
  section: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginHorizontal: 16,
    marginBottom: 12,
  },
  timeCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  timeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  timeSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  timeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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

export default HomeScreen;
