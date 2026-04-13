import React, { useMemo, useEffect, useCallback, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, Platform } from 'react-native';
import { Buffer } from 'buffer';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBle } from '../bluetooth/BleProvider';
import type { BleGeoPoint, BleServiceSummary } from '../bluetooth/types';
import { asciiBytes, s8, u8, u24le, u32le } from '../bluetooth/ev07bProtocol';
import {
  encodeEv07bAlarmClock,
  encodeEv07bAuthorizedPhone,
  encodeEv07bAsciiSetting,
  encodeEv07bFallDownAlert,
  encodeEv07bGeoAlert,
  encodeEv07bNoMotionAlert,
  encodeEv07bNoDisturb,
  encodeEv07bTiltAlert,
  EV07B_ENABLE_CONTROL_FLAGS,
  EV07B_VOICE_PROMPT_FLAGS,
  EV07B_WEEKDAY_OPTIONS,
  hasEv07bFlag,
  toggleEv07bFlag,
} from '../bluetooth/ev07bConfigCodec';

type RouteParams = {
  deviceId: string;
  deviceName?: string | null;
  assignedImei?: string | null;
};

const WORKING_MODES = ['Normal', 'Power Save', 'Sleep'];
const WORKING_MODE_CODES = [1, 2, 3];
const ALARM_SLOT_OPTIONS = [0, 1, 2, 3];
const SMS_URL_MAX_LENGTH = 40;
const GEO_ALERT_DIRECTIONS = [
  { value: 'out' as const, label: 'Exit Zone' },
  { value: 'in' as const, label: 'Enter Zone' },
];
const GEO_ALERT_TYPES = [
  { value: 'circle' as const, label: 'Circle' },
  { value: 'polygon' as const, label: 'Polygon' },
];
type WriteBlock = { key: number; value: Uint8Array };
type ConfigSectionKey =
  | 'general'
  | 'sos'
  | 'cellular'
  | 'server'
  | 'reporting'
  | 'audio'
  | 'alarm'
  | 'alerts'
  | 'featureFlags'
  | 'smsTemplates'
  | 'voicePrompts'
  | 'bluetoothAccess';

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function parseMacAddress(input: string): Uint8Array | null {
  const cleaned = input.replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length !== 12) return null;
  const parts = cleaned.match(/.{1,2}/g);
  if (!parts) return null;
  return Uint8Array.from(parts.map(part => parseInt(part, 16)));
}

function formatTime(hour?: number, minute?: number): string {
  if (hour === undefined || minute === undefined) return '—';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatWorkdayMask(mask?: number): string {
  if (mask === undefined) return '—';
  const labels = EV07B_WEEKDAY_OPTIONS
    .filter(option => (mask & (1 << option.bit)) !== 0)
    .map(option => option.label);
  return labels.length ? labels.join(', ') : 'One time';
}

function formatFlagCount(
  mask: number | undefined,
  definitions: readonly { bit: number }[],
): string {
  if (mask === undefined) return '—';
  const enabled = definitions.filter(definition => hasEv07bFlag(mask, definition.bit)).length;
  return `${enabled}/${definitions.length} enabled`;
}

function formatGeoCoordinate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(5);
}

function formatGeoAlertSummary(identity: {
  geoAlertEnabled?: boolean;
  geoAlertDirection?: 'out' | 'in';
  geoAlertType?: 'circle' | 'polygon';
  geoAlertRadiusMeters?: number;
  geoAlertPoints?: BleGeoPoint[];
} | undefined): string {
  if (!identity?.geoAlertType) return '—';
  const firstPoint = identity.geoAlertPoints?.[0];
  const state = identity.geoAlertEnabled ? 'On' : 'Off';
  const direction = identity.geoAlertDirection === 'in' ? 'Enter' : 'Exit';
  if (identity.geoAlertType === 'polygon') {
    return `${state} • ${direction} • Polygon • ${identity.geoAlertPoints?.length ?? 0} points`;
  }
  return firstPoint
    ? `${state} • ${direction} • ${identity.geoAlertRadiusMeters ?? 0}m • ${formatGeoCoordinate(firstPoint.latitude)}, ${formatGeoCoordinate(firstPoint.longitude)}`
    : `${state} • ${direction} • Circle`;
}

function formatFallDownSummary(identity: {
  fallDownAlertEnabled?: boolean;
  fallDownAlertDial?: boolean;
  fallDownAlertSensitivity?: number;
} | undefined): string {
  if (identity?.fallDownAlertSensitivity === undefined) return '—';
  return `${identity.fallDownAlertEnabled ? 'On' : 'Off'} • Dial ${identity.fallDownAlertDial ? 'On' : 'Off'} • Sensitivity ${identity.fallDownAlertSensitivity}`;
}

function formatNoMotionSummary(identity: {
  noMotionAlertEnabled?: boolean;
  noMotionAlertDial?: boolean;
  noMotionAlertStaticPeriodSec?: number;
} | undefined): string {
  if (identity?.noMotionAlertStaticPeriodSec === undefined) return '—';
  return `${identity.noMotionAlertEnabled ? 'On' : 'Off'} • Dial ${identity.noMotionAlertDial ? 'On' : 'Off'} • ${identity.noMotionAlertStaticPeriodSec}s`;
}

function formatTiltSummary(identity: {
  tiltAlertEnabled?: boolean;
  tiltAlertDial?: boolean;
  tiltAlertAngleDeg?: number;
  tiltAlertDurationSec?: number;
} | undefined): string {
  if (identity?.tiltAlertAngleDeg === undefined || identity?.tiltAlertDurationSec === undefined) return '—';
  return `${identity.tiltAlertEnabled ? 'On' : 'Off'} • Dial ${identity.tiltAlertDial ? 'On' : 'Off'} • ${identity.tiltAlertAngleDeg}deg • ${identity.tiltAlertDurationSec}s`;
}

function pointsToMultiline(points?: BleGeoPoint[]): string {
  if (!points || points.length === 0) return '';
  return points.map(point => `${point.latitude}, ${point.longitude}`).join('\n');
}

function parseGeoPointsInput(input: string): BleGeoPoint[] {
  return input
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [latitudeRaw, longitudeRaw] = line.split(',').map(part => part.trim());
      const latitude = Number(latitudeRaw);
      const longitude = Number(longitudeRaw);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('Geo fence polygon points must use "latitude, longitude" on each line');
      }
      return { latitude, longitude };
    });
}

const DeviceDetailScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { deviceId, deviceName, assignedImei } = (route.params as RouteParams) ?? {};

  const {
    connectionStates,
    deviceIdentityById,
    gattDetailsById,
    dataSnapshotById,
    bleLogById,
    connectToDevice,
    sendEv07bConfig,
  } = useBle();

  const bleLog = bleLogById[deviceId] ?? [];

  const state = connectionStates[deviceId] ?? 'disconnected';
  const identity = deviceIdentityById[deviceId];
  const gatt = gattDetailsById[deviceId];
  const dataSnapshot = dataSnapshotById[deviceId];

  const services: BleServiceSummary[] = useMemo(() => gatt?.services ?? [], [gatt]);

  // ── Existing writable state ──
  const [sosNumber, setSosNumber] = useState('');
  const [sosSlot, setSosSlot] = useState('0');
  const [deviceNameInput, setDeviceNameInput] = useState('');
  const [timezoneInput, setTimezoneInput] = useState('0');
  const [apnInput, setApnInput] = useState('');
  const [apnUserInput, setApnUserInput] = useState('');
  const [apnPassInput, setApnPassInput] = useState('');
  const [serverHostInput, setServerHostInput] = useState('');
  const [serverPortInput, setServerPortInput] = useState('');
  const [uploadIntervalInput, setUploadIntervalInput] = useState('');

  // ── New writable state ──
  // SOS slots 2 & 3
  const [sosNumber2, setSosNumber2] = useState('');
  const [sosSlot2, setSosSlot2] = useState('1');
  const [sosNumber3, setSosNumber3] = useState('');
  const [sosSlot3, setSosSlot3] = useState('2');
  // Working Mode
  const [workingMode, setWorkingMode] = useState(0);
  // Alarm Clock
  const [alarmIndex, setAlarmIndex] = useState(1);
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [alarmHour, setAlarmHour] = useState('8');
  const [alarmMinute, setAlarmMinute] = useState('0');
  const [alarmWorkdayMask, setAlarmWorkdayMask] = useState(0x7f);
  const [alarmDurationSec, setAlarmDurationSec] = useState('30');
  const [alarmRing, setAlarmRing] = useState('1');
  // No Disturb
  const [noDisturbEnabled, setNoDisturbEnabled] = useState(false);
  const [ndStartHour, setNdStartHour] = useState('22');
  const [ndStartMin, setNdStartMin] = useState('0');
  const [ndEndHour, setNdEndHour] = useState('7');
  const [ndEndMin, setNdEndMin] = useState('0');
  // Safety alerts
  const [fallDownAlertEnabled, setFallDownAlertEnabled] = useState(false);
  const [fallDownAlertDial, setFallDownAlertDial] = useState(false);
  const [fallDownAlertSensitivity, setFallDownAlertSensitivity] = useState('5');
  const [noMotionAlertEnabled, setNoMotionAlertEnabled] = useState(false);
  const [noMotionAlertDial, setNoMotionAlertDial] = useState(false);
  const [noMotionAlertStaticPeriodSec, setNoMotionAlertStaticPeriodSec] = useState('300');
  const [tiltAlertEnabled, setTiltAlertEnabled] = useState(false);
  const [tiltAlertDial, setTiltAlertDial] = useState(false);
  const [tiltAlertAngleDeg, setTiltAlertAngleDeg] = useState('45');
  const [tiltAlertDurationSec, setTiltAlertDurationSec] = useState('30');
  const [geoAlertEnabled, setGeoAlertEnabled] = useState(false);
  const [geoAlertDirection, setGeoAlertDirection] = useState<'out' | 'in'>('out');
  const [geoAlertType, setGeoAlertType] = useState<'circle' | 'polygon'>('circle');
  const [geoAlertIndex, setGeoAlertIndex] = useState('0');
  const [geoAlertRadiusMeters, setGeoAlertRadiusMeters] = useState('100');
  const [geoAlertLatitude, setGeoAlertLatitude] = useState('');
  const [geoAlertLongitude, setGeoAlertLongitude] = useState('');
  const [geoAlertPointsInput, setGeoAlertPointsInput] = useState('');
  // Enable Control bitmask
  const [enableControl, setEnableControl] = useState(0);
  // Volumes
  const [ringtoneVol, setRingtoneVol] = useState('5');
  const [micVol, setMicVol] = useState('5');
  const [speakerVol, setSpeakerVol] = useState('5');
  // Whitelist
  const [whitelistDevice, setWhitelistDevice] = useState('');
  // SMS reply URL templates
  const [smsGpsUrl, setSmsGpsUrl] = useState('');
  const [smsWifiLbsUrl, setSmsWifiLbsUrl] = useState('');
  // Voice Prompt bitmask
  const [voicePromptMask, setVoicePromptMask] = useState(0);
  // Mileage
  const [mileageInput, setMileageInput] = useState('');

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [savingSection, setSavingSection] = useState<ConfigSectionKey | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    identity: true,
    general: true,
    sos: false,
    cellular: false,
    server: false,
    reporting: false,
    audio: false,
    alarm: false,
    alerts: false,
    featureFlags: false,
    smsTemplates: false,
    voicePrompts: false,
    bluetoothAccess: false,
    gatt: false,
    data: false,
    log: false,
  });

  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  useEffect(() => {
    if (deviceId && state === 'disconnected') {
      connectToDevice(deviceId);
    }
  }, [connectToDevice, deviceId, state]);

  // Track which fields have already been initialized from the device.
  // Each field is only set ONCE — on its first non-undefined arrival from
  // the device. Subsequent identity updates (e.g. after Save ACK) never
  // overwrite values the user may have changed.
  const initializedRef = useRef<Set<string>>(new Set());

  // Reset initialized tracking when the device disconnects (new session).
  useEffect(() => {
    if (state === 'disconnected') {
      initializedRef.current.clear();
    }
  }, [state]);

  // One-shot device → UI sync helper
  const initOnce = useCallback(
    <T,>(field: string, value: T | undefined, setter: (v: T) => void) => {
      if (value === undefined || value === null) return;
      if (initializedRef.current.has(field)) return;
      initializedRef.current.add(field);
      setter(value);
    },
    [],
  );

  useEffect(() => {
    if (!identity) return;
    initOnce('deviceName',      identity.model,              setDeviceNameInput);
    initOnce('sosNumber',       identity.sosNumber,          setSosNumber);
    initOnce('sosSlot',         identity.sosSlot !== undefined ? String(identity.sosSlot) : undefined, setSosSlot);
    initOnce('sosNumber2',      identity.sosNumber2,         setSosNumber2);
    initOnce('sosSlot2',        identity.sosSlot2 !== undefined ? String(identity.sosSlot2) : undefined, setSosSlot2);
    initOnce('sosNumber3',      identity.sosNumber3,         setSosNumber3);
    initOnce('sosSlot3',        identity.sosSlot3 !== undefined ? String(identity.sosSlot3) : undefined, setSosSlot3);
    initOnce('timezone',        identity.timezone !== undefined ? String(identity.timezone) : undefined, setTimezoneInput);
    initOnce('apn',             identity.apn,                setApnInput);
    initOnce('apnUsername',     identity.apnUsername,        setApnUserInput);
    initOnce('apnPassword',     identity.apnPassword,        setApnPassInput);
    initOnce('serverAddress',   identity.serverAddress,      setServerHostInput);
    initOnce('serverPort',      identity.serverPort !== undefined ? String(identity.serverPort) : undefined, setServerPortInput);
    initOnce('uploadInterval',  identity.uploadInterval !== undefined ? String(identity.uploadInterval) : undefined, setUploadIntervalInput);
    initOnce('workingMode',     identity.workingMode,        setWorkingMode);
    initOnce('alarmIndex',      identity.alarmClockIndex,    setAlarmIndex);
    initOnce('alarmEnabled',    identity.alarmClockEnabled,  setAlarmEnabled);
    initOnce('alarmHour',       identity.alarmClockHour !== undefined ? String(identity.alarmClockHour) : undefined, setAlarmHour);
    initOnce('alarmMinute',     identity.alarmClockMinute !== undefined ? String(identity.alarmClockMinute) : undefined, setAlarmMinute);
    initOnce('alarmWorkdayMask',identity.alarmClockWorkdayMask, setAlarmWorkdayMask);
    initOnce('alarmDurationSec',identity.alarmClockDurationSec !== undefined ? String(identity.alarmClockDurationSec) : undefined, setAlarmDurationSec);
    initOnce('alarmRing',       identity.alarmClockRing !== undefined ? String(identity.alarmClockRing) : undefined, setAlarmRing);
    initOnce('noDisturbEnabled',identity.noDisturbEnabled,   setNoDisturbEnabled);
    initOnce('ndStartHour',     identity.noDisturbStart !== undefined ? String(Math.floor(identity.noDisturbStart / 60)) : undefined, setNdStartHour);
    initOnce('ndStartMin',      identity.noDisturbStart !== undefined ? String(identity.noDisturbStart % 60) : undefined, setNdStartMin);
    initOnce('ndEndHour',       identity.noDisturbEnd !== undefined ? String(Math.floor(identity.noDisturbEnd / 60)) : undefined, setNdEndHour);
    initOnce('ndEndMin',        identity.noDisturbEnd !== undefined ? String(identity.noDisturbEnd % 60) : undefined, setNdEndMin);
    initOnce('fallDownAlertEnabled', identity.fallDownAlertEnabled, setFallDownAlertEnabled);
    initOnce('fallDownAlertDial', identity.fallDownAlertDial, setFallDownAlertDial);
    initOnce('fallDownAlertSensitivity', identity.fallDownAlertSensitivity !== undefined ? String(identity.fallDownAlertSensitivity) : undefined, setFallDownAlertSensitivity);
    initOnce('noMotionAlertEnabled', identity.noMotionAlertEnabled, setNoMotionAlertEnabled);
    initOnce('noMotionAlertDial', identity.noMotionAlertDial, setNoMotionAlertDial);
    initOnce('noMotionAlertStaticPeriodSec', identity.noMotionAlertStaticPeriodSec !== undefined ? String(identity.noMotionAlertStaticPeriodSec) : undefined, setNoMotionAlertStaticPeriodSec);
    initOnce('tiltAlertEnabled', identity.tiltAlertEnabled, setTiltAlertEnabled);
    initOnce('tiltAlertDial', identity.tiltAlertDial, setTiltAlertDial);
    initOnce('tiltAlertAngleDeg', identity.tiltAlertAngleDeg !== undefined ? String(identity.tiltAlertAngleDeg) : undefined, setTiltAlertAngleDeg);
    initOnce('tiltAlertDurationSec', identity.tiltAlertDurationSec !== undefined ? String(identity.tiltAlertDurationSec) : undefined, setTiltAlertDurationSec);
    initOnce('geoAlertEnabled', identity.geoAlertEnabled, setGeoAlertEnabled);
    initOnce('geoAlertDirection', identity.geoAlertDirection, setGeoAlertDirection);
    initOnce('geoAlertType', identity.geoAlertType, setGeoAlertType);
    initOnce('geoAlertIndex', identity.geoAlertIndex !== undefined ? String(identity.geoAlertIndex) : undefined, setGeoAlertIndex);
    initOnce('geoAlertRadiusMeters', identity.geoAlertRadiusMeters !== undefined ? String(identity.geoAlertRadiusMeters) : undefined, setGeoAlertRadiusMeters);
    initOnce('geoAlertLatitude', identity.geoAlertPoints?.[0] ? String(identity.geoAlertPoints[0].latitude) : undefined, setGeoAlertLatitude);
    initOnce('geoAlertLongitude', identity.geoAlertPoints?.[0] ? String(identity.geoAlertPoints[0].longitude) : undefined, setGeoAlertLongitude);
    initOnce('geoAlertPointsInput', pointsToMultiline(identity.geoAlertPoints) || undefined, setGeoAlertPointsInput);
    initOnce('enableControl',   identity.enableControl,      setEnableControl);
    initOnce('ringtoneVol',     identity.ringtoneVolume !== undefined ? String(identity.ringtoneVolume) : undefined, setRingtoneVol);
    initOnce('micVol',          identity.micVolume !== undefined ? String(identity.micVolume) : undefined, setMicVol);
    initOnce('speakerVol',      identity.speakerVolume !== undefined ? String(identity.speakerVolume) : undefined, setSpeakerVol);
    initOnce('whitelistDevice', identity.whitelistDevice,    setWhitelistDevice);
    initOnce('smsGpsUrl',       identity.smsGpsUrl,          setSmsGpsUrl);
    initOnce('smsWifiLbsUrl',   identity.smsWifiLbsUrl,      setSmsWifiLbsUrl);
    initOnce('voicePromptMask', identity.voicePromptMask,    setVoicePromptMask);
    initOnce('mileage',         identity.initMileage !== undefined ? String(identity.initMileage) : undefined, setMileageInput);
  }, [identity, initOnce]);

  const runSync = useCallback(async () => {
    try {
      setStatusMsg('Syncing…');
      const resp = await sendEv07bConfig(deviceId, {
        readKeys: [
          // Identity & read-only
          0x01, 0x02, 0x03, 0x04, 0x05, 0x08,
          // Writable config
          0x06, 0x07, 0x09, 0x0a, 0x0b, 0x0c, 0x0e, 0x0f,
          0x10, 0x11, 0x12, 0x13, 0x14, 0x16, 0x17, 0x18, 0x19,
          0x51, 0x53, 0x55, 0x56,
          0x1a, 0x1b,
          // SOS + Network
          0x30, 0x30, 0x30, 0x40, 0x41, 0x42, 0x43, 0x44,
        ],
      });
      setStatusMsg(`Synced (seq ${resp.seqId})`);
    } catch (e: any) {
      setStatusMsg(e.message || 'Sync failed');
    }
  }, [deviceId, sendEv07bConfig]);

  const pushAuthorizedNumber = useCallback((target: WriteBlock[], numberValue: string, slotValue: string, fallbackSlot: number) => {
    const digits = numberValue.replace(/[^0-9]/g, '').slice(0, 20);
    if (!digits) return;
    const parsedSlot = Number(slotValue);
    const slot = Number.isFinite(parsedSlot) ? clampInt(parsedSlot, 0, 9) : fallbackSlot;
    target.push({
      key: 0x30,
      value: encodeEv07bAuthorizedPhone({
        slot,
        enabled: true,
        acceptSms: true,
        noSimDialing: false,
        acceptPhoneCall: true,
        number: digits,
      }),
    });
  }, []);

  const buildAlarmClockWriteBlock = useCallback((overrides?: Partial<{
    index: number;
    enabled: boolean;
    hour: string;
    minute: string;
    workdayMask: number;
    durationSec: string;
    ring: string;
  }>): WriteBlock => ({
    key: 0x0b,
    value: encodeEv07bAlarmClock({
      index: clampInt(overrides?.index ?? alarmIndex, 0, 3),
      enabled: overrides?.enabled ?? alarmEnabled,
      hour: clampInt(Number(overrides?.hour ?? alarmHour), 0, 23),
      minute: clampInt(Number(overrides?.minute ?? alarmMinute), 0, 59),
      workdayMask: overrides?.workdayMask ?? alarmWorkdayMask,
      durationSec: clampInt(Number(overrides?.durationSec ?? alarmDurationSec), 1, 120),
      ring: clampInt(Number(overrides?.ring ?? alarmRing), 1, 10),
    }),
  }), [alarmDurationSec, alarmEnabled, alarmHour, alarmIndex, alarmMinute, alarmRing, alarmWorkdayMask]);

  const buildNoDisturbWriteBlock = useCallback((overrides?: Partial<{
    enabled: boolean;
    startHour: string;
    startMinute: string;
    endHour: string;
    endMinute: string;
  }>): WriteBlock => ({
    key: 0x0c,
    value: encodeEv07bNoDisturb({
      enabled: overrides?.enabled ?? noDisturbEnabled,
      startHour: clampInt(Number(overrides?.startHour ?? ndStartHour), 0, 23),
      startMinute: clampInt(Number(overrides?.startMinute ?? ndStartMin), 0, 59),
      endHour: clampInt(Number(overrides?.endHour ?? ndEndHour), 0, 23),
      endMinute: clampInt(Number(overrides?.endMinute ?? ndEndMin), 0, 59),
    }),
  }), [ndEndHour, ndEndMin, ndStartHour, ndStartMin, noDisturbEnabled]);

  const buildNoMotionWriteBlock = useCallback((overrides?: Partial<{
    enabled: boolean;
    dial: boolean;
    staticPeriodSec: string;
  }>): WriteBlock => ({
    key: 0x53,
    value: encodeEv07bNoMotionAlert({
      enabled: overrides?.enabled ?? noMotionAlertEnabled,
      dial: overrides?.dial ?? noMotionAlertDial,
      staticPeriodSec: clampInt(Number(overrides?.staticPeriodSec ?? noMotionAlertStaticPeriodSec), 60, 36000),
    }),
  }), [noMotionAlertDial, noMotionAlertEnabled, noMotionAlertStaticPeriodSec]);

  const buildTiltWriteBlock = useCallback((overrides?: Partial<{
    enabled: boolean;
    dial: boolean;
    angleDeg: string;
    durationSec: string;
  }>): WriteBlock => ({
    key: 0x55,
    value: encodeEv07bTiltAlert({
      enabled: overrides?.enabled ?? tiltAlertEnabled,
      dial: overrides?.dial ?? tiltAlertDial,
      angleDeg: clampInt(Number(overrides?.angleDeg ?? tiltAlertAngleDeg), 30, 90),
      durationSec: clampInt(Number(overrides?.durationSec ?? tiltAlertDurationSec), 10, 3600),
    }),
  }), [tiltAlertAngleDeg, tiltAlertDial, tiltAlertDurationSec, tiltAlertEnabled]);

  const buildFallWriteBlock = useCallback((overrides?: Partial<{
    enabled: boolean;
    dial: boolean;
    sensitivity: string;
  }>): WriteBlock => ({
    key: 0x56,
    value: encodeEv07bFallDownAlert({
      enabled: overrides?.enabled ?? fallDownAlertEnabled,
      dial: overrides?.dial ?? fallDownAlertDial,
      sensitivity: clampInt(Number(overrides?.sensitivity ?? fallDownAlertSensitivity), 1, 9),
    }),
  }), [fallDownAlertDial, fallDownAlertEnabled, fallDownAlertSensitivity]);

  const buildGeoAlertWriteBlock = useCallback((overrides?: Partial<{
    enabled: boolean;
    direction: 'out' | 'in';
    type: 'circle' | 'polygon';
    index: string;
    radiusMeters: string;
    latitude: string;
    longitude: string;
    pointsInput: string;
  }>): WriteBlock | null => {
    const nextEnabled = overrides?.enabled ?? geoAlertEnabled;
    const nextType = overrides?.type ?? geoAlertType;
    const nextLatitude = overrides?.latitude ?? geoAlertLatitude;
    const nextLongitude = overrides?.longitude ?? geoAlertLongitude;
    const nextPointsInput = overrides?.pointsInput ?? geoAlertPointsInput;
    const shouldWriteGeoAlert =
      nextEnabled ||
      nextLatitude.trim().length > 0 ||
      nextLongitude.trim().length > 0 ||
      nextPointsInput.trim().length > 0 ||
      !!identity?.geoAlertEnabled ||
      !!identity?.geoAlertPoints?.length;
    if (!shouldWriteGeoAlert) return null;

    let geoPoints: BleGeoPoint[];
    if (nextType === 'polygon') {
      geoPoints = nextPointsInput.trim()
        ? parseGeoPointsInput(nextPointsInput)
        : (identity?.geoAlertPoints ?? []);
      if (geoPoints.length < 3) {
        throw new Error('Geo Fence polygon needs at least 3 points');
      }
    } else {
      const latitude = Number(nextLatitude);
      const longitude = Number(nextLongitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        geoPoints = [{ latitude, longitude }];
      } else if (identity?.geoAlertPoints?.[0]) {
        geoPoints = [identity.geoAlertPoints[0]];
      } else {
        throw new Error('Geo Fence latitude and longitude are required');
      }
    }

    return {
      key: 0x51,
      value: encodeEv07bGeoAlert({
        index: clampInt(Number(overrides?.index ?? geoAlertIndex), 0, 15),
        enabled: nextEnabled,
        direction: overrides?.direction ?? geoAlertDirection,
        type: nextType,
        radiusMeters: clampInt(Number(overrides?.radiusMeters ?? geoAlertRadiusMeters), 0, 65535),
        points: geoPoints,
      }),
    };
  }, [
    geoAlertDirection,
    geoAlertEnabled,
    geoAlertIndex,
    geoAlertLatitude,
    geoAlertLongitude,
    geoAlertPointsInput,
    geoAlertRadiusMeters,
    geoAlertType,
    identity,
  ]);

  const sendWriteBlocks = useCallback(async (statusLabel: string, writeBlocks: WriteBlock[], successLabel = statusLabel) => {
    setStatusMsg(`${statusLabel}…`);
    const resp = await sendEv07bConfig(deviceId, { writeBlocks });
    setStatusMsg(`${successLabel} saved${resp.seqId != null ? ` (seq ${resp.seqId})` : ''}`);
    return resp.seqId;
  }, [deviceId, sendEv07bConfig]);

  const buildSectionWriteBlocks = useCallback((section: ConfigSectionKey): WriteBlock[] => {
    switch (section) {
      case 'general': {
        const writes: WriteBlock[] = [];
        const now = Math.floor(Date.now() / 1000);
        writes.push({ key: 0x06, value: u32le(now) });
        const parsedTimezone = Number(timezoneInput);
        const tzVal = Number.isFinite(parsedTimezone) ? clampInt(parsedTimezone, -48, 56) : 0;
        writes.push({ key: 0x0e, value: s8(tzVal) });
        const trimmedDeviceName = deviceNameInput.trim();
        if (trimmedDeviceName) {
          writes.push({ key: 0x13, value: asciiBytes(trimmedDeviceName.slice(0, 20)) });
        }
        const rawWorkingMode = WORKING_MODE_CODES[workingMode] ?? Math.max(1, workingMode + 1);
        writes.push({ key: 0x0a, value: Uint8Array.from([...u24le(0), rawWorkingMode]) });
        if (mileageInput) {
          const mileage = Number(mileageInput);
          if (Number.isFinite(mileage) && mileage >= 0) {
            writes.push({ key: 0x09, value: u32le(Math.floor(mileage)) });
          }
        }
        return writes;
      }
      case 'sos': {
        const writes: WriteBlock[] = [];
        pushAuthorizedNumber(writes, sosNumber, sosSlot, 0);
        pushAuthorizedNumber(writes, sosNumber2, sosSlot2, 1);
        pushAuthorizedNumber(writes, sosNumber3, sosSlot3, 2);
        return writes;
      }
      case 'cellular': {
        const writes: WriteBlock[] = [];
        if (apnInput) writes.push({ key: 0x40, value: asciiBytes(apnInput.trim().slice(0, 31)) });
        if (apnUserInput) writes.push({ key: 0x41, value: asciiBytes(apnUserInput.trim().slice(0, 15)) });
        if (apnPassInput) writes.push({ key: 0x42, value: asciiBytes(apnPassInput.trim().slice(0, 15)) });
        return writes;
      }
      case 'server': {
        const writes: WriteBlock[] = [];
        const trimmedServerHost = serverHostInput.trim();
        if (trimmedServerHost) {
          const parsedPort = Number(serverPortInput);
          const port = Number.isFinite(parsedPort) && parsedPort > 0
            ? clampInt(parsedPort, 1, 65535)
            : clampInt(identity?.serverPort ?? 5050, 1, 65535);
          const hostBytes = asciiBytes(trimmedServerHost.slice(0, 49));
          const serverVal = new Uint8Array(3 + hostBytes.length);
          serverVal[0] = 0x80;
          serverVal[1] = (port >>> 8) & 0xff;
          serverVal[2] = port & 0xff;
          serverVal.set(hostBytes, 3);
          writes.push({ key: 0x43, value: serverVal });
        }
        return writes;
      }
      case 'reporting': {
        const parsedUploadInterval = Number(uploadIntervalInput);
        if (!Number.isFinite(parsedUploadInterval) || parsedUploadInterval <= 0) {
          return [];
        }
        const uploadInterval = clampInt(parsedUploadInterval, 10, 86400);
        const heartbeatInterval = clampInt(identity?.heartbeatInterval ?? 200, 60, 86400);
        const lazyUploadInterval = clampInt(
          Math.max(identity?.lazyUploadInterval ?? 600, uploadInterval),
          300,
          86400,
        );
        return [{
          key: 0x44,
          value: Uint8Array.from([
            ...u32le(0x80000000 + heartbeatInterval),
            ...u32le(uploadInterval),
            ...u32le(lazyUploadInterval),
          ]),
        }];
      }
      case 'audio':
        return [
          { key: 0x10, value: u8(clampInt(Number(ringtoneVol), 0, 100)) },
          { key: 0x11, value: u8(clampInt(Number(micVol), 0, 15)) },
          { key: 0x12, value: u8(clampInt(Number(speakerVol), 0, 100)) },
        ];
      case 'alarm':
        return [buildAlarmClockWriteBlock(), buildNoDisturbWriteBlock()];
      case 'alerts': {
        const writes: WriteBlock[] = [
          buildNoMotionWriteBlock(),
          buildTiltWriteBlock(),
          buildFallWriteBlock(),
        ];
        const geoWrite = buildGeoAlertWriteBlock();
        if (geoWrite) writes.push(geoWrite);
        return writes;
      }
      case 'featureFlags':
        return [{ key: 0x0f, value: u32le(enableControl >>> 0) }];
      case 'smsTemplates':
        return [
          { key: 0x17, value: encodeEv07bAsciiSetting(smsGpsUrl, SMS_URL_MAX_LENGTH) },
          { key: 0x18, value: encodeEv07bAsciiSetting(smsWifiLbsUrl, SMS_URL_MAX_LENGTH) },
        ];
      case 'voicePrompts':
        return [{ key: 0x19, value: u32le(voicePromptMask >>> 0) }];
      case 'bluetoothAccess': {
        if (!whitelistDevice) return [];
        const macBytes = parseMacAddress(whitelistDevice);
        if (!macBytes) {
          throw new Error('Whitelist BLE device must use AA:BB:CC:DD:EE:FF format');
        }
        return [{ key: 0x16, value: Uint8Array.from([0x80, ...macBytes]) }];
      }
      default:
        return [];
    }
  }, [
    apnInput,
    apnPassInput,
    apnUserInput,
    buildAlarmClockWriteBlock,
    buildFallWriteBlock,
    buildGeoAlertWriteBlock,
    buildNoDisturbWriteBlock,
    buildNoMotionWriteBlock,
    buildTiltWriteBlock,
    deviceNameInput,
    enableControl,
    identity,
    mileageInput,
    micVol,
    pushAuthorizedNumber,
    ringtoneVol,
    serverHostInput,
    serverPortInput,
    smsGpsUrl,
    smsWifiLbsUrl,
    sosNumber,
    sosNumber2,
    sosNumber3,
    sosSlot,
    sosSlot2,
    sosSlot3,
    speakerVol,
    timezoneInput,
    uploadIntervalInput,
    voicePromptMask,
    whitelistDevice,
    workingMode,
  ]);

  const handleSectionSave = useCallback(async (section: ConfigSectionKey, label: string) => {
    try {
      setSavingSection(section);
      const writeBlocks = buildSectionWriteBlocks(section);
      if (writeBlocks.length === 0) {
        setStatusMsg(`Nothing to save for ${label.toLowerCase()}`);
        return;
      }
      const seqId = await sendWriteBlocks(label, writeBlocks, label);
      if (section === 'general') {
        try {
          const syncResp = await sendEv07bConfig(deviceId, { readKeys: [0x09, 0x0a, 0x0e, 0x13] });
          setStatusMsg(`${label} saved${syncResp.seqId != null ? ` (seq ${syncResp.seqId})` : seqId != null ? ` (seq ${seqId})` : ''}`);
        } catch {
          // Best-effort refresh after general settings update.
        }
      } else if (section === 'sos') {
        try {
          const syncResp = await sendEv07bConfig(deviceId, { readKeys: [0x30, 0x30, 0x30] });
          setStatusMsg(`${label} saved${syncResp.seqId != null ? ` (seq ${syncResp.seqId})` : seqId != null ? ` (seq ${seqId})` : ''}`);
        } catch {
          // Best-effort refresh after SOS update.
        }
      } else if (section === 'featureFlags') {
        try {
          const syncResp = await sendEv07bConfig(deviceId, { readKeys: [0x0f] });
          setStatusMsg(`${label} saved${syncResp.seqId != null ? ` (seq ${syncResp.seqId})` : seqId != null ? ` (seq ${seqId})` : ''}`);
        } catch {
          // Best-effort refresh after feature-flag update.
        }
      }
    } catch (e: any) {
      setStatusMsg(e.message || `${label} save failed`);
    } finally {
      setSavingSection(null);
    }
  }, [buildSectionWriteBlocks, deviceId, sendEv07bConfig, sendWriteBlocks]);

  const toggleCtrlBit = useCallback((bit: number) => {
    setEnableControl(prev => toggleEv07bFlag(prev, bit));
  }, []);

  const toggleVoicePromptBit = useCallback((bit: number) => {
    setVoicePromptMask(prev => toggleEv07bFlag(prev, bit));
  }, []);

  const toggleAlarmWorkdayBit = (bit: number) => {
    setAlarmWorkdayMask(prev => prev ^ (1 << bit));
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={22} color="#F28C28" />
        </TouchableOpacity>
        <Text style={styles.title}>{identity?.model || deviceNameInput.trim() || deviceName || 'Device'}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* ── Status & Actions ── */}
        <View style={styles.card}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, state === 'connected' ? styles.dotGreen : styles.dotGray]} />
            <Text style={styles.statusText}>{state}</Text>
          </View>
          <View style={styles.row}>
            <TouchableOpacity style={styles.primaryButton} onPress={runSync}>
              <Icon name="sync" size={16} color="#FFF" />
              <Text style={styles.primaryButtonText}>Sync Info</Text>
            </TouchableOpacity>
          </View>
          {statusMsg ? <Text style={styles.statusMsg}>{statusMsg}</Text> : null}
        </View>

        {/* ── Identity (read-only display) ── */}
        <CollapsibleSection
          title="Identity"
          icon="information-circle"
          expanded={expandedSections.identity}
          onToggle={() => toggleSection('identity')}
        >
          <DetailRow label="IMEI" value={identity?.imei || assignedImei || '—'} />
          <DetailRow label="ICCID" value={identity?.iccid || '—'} />
          <DetailRow label="Serial" value={identity?.serialNumber || '—'} />
          <DetailRow label="Model" value={identity?.model || '—'} />
          <DetailRow label="Battery" value={
            identity?.batteryLevel != null
              ? `${identity.batteryLevel}%${identity.batteryVoltage ? ` (${identity.batteryVoltage}mV)` : ''}`
              : '—'
          } />
          <DetailRow label="Firmware" value={identity?.firmwareRevision || '—'} />
          <DetailRow label="Firmware Build" value={identity?.firmwareBuildInfo || '—'} />
          <DetailRow label="Software" value={identity?.softwareRevision || '—'} />
          <DetailRow label="Version" value={identity?.versionInfo || '—'} />
          <DetailRow label="Hardware" value={identity?.hardwareRevision || '—'} />
          <DetailRow label="Manufacturer" value={identity?.manufacturer || '—'} />
          <DetailRow label="Timezone" value={
            identity?.timezone != null
              ? `${identity.timezone >= 0 ? '+' : ''}${Math.floor(identity.timezone * 15 / 60)}:${String(Math.abs(identity.timezone * 15) % 60).padStart(2, '0')}`
              : '—'
          } />
          <DetailRow label="Working Mode" value={
            identity?.workingMode !== undefined
              ? (WORKING_MODES[identity.workingMode] ?? String(identity.workingMode + 1))
              : '—'
          } />
          <DetailRow label="Alarm" value={
            identity?.alarmClockHour !== undefined && identity?.alarmClockMinute !== undefined
              ? `${identity.alarmClockEnabled ? 'On' : 'Off'} • Slot ${identity.alarmClockIndex ?? 1} • ${formatTime(identity.alarmClockHour, identity.alarmClockMinute)}`
              : '—'
          } />
          <DetailRow label="Alarm Repeat" value={formatWorkdayMask(identity?.alarmClockWorkdayMask)} />
          <DetailRow label="DND" value={
            identity?.noDisturbStart !== undefined && identity?.noDisturbEnd !== undefined
              ? `${identity.noDisturbEnabled ? 'On' : 'Off'} • ${formatTime(Math.floor(identity.noDisturbStart / 60), identity.noDisturbStart % 60)}-${formatTime(Math.floor(identity.noDisturbEnd / 60), identity.noDisturbEnd % 60)}`
              : '—'
          } />
          <DetailRow label="Fall Alarm" value={formatFallDownSummary(identity)} />
          <DetailRow label="No Motion" value={formatNoMotionSummary(identity)} />
          <DetailRow label="Tilt Alarm" value={formatTiltSummary(identity)} />
          <DetailRow label="Geo Fence" value={formatGeoAlertSummary(identity)} />
          <DetailRow label="Feature Flags" value={formatFlagCount(identity?.enableControl, EV07B_ENABLE_CONTROL_FLAGS)} />
          <DetailRow label="Voice Prompts" value={formatFlagCount(identity?.voicePromptMask, EV07B_VOICE_PROMPT_FLAGS)} />
          <DetailRow label="SMS GPS URL" value={identity?.smsGpsUrl || '—'} />
          <DetailRow label="SMS WiFi/LBS URL" value={identity?.smsWifiLbsUrl || '—'} />
          <DetailRow label="SOS #1" value={identity?.sosNumber || '—'} />
          <DetailRow label="SOS #2" value={identity?.sosNumber2 || '—'} />
          <DetailRow label="SOS #3" value={identity?.sosNumber3 || '—'} />
          <DetailRow label="APN" value={identity?.apn || '—'} />
          <DetailRow label="Server" value={
            identity?.serverAddress
              ? `${identity.serverAddress}${identity.serverPort ? `:${identity.serverPort}` : ''}`
              : '—'
          } />
          <DetailRow label="Upload Interval" value={identity?.uploadInterval ? `${identity.uploadInterval}s` : '—'} />
          <DetailRow label="Mileage" value={identity?.initMileage != null ? `${identity.initMileage}m` : '—'} />
        </CollapsibleSection>

        {/* ── General Settings ── */}
        <CollapsibleSection
          title="General Settings"
          icon="settings"
          expanded={expandedSections.general}
          onToggle={() => toggleSection('general')}
          onSave={() => handleSectionSave('general', 'General settings')}
          saving={savingSection === 'general'}
        >
          <Text style={styles.fieldLabel}>Timezone (15-min units, e.g. 22 = +5:30)</Text>
          <TextInput style={styles.input} value={timezoneInput} onChangeText={setTimezoneInput}
            keyboardType="number-pad" placeholder="22" />

          <Text style={styles.fieldLabel}>Working Mode</Text>
          <View style={styles.modeRow}>
            {WORKING_MODES.map((label, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.modeChip, workingMode === i && styles.modeChipActive]}
                onPress={() => setWorkingMode(i)}
              >
                <Text style={[styles.modeChipText, workingMode === i && styles.modeChipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Initialize Mileage (meters)</Text>
          <TextInput style={styles.input} value={mileageInput} onChangeText={setMileageInput}
            keyboardType="number-pad" placeholder="0" />
        </CollapsibleSection>

        {/* ── SOS Numbers ── */}
        <CollapsibleSection
          title="SOS / Authorized Numbers"
          icon="call"
          expanded={expandedSections.sos}
          onToggle={() => toggleSection('sos')}
          onSave={() => handleSectionSave('sos', 'SOS numbers')}
          saving={savingSection === 'sos'}
        >
          <Text style={styles.helperText}>
            Enter digits only, including country code. Example: `919500001488`
          </Text>
          <Text style={styles.groupLabel}>SOS Slot 1</Text>
          <TextInput style={styles.input} value={sosNumber} onChangeText={setSosNumber}
            placeholder="919500001488" keyboardType="phone-pad" />
          <Text style={styles.fieldLabel}>Slot ID (0–9)</Text>
          <TextInput style={styles.input} value={sosSlot} onChangeText={setSosSlot}
            keyboardType="number-pad" placeholder="0" maxLength={1} />

          <View style={styles.divider} />
          <Text style={styles.groupLabel}>SOS Slot 2</Text>
          <TextInput style={styles.input} value={sosNumber2} onChangeText={setSosNumber2}
            placeholder="910000000000" keyboardType="phone-pad" />
          <Text style={styles.fieldLabel}>Slot ID</Text>
          <TextInput style={styles.input} value={sosSlot2} onChangeText={setSosSlot2}
            keyboardType="number-pad" placeholder="1" maxLength={1} />

          <View style={styles.divider} />
          <Text style={styles.groupLabel}>SOS Slot 3</Text>
          <TextInput style={styles.input} value={sosNumber3} onChangeText={setSosNumber3}
            placeholder="910000000000" keyboardType="phone-pad" />
          <Text style={styles.fieldLabel}>Slot ID</Text>
          <TextInput style={styles.input} value={sosSlot3} onChangeText={setSosSlot3}
            keyboardType="number-pad" placeholder="2" maxLength={1} />
        </CollapsibleSection>

        {/* ── Reporting ── */}
        <CollapsibleSection
          title="Reporting"
          icon="timer"
          expanded={expandedSections.reporting}
          onToggle={() => toggleSection('reporting')}
          onSave={() => handleSectionSave('reporting', 'Reporting')}
          saving={savingSection === 'reporting'}
        >
          <Text style={styles.fieldLabel}>Auto Upload Interval (seconds, 0 = unchanged)</Text>
          <TextInput style={styles.input} value={uploadIntervalInput} onChangeText={setUploadIntervalInput}
            placeholder="60" keyboardType="number-pad" />
        </CollapsibleSection>

        {/* ── Audio / Volume ── */}
        <CollapsibleSection
          title="Audio & Volume"
          icon="volume-high"
          expanded={expandedSections.audio}
          onToggle={() => toggleSection('audio')}
          onSave={() => handleSectionSave('audio', 'Audio settings')}
          saving={savingSection === 'audio'}
        >
          <Text style={styles.fieldLabel}>Ring-Tone Volume (0–100)</Text>
          <TextInput style={styles.input} value={ringtoneVol} onChangeText={setRingtoneVol}
            keyboardType="number-pad" placeholder="100" maxLength={3} />
          <Text style={styles.fieldLabel}>Mic Volume (0–15)</Text>
          <TextInput style={styles.input} value={micVol} onChangeText={setMicVol}
            keyboardType="number-pad" placeholder="10" maxLength={2} />
          <Text style={styles.fieldLabel}>Speaker Volume (0–100)</Text>
          <TextInput style={styles.input} value={speakerVol} onChangeText={setSpeakerVol}
            keyboardType="number-pad" placeholder="100" maxLength={3} />
        </CollapsibleSection>

        {/* ── Alarm & No Disturb ── */}
        <CollapsibleSection
          title="Alarm & Do Not Disturb"
          icon="alarm"
          expanded={expandedSections.alarm}
          onToggle={() => toggleSection('alarm')}
          onSave={() => handleSectionSave('alarm', 'Alarm settings')}
          saving={savingSection === 'alarm'}
        >
          <Text style={styles.groupLabel}>Alarm Clock</Text>
          <ToggleRow
            label="Alarm Enabled"
            value={alarmEnabled}
            onValueChange={setAlarmEnabled}
          />
          <Text style={styles.fieldLabel}>Alarm Slot</Text>
          <View style={styles.modeRow}>
            {ALARM_SLOT_OPTIONS.map(slot => (
              <TouchableOpacity
                key={slot}
                style={[styles.modeChip, alarmIndex === slot && styles.modeChipActive]}
                onPress={() => setAlarmIndex(slot)}
              >
                <Text style={[styles.modeChipText, alarmIndex === slot && styles.modeChipTextActive]}>{slot}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.fieldLabel}>Hour (0–23)</Text>
              <TextInput style={styles.input} value={alarmHour} onChangeText={setAlarmHour}
                keyboardType="number-pad" placeholder="8" maxLength={2} />
            </View>
            <View style={styles.timeField}>
              <Text style={styles.fieldLabel}>Minute (0–59)</Text>
              <TextInput style={styles.input} value={alarmMinute} onChangeText={setAlarmMinute}
                keyboardType="number-pad" placeholder="0" maxLength={2} />
            </View>
          </View>
          <Text style={styles.fieldLabel}>Repeat Days</Text>
          <View style={styles.weekdayRow}>
            {EV07B_WEEKDAY_OPTIONS.map(option => {
              const isActive = (alarmWorkdayMask & (1 << option.bit)) !== 0;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.weekdayChip, isActive && styles.weekdayChipActive]}
                  onPress={() => toggleAlarmWorkdayBit(option.bit)}
                >
                  <Text style={[styles.weekdayChipText, isActive && styles.weekdayChipTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helperText}>
            If no day is selected, the app saves this as an everyday alarm so the enable flag sticks on device firmware.
          </Text>
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.fieldLabel}>Reminder Duration (1–120 sec)</Text>
              <TextInput style={styles.input} value={alarmDurationSec} onChangeText={setAlarmDurationSec}
                keyboardType="number-pad" placeholder="30" maxLength={3} />
            </View>
            <View style={styles.timeField}>
              <Text style={styles.fieldLabel}>Ringtone (1–10)</Text>
              <TextInput style={styles.input} value={alarmRing} onChangeText={setAlarmRing}
                keyboardType="number-pad" placeholder="1" maxLength={2} />
            </View>
          </View>

          <View style={styles.divider} />
          <Text style={styles.groupLabel}>Do Not Disturb</Text>
          <ToggleRow
            label="Enabled"
            value={noDisturbEnabled}
            onValueChange={setNoDisturbEnabled}
          />
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.fieldLabel}>Start Hour</Text>
              <TextInput style={styles.input} value={ndStartHour} onChangeText={setNdStartHour}
                keyboardType="number-pad" placeholder="22" maxLength={2} />
            </View>
            <View style={styles.timeField}>
              <Text style={styles.fieldLabel}>Start Min</Text>
              <TextInput style={styles.input} value={ndStartMin} onChangeText={setNdStartMin}
                keyboardType="number-pad" placeholder="0" maxLength={2} />
            </View>
          </View>
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.fieldLabel}>End Hour</Text>
              <TextInput style={styles.input} value={ndEndHour} onChangeText={setNdEndHour}
                keyboardType="number-pad" placeholder="7" maxLength={2} />
            </View>
            <View style={styles.timeField}>
              <Text style={styles.fieldLabel}>End Min</Text>
              <TextInput style={styles.input} value={ndEndMin} onChangeText={setNdEndMin}
                keyboardType="number-pad" placeholder="0" maxLength={2} />
            </View>
          </View>
        </CollapsibleSection>

        {/* ── Safety Alerts ── */}
        <CollapsibleSection
          title="Safety Alerts"
          icon="warning"
          expanded={expandedSections.alerts}
          onToggle={() => toggleSection('alerts')}
          onSave={() => handleSectionSave('alerts', 'Safety alerts')}
          saving={savingSection === 'alerts'}
        >
          <Text style={styles.groupLabel}>Fall Alarm</Text>
          <ToggleRow
            label="Enabled"
            value={fallDownAlertEnabled}
            onValueChange={setFallDownAlertEnabled}
          />
          <ToggleRow
            label="Dial Authorized Number"
            value={fallDownAlertDial}
            onValueChange={setFallDownAlertDial}
          />
          <Text style={styles.fieldLabel}>Sensitivity (1-9)</Text>
          <TextInput style={styles.input} value={fallDownAlertSensitivity} onChangeText={setFallDownAlertSensitivity}
            keyboardType="number-pad" placeholder="5" maxLength={1} />

          <View style={styles.divider} />
          <Text style={styles.groupLabel}>No Motion Alarm</Text>
          <ToggleRow
            label="Enabled"
            value={noMotionAlertEnabled}
            onValueChange={setNoMotionAlertEnabled}
          />
          <ToggleRow
            label="Dial Authorized Number"
            value={noMotionAlertDial}
            onValueChange={setNoMotionAlertDial}
          />
          <Text style={styles.fieldLabel}>Static Period (60-36000 sec)</Text>
          <TextInput style={styles.input} value={noMotionAlertStaticPeriodSec} onChangeText={setNoMotionAlertStaticPeriodSec}
            keyboardType="number-pad" placeholder="300" maxLength={5} />

          <View style={styles.divider} />
          <Text style={styles.groupLabel}>Tilt Alarm</Text>
          <ToggleRow
            label="Enabled"
            value={tiltAlertEnabled}
            onValueChange={setTiltAlertEnabled}
          />
          <ToggleRow
            label="Dial Authorized Number"
            value={tiltAlertDial}
            onValueChange={setTiltAlertDial}
          />
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.fieldLabel}>Angle (30-90 deg)</Text>
              <TextInput style={styles.input} value={tiltAlertAngleDeg} onChangeText={setTiltAlertAngleDeg}
                keyboardType="number-pad" placeholder="45" maxLength={2} />
            </View>
            <View style={styles.timeField}>
              <Text style={styles.fieldLabel}>Duration (10-3600 sec)</Text>
              <TextInput style={styles.input} value={tiltAlertDurationSec} onChangeText={setTiltAlertDurationSec}
                keyboardType="number-pad" placeholder="30" maxLength={4} />
            </View>
          </View>

          <View style={styles.divider} />
          <Text style={styles.groupLabel}>Geo Fence</Text>
          <ToggleRow
            label="Enabled"
            value={geoAlertEnabled}
            onValueChange={setGeoAlertEnabled}
          />
          <Text style={styles.fieldLabel}>Fence Slot (0-15)</Text>
          <TextInput style={styles.input} value={geoAlertIndex} onChangeText={setGeoAlertIndex}
            keyboardType="number-pad" placeholder="0" maxLength={2} />

          <Text style={styles.fieldLabel}>Direction</Text>
          <View style={styles.modeRow}>
            {GEO_ALERT_DIRECTIONS.map(option => (
              <TouchableOpacity
                key={option.value}
                style={[styles.modeChip, geoAlertDirection === option.value && styles.modeChipActive]}
                onPress={() => setGeoAlertDirection(option.value)}
              >
                <Text style={[styles.modeChipText, geoAlertDirection === option.value && styles.modeChipTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Shape</Text>
          <View style={styles.modeRow}>
            {GEO_ALERT_TYPES.map(option => (
              <TouchableOpacity
                key={option.value}
                style={[styles.modeChip, geoAlertType === option.value && styles.modeChipActive]}
                onPress={() => setGeoAlertType(option.value)}
              >
                <Text style={[styles.modeChipText, geoAlertType === option.value && styles.modeChipTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {geoAlertType === 'circle' ? (
            <>
              <Text style={styles.fieldLabel}>Radius (meters)</Text>
              <TextInput style={styles.input} value={geoAlertRadiusMeters} onChangeText={setGeoAlertRadiusMeters}
                keyboardType="number-pad" placeholder="100" maxLength={5} />
              <View style={styles.timeRow}>
                <View style={styles.timeField}>
                  <Text style={styles.fieldLabel}>Latitude</Text>
                  <TextInput style={styles.input} value={geoAlertLatitude} onChangeText={setGeoAlertLatitude}
                    keyboardType="decimal-pad" placeholder="12.97160" />
                </View>
                <View style={styles.timeField}>
                  <Text style={styles.fieldLabel}>Longitude</Text>
                  <TextInput style={styles.input} value={geoAlertLongitude} onChangeText={setGeoAlertLongitude}
                    keyboardType="decimal-pad" placeholder="77.59460" />
                </View>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.fieldLabel}>Polygon Points</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={geoAlertPointsInput}
                onChangeText={setGeoAlertPointsInput}
                placeholder={'12.97160, 77.59460\n12.97210, 77.59520\n12.97080, 77.59590'}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                textAlignVertical="top"
              />
              <Text style={styles.helperText}>
                Enter one `latitude, longitude` pair per line. Polygon fences need at least 3 points.
              </Text>
            </>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Device Feature Flags"
          icon="toggle"
          expanded={expandedSections.featureFlags}
          onToggle={() => toggleSection('featureFlags')}
          onSave={() => handleSectionSave('featureFlags', 'Device feature flags')}
          saving={savingSection === 'featureFlags'}
        >
          <Text style={styles.groupLabel}>Enable Control Flags</Text>
          <Text style={styles.helperText}>
            These toggles are stored in the device&apos;s 32-bit enable-control mask and now round-trip through Sync Info.
          </Text>
          {EV07B_ENABLE_CONTROL_FLAGS.map(flag => (
            <ToggleRow
              key={flag.key}
              label={`${flag.label} (bit ${flag.bit})`}
              value={hasEv07bFlag(enableControl, flag.bit)}
              onValueChange={() => {
                toggleCtrlBit(flag.bit);
              }}
            />
          ))}
        </CollapsibleSection>

        {/* ── GATT Services ── */}
        <CollapsibleSection
          title="GATT Services"
          icon="git-network"
          expanded={expandedSections.gatt}
          onToggle={() => toggleSection('gatt')}
        >
          {services.length === 0 ? (
            <Text style={styles.subtitle}>No services cached.</Text>
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
                    <Text style={styles.groupLabel}>Notify/Indicate</Text>
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
        </CollapsibleSection>

        {/* ── Latest Data ── */}
        <CollapsibleSection
          title="Latest Data (cmd 0x01)"
          icon="analytics"
          expanded={expandedSections.data}
          onToggle={() => toggleSection('data')}
        >
          {!dataSnapshot ? (
            <Text style={styles.subtitle}>No data packet received yet.</Text>
          ) : (
            <>
              <Text style={styles.subtitle}>
                Received: {new Date(dataSnapshot.receivedAt).toLocaleString()}
              </Text>
              {renderDataField('IMEI (0x01)', dataSnapshot.keys[0x01])}
              {renderDataField('ICCID (0x04)', dataSnapshot.keys[0x04])}
              {renderDataField('GPS (0x20)', dataSnapshot.keys[0x20])}
              {renderDataField('Cell tower (0x21/0x29)', dataSnapshot.keys[0x21] ?? dataSnapshot.keys[0x29])}
              {renderDataField('WiFi (0x22)', dataSnapshot.keys[0x22])}
              {renderDataField('BLE location (0x23/0x26)', dataSnapshot.keys[0x23] ?? dataSnapshot.keys[0x26])}
              {renderDataField('Status (0x24)', dataSnapshot.keys[0x24])}
              {renderDataField('Alarm (0x02)', dataSnapshot.keys[0x02])}
            </>
          )}
        </CollapsibleSection>

        {/* ── Raw BLE Log ── */}
        <CollapsibleSection
          title="Raw BLE Log"
          icon="terminal"
          expanded={expandedSections.log}
          onToggle={() => toggleSection('log')}
        >
          {bleLog.length === 0 ? (
            <Text style={styles.subtitle}>No BLE data exchanged yet. Tap Sync Info above.</Text>
          ) : (
            bleLog.map((entry, i) => (
              <Text key={i} style={styles.logEntry}>{entry}</Text>
            ))
          )}
        </CollapsibleSection>
      </ScrollView>
    </SafeAreaView>
  );
};

/* ── Sub-components ── */

const CollapsibleSection = ({
  title, icon, expanded, onToggle, children, onSave, saving,
}: {
  title: string;
  icon: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  onSave?: () => void;
  saving?: boolean;
}) => (
  <View style={styles.card}>
    <View style={styles.sectionHeader}>
      <TouchableOpacity style={styles.sectionHeaderMain} onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.sectionHeaderLeft}>
          <Icon name={icon as any} size={18} color="#F28C28" />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.sectionHeaderActions}>
        {onSave ? (
          <TouchableOpacity
            style={[styles.inlineSaveButton, saving && styles.inlineSaveButtonDisabled]}
            onPress={onSave}
            disabled={saving}
          >
            <Icon name="save" size={14} color="#F28C28" />
            <Text style={styles.inlineSaveButtonText}>{saving ? 'Saving' : 'Save'}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#7A726A" />
        </TouchableOpacity>
      </View>
    </View>
    {expanded ? <View style={styles.sectionContent}>{children}</View> : null}
  </View>
);

const ToggleRow = ({
  label, value, onValueChange, disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) => (
  <View style={styles.toggleRow}>
    <Text style={styles.toggleLabel}>{label}</Text>
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: '#D4CFC8', true: '#F7C68E' }}
      thumbColor={value ? '#F28C28' : '#AAA49D'}
    />
  </View>
);

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

const renderDataField = (label: string, val?: Uint8Array) => {
  if (!val) return null;
  const hex = Buffer.from(val).toString('hex');
  const ascii = Buffer.from(val).toString('ascii').replace(/\0+$/, '').trim();
  return (
    <View style={styles.detailRow} key={label}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Text style={styles.detailValue}>{ascii || '—'}</Text>
        <Text style={styles.charMeta}>{hex}</Text>
      </View>
    </View>
  );
};

/* ── Styles ── */

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
  content: { paddingBottom: 32 },

  /* Card & Sections */
  card: {
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeaderMain: {
    flex: 1,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#2E2A27', marginLeft: 8 },
  sectionContent: { marginTop: 12 },

  /* Status */
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  dotGreen: { backgroundColor: '#4CAF50' },
  dotGray: { backgroundColor: '#BDBDBD' },
  statusText: { fontSize: 14, fontWeight: '600', color: '#2E2A27', textTransform: 'capitalize' },
  statusMsg: { fontSize: 12, color: '#7A726A', textAlign: 'center', marginTop: 8 },

  /* Buttons */
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F28C28',
    borderRadius: 12,
    paddingVertical: 10,
    marginRight: 6,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6F1EA',
    borderRadius: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#F1E2CF',
    marginLeft: 6,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700', marginLeft: 6 },
  secondaryButtonText: { color: '#F28C28', fontWeight: '700', marginLeft: 6 },
  inlineSaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F6F1EA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#F1E2CF',
    marginRight: 10,
  },
  inlineSaveButtonDisabled: {
    opacity: 0.7,
  },
  inlineSaveButtonText: {
    color: '#F28C28',
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 5,
  },

  /* Detail rows */
  subtitle: { fontSize: 13, color: '#7A726A', marginBottom: 8 },
  divider: { height: 1, backgroundColor: '#EFE7DD', marginVertical: 10 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  detailLabel: { fontSize: 13, color: '#7A726A' },
  detailValue: { fontSize: 13, color: '#2E2A27', fontWeight: '600', maxWidth: '55%', textAlign: 'right' },

  /* Form fields */
  groupLabel: { fontSize: 13, fontWeight: '700', color: '#7A726A', marginTop: 8, marginBottom: 4 },
  fieldLabel: { fontSize: 12, color: '#7A726A', marginTop: 10, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#EFE7DD',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#2E2A27',
    backgroundColor: '#FAFAF8',
  },
  multilineInput: {
    minHeight: 92,
    paddingTop: 10,
  },

  /* Mode chips */
  modeRow: { flexDirection: 'row', marginTop: 4 },
  modeChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EFE7DD',
    alignItems: 'center',
    marginHorizontal: 3,
    backgroundColor: '#FAFAF8',
  },
  modeChipActive: {
    backgroundColor: '#F28C28',
    borderColor: '#F28C28',
  },
  modeChipText: { fontSize: 12, color: '#7A726A', fontWeight: '600' },
  modeChipTextActive: { color: '#FFFFFF' },
  weekdayRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  weekdayChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#EFE7DD',
    backgroundColor: '#FAFAF8',
    marginRight: 8,
    marginBottom: 8,
  },
  weekdayChipActive: {
    backgroundColor: '#F28C28',
    borderColor: '#F28C28',
  },
  weekdayChipText: { fontSize: 12, color: '#7A726A', fontWeight: '600' },
  weekdayChipTextActive: { color: '#FFFFFF' },
  helperText: { fontSize: 12, color: '#7A726A', marginTop: 2, lineHeight: 17 },

  /* Toggle row */
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  toggleLabel: { fontSize: 13, color: '#2E2A27' },

  /* Time fields */
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timeField: { flex: 1, marginHorizontal: 3 },

  /* GATT */
  serviceBlock: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#EFE7DD', paddingTop: 10 },
  serviceTitle: { fontSize: 13, fontWeight: '700', color: '#2E2A27', marginBottom: 6 },
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
  charLabel: { fontSize: 12, color: '#555', fontWeight: '600' },

  /* Log */
  logEntry: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#2E2A27',
    marginBottom: 3,
    lineHeight: 16,
  },
});

export default DeviceDetailScreen;
