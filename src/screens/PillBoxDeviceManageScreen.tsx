import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { DeviceStackParamList } from '../types/navigation';
import { usePillBox } from '../pillbox/PillBoxBleProvider';

type RouteParams = {
  deviceId: string;
  deviceName?: string | null;
};

const normalizeId = (id?: string | null) => (id ?? '').trim().toLowerCase();

const formatTime = (date: Date) => {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const daysOfWeek = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

const PillBoxDeviceManageScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<DeviceStackParamList>>();
  const route = useRoute();
  const { deviceId, deviceName } = (route.params as RouteParams) ?? {};
  const {
    connectionStates,
    activeSnapshot,
    getDeviceSnapshot,
    refreshSnapshot,
    disconnect,
    setAlarm,
    setTimeFormat,
    setVolume,
    setRingType,
    setReminderDuration,
    unbind,
  } = usePillBox();

  const snapshot = getDeviceSnapshot(deviceId) ?? activeSnapshot;
  const state = connectionStates[normalizeId(deviceId)] ?? snapshot?.state ?? 'disconnected';
  const connected = state === 'connected' || state === 'dataSynced';

  const [refreshing, setRefreshing] = useState(false);
  const [savingAlarm, setSavingAlarm] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [alarmSlot, setAlarmSlot] = useState('1');
  const [alarmTime, setAlarmTime] = useState(() => formatTime(new Date(Date.now() + 60 * 60 * 1000)));
  const [alarmRemark, setAlarmRemark] = useState('Medicine reminder');
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [repeatDays, setRepeatDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [timePickerDate, setTimePickerDate] = useState(new Date());

  const snapshotAlarms = useMemo(() => snapshot?.alarms ?? [], [snapshot?.alarms]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshSnapshot();
    } catch {
      // best-effort refresh
    } finally {
      setRefreshing(false);
    }
  }, [refreshSnapshot]);

  useFocusEffect(
    useCallback(() => {
      if (!connected) return;
      handleRefresh().catch(() => {});
    }, [connected, handleRefresh]),
  );

  useEffect(() => {
    if (snapshot?.nextAlarmTime) {
      setAlarmTime(snapshot.nextAlarmTime);
    }
  }, [snapshot?.nextAlarmTime]);

  const toggleDay = useCallback((day: number) => {
    setRepeatDays(prev => {
      if (prev.includes(day)) {
        return prev.filter(item => item !== day);
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  }, []);

  const openTimePicker = useCallback(() => {
    const next = new Date();
    const [hours, minutes] = alarmTime.split(':').map(part => Number(part));
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      next.setHours(hours, minutes, 0, 0);
    }
    setTimePickerDate(next);
    setShowTimePicker(true);
  }, [alarmTime]);

  const handleTimePicked = useCallback((event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS !== 'ios') {
      if (event.type === 'dismissed' || !value) {
        setShowTimePicker(false);
        return;
      }
      setAlarmTime(formatTime(value));
      setShowTimePicker(false);
      return;
    }

    if (value) {
      setTimePickerDate(value);
    }
  }, []);

  const saveAlarm = useCallback(async () => {
    const slot = Number(alarmSlot);
    if (!Number.isFinite(slot) || slot < 0) {
      Alert.alert('Pill dispenser', 'Enter a valid alarm slot number.');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(alarmTime)) {
      Alert.alert('Pill dispenser', 'Choose a valid alarm time.');
      return;
    }

    setSavingAlarm(true);
    try {
      await setAlarm({
        slot,
        time: alarmTime,
        enabled: alarmEnabled,
        repeatDays,
        remark: alarmRemark,
      });
      Alert.alert('Pill dispenser', 'Alarm saved successfully.');
      await refreshSnapshot();
    } catch (error) {
      Alert.alert(
        'Pill dispenser',
        error instanceof Error ? error.message : 'Failed to save alarm.',
      );
    } finally {
      setSavingAlarm(false);
    }
  }, [alarmEnabled, alarmRemark, alarmSlot, alarmTime, refreshSnapshot, repeatDays, setAlarm]);

  const applyQuickSetting = useCallback(async (kind: 'timeFormat' | 'volume' | 'ring' | 'duration', value: number) => {
    try {
      if (kind === 'timeFormat') {
        await setTimeFormat(value);
      } else if (kind === 'volume') {
        await setVolume(value);
      } else if (kind === 'ring') {
        await setRingType(value);
      } else {
        await setReminderDuration(value);
      }
      await refreshSnapshot();
    } catch (error) {
      Alert.alert(
        'Pill dispenser',
        error instanceof Error ? error.message : 'Unable to update device settings.',
      );
    }
  }, [refreshSnapshot, setReminderDuration, setRingType, setTimeFormat, setVolume]);

  const requestDisconnect = useCallback(() => {
    Alert.alert('Disconnect pill dispenser?', 'This will end the current Bluetooth session.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          disconnect(deviceId).catch(() => {});
        },
      },
    ]);
  }, [deviceId, disconnect]);

  const requestUnbind = useCallback(() => {
    Alert.alert('Unbind pill dispenser?', 'This will remove the device binding from the dispenser.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unbind',
        style: 'destructive',
        onPress: () => {
          unbind().catch(error => {
            Alert.alert(
              'Pill dispenser',
              error instanceof Error ? error.message : 'Unable to unbind the device.',
            );
          });
        },
      },
    ]);
  }, [unbind]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Icon name="chevron-back" size={22} color="#2E2A27" />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>{deviceName ?? 'Pill Dispenser'}</Text>
            <Text style={styles.headerSubtitle}>Independent alarm and sync controls</Text>
          </View>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{state}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connection</Text>
          <Text style={styles.cardSubtitle}>Device ID: {deviceId}</Text>
          <Text style={styles.metaLine}>Status: {state}</Text>
          <Text style={styles.metaLine}>
            Firmware: {snapshot?.firmwareVersion ?? '—'}
          </Text>
          <Text style={styles.metaLine}>
            Battery: {snapshot?.batteryPercent != null ? `${snapshot.batteryPercent}%` : '—'}
          </Text>
          <Text style={styles.metaLine}>
            Next alarm: {snapshot?.nextAlarmTime ?? '—'}
          </Text>
          <Text style={styles.metaLine}>
            Reminder duration: {snapshot?.durationMinutes != null ? `${snapshot.durationMinutes} min` : '—'}
          </Text>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionButton} onPress={() => handleRefresh()}>
              {refreshing ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Icon name="refresh" size={17} color="#FFFFFF" />
              )}
              <Text style={styles.actionButtonText}>
                {refreshing ? 'Refreshing' : 'Refresh'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.secondaryActionButton]}
              onPress={requestDisconnect}
              disabled={!connected}
            >
              <Icon name="log-out-outline" size={17} color="#8B5E34" />
              <Text style={[styles.actionButtonText, styles.secondaryActionButtonText]}>Disconnect</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.dangerButton} onPress={requestUnbind}>
            <Icon name="unlink-outline" size={16} color="#FFFFFF" />
            <Text style={styles.dangerButtonText}>Unbind Device</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quick Settings</Text>
          <Text style={styles.cardSubtitle}>Use the vendor SDK settings that are safe to expose in-app.</Text>

          <Text style={styles.sectionLabel}>Time format</Text>
          <View style={styles.pillRow}>
            <TouchableOpacity style={styles.pillButton} onPress={() => applyQuickSetting('timeFormat', 0)}>
              <Text style={styles.pillButtonText}>24h</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pillButton} onPress={() => applyQuickSetting('timeFormat', 1)}>
              <Text style={styles.pillButtonText}>12h</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>Volume</Text>
          <View style={styles.pillRow}>
            <TouchableOpacity style={styles.pillButton} onPress={() => applyQuickSetting('volume', 0)}>
              <Text style={styles.pillButtonText}>Mute</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pillButton} onPress={() => applyQuickSetting('volume', 1)}>
              <Text style={styles.pillButtonText}>Low</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pillButton} onPress={() => applyQuickSetting('volume', 2)}>
              <Text style={styles.pillButtonText}>High</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>Ring type</Text>
          <View style={styles.pillRow}>
            <TouchableOpacity style={styles.pillButton} onPress={() => applyQuickSetting('ring', 0)}>
              <Text style={styles.pillButtonText}>Tone 1</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pillButton} onPress={() => applyQuickSetting('ring', 1)}>
              <Text style={styles.pillButtonText}>Tone 2</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>Reminder duration</Text>
          <View style={styles.pillRow}>
            <TouchableOpacity style={styles.pillButton} onPress={() => applyQuickSetting('duration', 30)}>
              <Text style={styles.pillButtonText}>30 min</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pillButton} onPress={() => applyQuickSetting('duration', 60)}>
              <Text style={styles.pillButtonText}>60 min</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pillButton} onPress={() => applyQuickSetting('duration', 90)}>
              <Text style={styles.pillButtonText}>90 min</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Create Alarm</Text>
          <Text style={styles.cardSubtitle}>This uses the pill dispenser alarm slots and repeat-day model.</Text>

          <Text style={styles.fieldLabel}>Slot number</Text>
          <TextInput
            value={alarmSlot}
            onChangeText={setAlarmSlot}
            keyboardType="number-pad"
            placeholder="1"
            placeholderTextColor="#B0A59A"
            style={styles.textInput}
          />

          <Text style={styles.fieldLabel}>Alarm time</Text>
          <TouchableOpacity style={styles.timeButton} onPress={openTimePicker}>
            <Text style={styles.timeButtonText}>{alarmTime}</Text>
            <Icon name="time-outline" size={18} color="#8B5E34" />
          </TouchableOpacity>

          <Text style={styles.fieldLabel}>Remark</Text>
          <TextInput
            value={alarmRemark}
            onChangeText={setAlarmRemark}
            placeholder="Morning medicine"
            placeholderTextColor="#B0A59A"
            style={styles.textInput}
          />

          <View style={styles.switchRow}>
            <View>
              <Text style={styles.fieldLabel}>Enabled</Text>
              <Text style={styles.helpText}>Turn this alarm on or off before saving.</Text>
            </View>
            <Switch
              value={alarmEnabled}
              onValueChange={setAlarmEnabled}
              trackColor={{ false: '#D9CEC1', true: '#F4B36A' }}
              thumbColor={alarmEnabled ? '#FFFFFF' : '#FFFFFF'}
            />
          </View>

          <Text style={styles.fieldLabel}>Repeat days</Text>
          <View style={styles.weekRow}>
            {daysOfWeek.map(day => {
              const selected = repeatDays.includes(day.value);
              return (
                <TouchableOpacity
                  key={day.value}
                  style={[styles.weekChip, selected ? styles.weekChipActive : null]}
                  onPress={() => toggleDay(day.value)}
                >
                  <Text style={[styles.weekChipText, selected ? styles.weekChipTextActive : null]}>
                    {day.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={styles.saveButton} onPress={saveAlarm} disabled={savingAlarm}>
            {savingAlarm ? <ActivityIndicator color="#FFFFFF" /> : <Icon name="save-outline" size={18} color="#FFFFFF" />}
            <Text style={styles.saveButtonText}>{savingAlarm ? 'Saving...' : 'Save Alarm'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Alarm List</Text>
          <Text style={styles.cardSubtitle}>Latest alarms read back from the dispenser.</Text>
          {snapshotAlarms.length === 0 ? (
            <Text style={styles.emptyText}>No alarms available yet.</Text>
          ) : (
            snapshotAlarms.map((alarm, index) => (
              <View key={`${alarm.alarmId ?? alarm.row ?? index}`} style={styles.alarmRow}>
                <View style={styles.alarmMain}>
                  <Text style={styles.alarmTime}>{alarm.alarmTime ?? '—'}</Text>
                  <Text style={styles.alarmRemark}>{alarm.remark ?? 'No remark'}</Text>
                  <Text style={styles.alarmMeta}>
                    Slot: {alarm.row != null ? alarm.row : '—'} · {alarm.enabled ? 'Enabled' : 'Disabled'}
                  </Text>
                  <Text style={styles.alarmMeta}>
                    Repeat: {alarm.effectWeekdays.length > 0 ? alarm.effectWeekdays.join(', ') : '—'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={showTimePicker} transparent animationType="fade" onRequestClose={() => setShowTimePicker(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select alarm time</Text>
            <DateTimePicker
              value={timePickerDate}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, value) => {
                if (Platform.OS === 'ios') {
                  if (value) {
                    setTimePickerDate(value);
                    setAlarmTime(formatTime(value));
                  }
                  return;
                }
                handleTimePicked(event, value);
              }}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setShowTimePicker(false)}>
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButtonPrimary}
                onPress={() => {
                  setAlarmTime(formatTime(timePickerDate));
                  setShowTimePicker(false);
                }}
              >
                <Text style={styles.modalButtonPrimaryText}>Use Time</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

export default PillBoxDeviceManageScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F2EE',
  },
  content: {
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 6,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginRight: 10,
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2E2A27',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#7A726A',
    marginTop: 2,
  },
  statusPill: {
    backgroundColor: '#F3E3D3',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8B5E34',
    textTransform: 'capitalize',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
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
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#7A726A',
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 18,
  },
  metaLine: {
    fontSize: 13,
    color: '#534A42',
    lineHeight: 18,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 14,
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#C86A12',
    paddingVertical: 12,
    borderRadius: 18,
  },
  secondaryActionButton: {
    backgroundColor: '#F5E8DA',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 6,
  },
  secondaryActionButtonText: {
    color: '#8B5E34',
  },
  dangerButton: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A94A2F',
    paddingVertical: 12,
    borderRadius: 18,
  },
  dangerButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 6,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#51463D',
    marginTop: 6,
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  pillButton: {
    backgroundColor: '#F3E5D8',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
  },
  pillButtonText: {
    color: '#7B5835',
    fontSize: 12,
    fontWeight: '700',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#51463D',
    marginTop: 10,
    marginBottom: 6,
  },
  helpText: {
    fontSize: 11,
    color: '#8C7D70',
    marginTop: 2,
  },
  textInput: {
    backgroundColor: '#FAF6F2',
    borderColor: '#E9DDCF',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    color: '#2E2A27',
  },
  timeButton: {
    backgroundColor: '#FAF6F2',
    borderColor: '#E9DDCF',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeButtonText: {
    color: '#2E2A27',
    fontSize: 14,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  weekRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  weekChip: {
    minWidth: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 15,
    backgroundColor: '#F4E8DC',
  },
  weekChipActive: {
    backgroundColor: '#C86A12',
  },
  weekChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7B5835',
  },
  weekChipTextActive: {
    color: '#FFFFFF',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#C86A12',
    paddingVertical: 13,
    borderRadius: 18,
    marginTop: 16,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 6,
  },
  emptyText: {
    fontSize: 13,
    color: '#7A726A',
    textAlign: 'center',
    lineHeight: 18,
  },
  alarmRow: {
    backgroundColor: '#FBF7F2',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F2E4D4',
    marginBottom: 10,
  },
  alarmMain: {
    flex: 1,
  },
  alarmTime: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2E2A27',
    marginBottom: 2,
  },
  alarmRemark: {
    fontSize: 13,
    color: '#6F665C',
    marginBottom: 4,
  },
  alarmMeta: {
    fontSize: 12,
    color: '#85796B',
    lineHeight: 16,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2E2A27',
    marginBottom: 8,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  modalButtonSecondary: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#F1E4D6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  modalButtonSecondaryText: {
    color: '#7B5835',
    fontWeight: '700',
  },
  modalButtonPrimary: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#C86A12',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  modalButtonPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
