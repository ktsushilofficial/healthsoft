import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import {
  type PillDispenserAction,
  usePillDispenserManagement,
} from '../pillDispenser/usePillDispenserManagement';
import type {
  PillDispenserAlarmInput,
  PillDispenserOwnerProfile,
  PillDispenserPlanInput,
  PillDispenserSettingsInput,
} from '../pillDispenser/vendorTypes';

type Section = 'settings' | 'plan' | 'alarms' | 'actions';

type Option = {
  label: string;
  value: number;
};

function parseClockTime(value: string): Date {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  const date = new Date();
  date.setSeconds(0, 0);
  if (match) {
    date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  }
  return date;
}

function formatClockTime(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(
    value.getMinutes(),
  ).padStart(2, '0')}`;
}

function ClockTimePicker({
  value,
  onChange,
  disabled,
  is24Hour,
  accessibilityLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  is24Hour: boolean;
  accessibilityLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  const [pickerValue, setPickerValue] = useState(() =>
    parseClockTime(value),
  );

  const openPicker = () => {
    setPickerValue(parseClockTime(value));
    setVisible(true);
  };

  const handleChange = (event: DateTimePickerEvent, nextValue?: Date) => {
    if (Platform.OS === 'ios') {
      if (nextValue) setPickerValue(nextValue);
      return;
    }

    setVisible(false);
    if (event.type !== 'dismissed' && nextValue) {
      onChange(formatClockTime(nextValue));
    }
  };

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
        activeOpacity={0.7}
        style={[
          styles.timePickerButton,
          disabled ? styles.disabled : null,
        ]}
        onPress={openPicker}
      >
        <Text style={styles.timePickerValue}>{value}</Text>
        <Icon name="time-outline" size={20} color="#F28C28" />
      </TouchableOpacity>

      {Platform.OS === 'android' && visible ? (
        <DateTimePicker
          value={pickerValue}
          mode="time"
          display="clock"
          is24Hour={is24Hour}
          onChange={handleChange}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal
          visible={visible}
          animationType="slide"
          transparent
          onRequestClose={() => setVisible(false)}
        >
          <View style={styles.timePickerOverlay}>
            <View style={styles.timePickerModal}>
              <View style={styles.timePickerHeader}>
                <TouchableOpacity
                  style={styles.timePickerAction}
                  onPress={() => setVisible(false)}
                >
                  <Text style={styles.timePickerActionText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.timePickerTitle}>Select time</Text>
                <TouchableOpacity
                  style={styles.timePickerAction}
                  onPress={() => {
                    onChange(formatClockTime(pickerValue));
                    setVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.timePickerActionText,
                      styles.timePickerDoneText,
                    ]}
                  >
                    Done
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pickerValue}
                mode="time"
                display="spinner"
                is24Hour={is24Hour}
                minuteInterval={1}
                themeVariant="light"
                accentColor="#F28C28"
                onChange={handleChange}
                style={styles.iosTimePicker}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function normalizePhone(countryCode?: string, phone?: string): string {
  return `${countryCode || ''}${phone || ''}`.replace(/[^\d]/g, '');
}

function birthdayFromTimestamp(timestamp?: number): string | undefined {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;
  const milliseconds =
    timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function sexValue(gender?: string): 1 | 2 | undefined {
  const value = gender?.trim().toLowerCase();
  if (value === 'female' || value === 'f') return 1;
  if (value === 'male' || value === 'm') return 2;
  return undefined;
}

function ChoiceRow({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  options: Option[];
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.optionWrap}>
        {options.map(option => {
          const selected = option.value === value;
          return (
            <TouchableOpacity
              key={option.value}
              disabled={disabled}
              style={[
                styles.option,
                selected ? styles.optionSelected : null,
                disabled ? styles.disabled : null,
              ]}
              onPress={() => onChange(option.value)}
            >
              <Text
                style={[
                  styles.optionText,
                  selected ? styles.optionTextSelected : null,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function SectionButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.sectionButton, active ? styles.sectionButtonActive : null]}
      onPress={onPress}
    >
      <Icon name={icon} size={16} color={active ? '#FFFFFF' : '#73573C'} />
      <Text
        style={[
          styles.sectionButtonText,
          active ? styles.sectionButtonTextActive : null,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const PillDispenserManagementSection = () => {
  const { user, isCaretaker, selectedSenior } = useAuth();
  const [deviceCode, setDeviceCode] = useState('');
  const [activeSection, setActiveSection] = useState<Section>('settings');
  const [settingsDraft, setSettingsDraft] =
    useState<PillDispenserSettingsInput | null>(null);
  const [planDraft, setPlanDraft] = useState<PillDispenserPlanInput | null>(
    null,
  );
  const [alarmDraft, setAlarmDraft] = useState<PillDispenserAlarmInput | null>(
    null,
  );

  const ownerProfile = useMemo<PillDispenserOwnerProfile | null>(() => {
    const ownerKey = isCaretaker
      ? selectedSenior?.userId
      : user?.role === 'SENIOR'
      ? user.user_id
      : null;
    if (!ownerKey || !user) return null;

    const patientName = isCaretaker
      ? `${selectedSenior?.firstName || ''} ${
          selectedSenior?.lastName || ''
        }`.trim()
      : `${user.first_name || ''} ${user.last_name || ''}`.trim();
    const gender = isCaretaker ? selectedSenior?.gender : undefined;
    const birthday = isCaretaker
      ? birthdayFromTimestamp(selectedSenior?.dateOfBirth)
      : undefined;

    return {
      ownerKey,
      username: `healthsoft_${ownerKey}`.replace(/[^a-z0-9_.-]/gi, '_'),
      mobile: normalizePhone(user.country_code, user.phone_number),
      patientName: patientName || 'Pill dispenser user',
      patientSex: sexValue(gender),
      patientBirthday: birthday,
    };
  }, [isCaretaker, selectedSenior, user]);

  const {
    record,
    information,
    plan,
    online,
    loading,
    working,
    error,
    message,
    bind,
    unbind,
    refresh,
    saveSettings,
    savePlan,
    saveAlarm,
    runAction,
  } = usePillDispenserManagement(ownerProfile);

  useEffect(() => {
    if (!information) {
      setSettingsDraft(null);
      return;
    }
    setSettingsDraft({
      language: information.language,
      timeZoneDistrict: information.timeZoneDistrict,
      dateFormat: information.dateFormat,
      timeFormat: information.timeFormat,
      timeOut: information.timeOut,
      omitting: information.omitting,
      volume: information.volume,
      unfazedSwitch: information.unfazedSwitch,
      unfazedStart: information.unfazedStart,
      unfazedEnd: information.unfazedEnd,
    });
  }, [information]);

  useEffect(() => {
    if (!plan) {
      setPlanDraft(null);
      setAlarmDraft(null);
      return;
    }
    setPlanDraft({
      planId: plan.planId,
      ceilUsed: plan.ceilUsed,
      alwaysUse: plan.alwaysUse,
      startDate: plan.startDate,
      endDate: plan.endDate,
    });
    const currentAlarm = alarmDraft
      ? plan.alarms.find(alarm => alarm.alarmId === alarmDraft.alarmId)
      : plan.alarms[0];
    if (currentAlarm) {
      setAlarmDraft({
        alarmId: currentAlarm.alarmId,
        alarmTime: currentAlarm.alarmTime,
        status: currentAlarm.status,
        drugs: currentAlarm.drugs,
      });
    }
    // Keep the selected alarm slot stable while refreshed values are applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  const bound = !!record?.deviceSn;
  const busy = !!working;
  const controlsDisabled = busy || online !== true;

  const confirmUnbind = () => {
    Alert.alert(
      'Unbind pill dispenser?',
      'The dispenser will no longer be associated with this senior. Its Wi-Fi connection will not be erased.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unbind',
          style: 'destructive',
          onPress: () => unbind(),
        },
      ],
    );
  };

  const confirmAction = (
    action: PillDispenserAction,
    title: string,
    description: string,
  ) => {
    Alert.alert(title, description, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue',
        style:
          action === 'reboot' || action === 'resetMedicinePlate'
            ? 'destructive'
            : 'default',
        onPress: () => runAction(action),
      },
    ]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <View style={styles.titleIcon}>
          <Icon name="options-outline" size={21} color="#F28C28" />
        </View>
        <View style={styles.titleText}>
          <Text style={styles.cardTitle}>Pill Dispenser Management</Text>
          <Text style={styles.cardSubtitle}>
            Bind the DN code, configure medication settings, and send device
            commands over the dispenser&apos;s secure cloud connection.
          </Text>
        </View>
      </View>

      {!ownerProfile ? (
        <View style={styles.noticeBox}>
          <Icon name="person-outline" size={18} color="#8A5A22" />
          <Text style={styles.noticeText}>
            {isCaretaker
              ? 'Select a senior profile before managing a pill dispenser.'
              : 'Pill dispenser management is available for senior profiles.'}
          </Text>
        </View>
      ) : loading ? (
        <View style={styles.centeredRow}>
          <ActivityIndicator color="#F28C28" />
          <Text style={styles.helperText}>Loading saved dispenser…</Text>
        </View>
      ) : (
        <>
          {error || message ? (
            <View
              style={[
                styles.noticeBox,
                error ? styles.errorBox : styles.successBox,
              ]}
            >
              <Icon
                name={
                  error ? 'alert-circle-outline' : 'checkmark-circle-outline'
                }
                size={18}
                color={error ? '#B42318' : '#287052'}
              />
              <Text
                style={[
                  styles.noticeText,
                  error ? styles.errorText : styles.successText,
                ]}
              >
                {error || message}
              </Text>
            </View>
          ) : null}

          {!bound ? (
            <View>
              <Text style={styles.sectionTitle}>Connect a dispenser</Text>
              <Text style={styles.helperText}>
                Enter the DN printed beside the QR code. The app checks for an
                existing binding first and only binds the dispenser when
                needed. You can also paste the complete QR link.
              </Text>
              <Text style={styles.inputLabel}>DN code or QR content</Text>
              <TextInput
                value={deviceCode}
                onChangeText={setDeviceCode}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Example: 39-00002442e347aa5e"
                placeholderTextColor="#A69B91"
                style={styles.input}
              />
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  !deviceCode.trim() || busy ? styles.disabled : null,
                ]}
                disabled={!deviceCode.trim() || busy}
                onPress={() => bind(deviceCode)}
              >
                {working === 'bind' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Icon name="link-outline" size={18} color="#FFFFFF" />
                )}
                <Text style={styles.primaryButtonText}>
                  {working === 'bind'
                    ? 'Checking dispenser…'
                    : 'Check & Connect Dispenser'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.deviceSummary}>
                <View
                  style={[
                    styles.onlineDot,
                    online === true
                      ? styles.online
                      : online === false
                      ? styles.offline
                      : styles.unknown,
                  ]}
                />
                <View style={styles.summaryText}>
                  <Text style={styles.summaryTitle}>
                    {record?.model
                      ? `${record.model} Pill Dispenser`
                      : 'Pill Dispenser'}
                  </Text>
                  <Text style={styles.summaryMeta}>{record?.deviceSn}</Text>
                  <Text style={styles.summaryMeta}>
                    {online === true
                      ? 'Online'
                      : online === false
                      ? 'Offline'
                      : 'Status unknown'}
                    {information?.firmwareVersion
                      ? ` · Firmware ${information.firmwareVersion}`
                      : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={refresh}
                  disabled={busy}
                >
                  {working === 'refresh' ? (
                    <ActivityIndicator color="#F28C28" />
                  ) : (
                    <Icon name="refresh" size={20} color="#F28C28" />
                  )}
                </TouchableOpacity>
              </View>

              {information ? (
                <View style={styles.healthGrid}>
                  <View style={styles.healthItem}>
                    <Text style={styles.healthValue}>
                      {information.batteryVolume}%
                    </Text>
                    <Text style={styles.healthLabel}>Battery</Text>
                  </View>
                  <View style={styles.healthItem}>
                    <Text style={styles.healthValue}>{information.wifi}/4</Text>
                    <Text style={styles.healthLabel}>Wi-Fi</Text>
                  </View>
                  <View style={styles.healthItem}>
                    <Text style={styles.healthValue}>
                      {information.ceilRemaining}
                    </Text>
                    <Text style={styles.healthLabel}>Remaining</Text>
                  </View>
                  <View style={styles.healthItem}>
                    <Text style={styles.healthValue}>
                      {information.uncap === 1 ? 'Open' : 'Closed'}
                    </Text>
                    <Text style={styles.healthLabel}>Lid</Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.sectionNav}>
                <SectionButton
                  icon="settings-outline"
                  label="Settings"
                  active={activeSection === 'settings'}
                  onPress={() => setActiveSection('settings')}
                />
                <SectionButton
                  icon="calendar-outline"
                  label="Plan"
                  active={activeSection === 'plan'}
                  onPress={() => setActiveSection('plan')}
                />
                <SectionButton
                  icon="alarm-outline"
                  label="Alarms"
                  active={activeSection === 'alarms'}
                  onPress={() => setActiveSection('alarms')}
                />
                <SectionButton
                  icon="flash-outline"
                  label="Actions"
                  active={activeSection === 'actions'}
                  onPress={() => setActiveSection('actions')}
                />
              </View>

              {activeSection === 'settings' ? (
                settingsDraft ? (
                  <View>
                    <Text style={styles.sectionTitle}>Device settings</Text>
                    <ChoiceRow
                      label="Language"
                      value={settingsDraft.language}
                      options={[
                        { label: 'Chinese', value: 1 },
                        { label: 'English', value: 2 },
                      ]}
                      disabled={controlsDisabled}
                      onChange={value =>
                        setSettingsDraft(current =>
                          current
                            ? { ...current, language: value === 1 ? 1 : 2 }
                            : current,
                        )
                      }
                    />
                    <ChoiceRow
                      label="Time format"
                      value={settingsDraft.timeFormat}
                      options={[
                        { label: '24 hour', value: 0 },
                        { label: '12 hour', value: 1 },
                      ]}
                      disabled={controlsDisabled}
                      onChange={value =>
                        setSettingsDraft(current =>
                          current
                            ? { ...current, timeFormat: value === 1 ? 1 : 0 }
                            : current,
                        )
                      }
                    />
                    <ChoiceRow
                      label="Date format"
                      value={settingsDraft.dateFormat}
                      options={[
                        { label: 'YY-MM-DD', value: 0 },
                        { label: 'DD-MM-YY', value: 1 },
                        { label: 'MM-DD-YY', value: 2 },
                      ]}
                      disabled={controlsDisabled}
                      onChange={value =>
                        setSettingsDraft(current =>
                          current
                            ? {
                                ...current,
                                dateFormat:
                                  value === 1 || value === 2 ? value : 0,
                              }
                            : current,
                        )
                      }
                    />
                    <ChoiceRow
                      label="Volume"
                      value={settingsDraft.volume}
                      options={[
                        { label: 'High', value: 1 },
                        { label: 'Medium', value: 2 },
                        { label: 'Low', value: 3 },
                        { label: 'Mute', value: 4 },
                      ]}
                      disabled={controlsDisabled}
                      onChange={value =>
                        setSettingsDraft(current =>
                          current
                            ? {
                                ...current,
                                volume:
                                  value === 1 || value === 3 || value === 4
                                    ? value
                                    : 2,
                              }
                            : current,
                        )
                      }
                    />

                    <Text style={styles.inputLabel}>Timezone</Text>
                    <TextInput
                      value={settingsDraft.timeZoneDistrict}
                      onChangeText={value =>
                        setSettingsDraft(current =>
                          current
                            ? { ...current, timeZoneDistrict: value }
                            : current,
                        )
                      }
                      editable={!controlsDisabled}
                      placeholder="+0530"
                      placeholderTextColor="#A69B91"
                      style={styles.input}
                    />

                    <View style={styles.switchRow}>
                      <View style={styles.switchText}>
                        <Text style={styles.inputLabel}>Do not disturb</Text>
                        <Text style={styles.helperText}>
                          Silence alerts during this period.
                        </Text>
                      </View>
                      <Switch
                        value={settingsDraft.unfazedSwitch === 2}
                        disabled={controlsDisabled}
                        trackColor={{ false: '#DED6CE', true: '#F6B26B' }}
                        thumbColor={
                          settingsDraft.unfazedSwitch === 2
                            ? '#F28C28'
                            : '#FFFFFF'
                        }
                        onValueChange={enabled =>
                          setSettingsDraft(current =>
                            current
                              ? {
                                  ...current,
                                  unfazedSwitch: enabled ? 2 : 1,
                                }
                              : current,
                          )
                        }
                      />
                    </View>

                    <View style={styles.twoColumns}>
                      <View style={styles.column}>
                        <Text style={styles.inputLabel}>DND starts</Text>
                        <ClockTimePicker
                          value={settingsDraft.unfazedStart}
                          onChange={value =>
                            setSettingsDraft(current =>
                              current
                                ? { ...current, unfazedStart: value }
                                : current,
                            )
                          }
                          disabled={controlsDisabled}
                          is24Hour={settingsDraft.timeFormat === 0}
                          accessibilityLabel="Select do-not-disturb start time"
                        />
                      </View>
                      <View style={styles.column}>
                        <Text style={styles.inputLabel}>DND ends</Text>
                        <ClockTimePicker
                          value={settingsDraft.unfazedEnd}
                          onChange={value =>
                            setSettingsDraft(current =>
                              current
                                ? { ...current, unfazedEnd: value }
                                : current,
                            )
                          }
                          disabled={controlsDisabled}
                          is24Hour={settingsDraft.timeFormat === 0}
                          accessibilityLabel="Select do-not-disturb end time"
                        />
                      </View>
                    </View>

                    <View style={styles.twoColumns}>
                      <View style={styles.column}>
                        <Text style={styles.inputLabel}>
                          Missed dose (minutes)
                        </Text>
                        <TextInput
                          value={String(settingsDraft.omitting)}
                          onChangeText={value =>
                            setSettingsDraft(current =>
                              current
                                ? {
                                    ...current,
                                    omitting: Number(value.replace(/\D/g, '')),
                                  }
                                : current,
                            )
                          }
                          editable={!controlsDisabled}
                          keyboardType="number-pad"
                          style={styles.input}
                        />
                      </View>
                      <View style={styles.column}>
                        <Text style={styles.inputLabel}>
                          Overtime (minutes)
                        </Text>
                        <TextInput
                          value={String(settingsDraft.timeOut)}
                          onChangeText={value =>
                            setSettingsDraft(current =>
                              current
                                ? {
                                    ...current,
                                    timeOut: Number(value.replace(/\D/g, '')),
                                  }
                                : current,
                            )
                          }
                          editable={!controlsDisabled}
                          keyboardType="number-pad"
                          style={styles.input}
                        />
                      </View>
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.primaryButton,
                        controlsDisabled ? styles.disabled : null,
                      ]}
                      disabled={controlsDisabled}
                      onPress={() => saveSettings(settingsDraft)}
                    >
                      {working === 'settings' ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Icon name="save-outline" size={18} color="#FFFFFF" />
                      )}
                      <Text style={styles.primaryButtonText}>
                        Save settings
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.emptyText}>
                    Connect the dispenser to the internet and refresh to load
                    its settings.
                  </Text>
                )
              ) : null}

              {activeSection === 'plan' ? (
                planDraft && plan ? (
                  <View>
                    <Text style={styles.sectionTitle}>Medication plan</Text>
                    <Text style={styles.helperText}>
                      Plan {plan.planId} · {plan.deviceCeilAmount} compartments
                    </Text>
                    <Text style={styles.inputLabel}>Filled compartments</Text>
                    <TextInput
                      value={String(planDraft.ceilUsed)}
                      onChangeText={value =>
                        setPlanDraft(current =>
                          current
                            ? {
                                ...current,
                                ceilUsed: Number(value.replace(/\D/g, '')),
                              }
                            : current,
                        )
                      }
                      editable={!controlsDisabled}
                      keyboardType="number-pad"
                      style={styles.input}
                    />
                    <View style={styles.switchRow}>
                      <View style={styles.switchText}>
                        <Text style={styles.inputLabel}>Always active</Text>
                        <Text style={styles.helperText}>
                          Disable to use start and end dates.
                        </Text>
                      </View>
                      <Switch
                        value={planDraft.alwaysUse === 1}
                        disabled={controlsDisabled}
                        onValueChange={enabled =>
                          setPlanDraft(current =>
                            current
                              ? { ...current, alwaysUse: enabled ? 1 : 0 }
                              : current,
                          )
                        }
                        trackColor={{ false: '#DED6CE', true: '#F6B26B' }}
                        thumbColor={
                          planDraft.alwaysUse === 1 ? '#F28C28' : '#FFFFFF'
                        }
                      />
                    </View>
                    {planDraft.alwaysUse === 0 ? (
                      <View style={styles.twoColumns}>
                        <View style={styles.column}>
                          <Text style={styles.inputLabel}>Start date</Text>
                          <TextInput
                            value={planDraft.startDate}
                            onChangeText={value =>
                              setPlanDraft(current =>
                                current
                                  ? { ...current, startDate: value }
                                  : current,
                              )
                            }
                            editable={!controlsDisabled}
                            placeholder="2026-08-01"
                            placeholderTextColor="#A69B91"
                            style={styles.input}
                          />
                        </View>
                        <View style={styles.column}>
                          <Text style={styles.inputLabel}>End date</Text>
                          <TextInput
                            value={planDraft.endDate}
                            onChangeText={value =>
                              setPlanDraft(current =>
                                current
                                  ? { ...current, endDate: value }
                                  : current,
                              )
                            }
                            editable={!controlsDisabled}
                            placeholder="2026-12-31"
                            placeholderTextColor="#A69B91"
                            style={styles.input}
                          />
                        </View>
                      </View>
                    ) : null}
                    <TouchableOpacity
                      style={[
                        styles.primaryButton,
                        controlsDisabled ? styles.disabled : null,
                      ]}
                      disabled={controlsDisabled}
                      onPress={() => savePlan(planDraft)}
                    >
                      {working === 'plan' ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Icon name="save-outline" size={18} color="#FFFFFF" />
                      )}
                      <Text style={styles.primaryButtonText}>Save plan</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.emptyText}>
                    No medication plan was returned. The vendor must create the
                    initial plan and alarm slots before they can be edited.
                  </Text>
                )
              ) : null}

              {activeSection === 'alarms' ? (
                plan && plan.alarms.length > 0 && alarmDraft ? (
                  <View>
                    <Text style={styles.sectionTitle}>Medication alarms</Text>
                    <View style={styles.alarmTabs}>
                      {plan.alarms.map((alarm, index) => {
                        const selected = alarm.alarmId === alarmDraft.alarmId;
                        return (
                          <TouchableOpacity
                            key={alarm.alarmId}
                            style={[
                              styles.alarmTab,
                              selected ? styles.alarmTabSelected : null,
                            ]}
                            onPress={() =>
                              setAlarmDraft({
                                alarmId: alarm.alarmId,
                                alarmTime: alarm.alarmTime,
                                status: alarm.status,
                                drugs: alarm.drugs,
                              })
                            }
                          >
                            <Text
                              style={[
                                styles.alarmTabText,
                                selected ? styles.alarmTabTextSelected : null,
                              ]}
                            >
                              {index + 1}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <View style={styles.switchRow}>
                      <View style={styles.switchText}>
                        <Text style={styles.inputLabel}>Alarm enabled</Text>
                        <Text style={styles.helperText}>
                          Slot ID {alarmDraft.alarmId}
                        </Text>
                      </View>
                      <Switch
                        value={alarmDraft.status === 1}
                        disabled={controlsDisabled}
                        onValueChange={enabled =>
                          setAlarmDraft(current =>
                            current
                              ? { ...current, status: enabled ? 1 : 2 }
                              : current,
                          )
                        }
                        trackColor={{ false: '#DED6CE', true: '#F6B26B' }}
                        thumbColor={
                          alarmDraft.status === 1 ? '#F28C28' : '#FFFFFF'
                        }
                      />
                    </View>

                    <Text style={styles.inputLabel}>Alarm time</Text>
                    <ClockTimePicker
                      value={alarmDraft.alarmTime}
                      onChange={value =>
                        setAlarmDraft(current =>
                          current ? { ...current, alarmTime: value } : current,
                        )
                      }
                      disabled={controlsDisabled}
                      is24Hour={settingsDraft?.timeFormat !== 1}
                      accessibilityLabel="Select medication alarm time"
                    />

                    <Text style={styles.inputLabel}>Medicines</Text>
                    {alarmDraft.drugs.map((drug, index) => (
                      <View
                        key={`${alarmDraft.alarmId}-${index}`}
                        style={styles.drugRow}
                      >
                        <TextInput
                          value={drug.drugName}
                          onChangeText={value =>
                            setAlarmDraft(current => {
                              if (!current) return current;
                              const drugs = [...current.drugs];
                              drugs[index] = {
                                ...drugs[index],
                                drugName: value,
                              };
                              return { ...current, drugs };
                            })
                          }
                          editable={!controlsDisabled}
                          placeholder="Medicine name"
                          placeholderTextColor="#A69B91"
                          style={[styles.input, styles.drugNameInput]}
                        />
                        <TextInput
                          value={drug.drugAmount}
                          onChangeText={value =>
                            setAlarmDraft(current => {
                              if (!current) return current;
                              const drugs = [...current.drugs];
                              drugs[index] = {
                                ...drugs[index],
                                drugAmount: value,
                              };
                              return { ...current, drugs };
                            })
                          }
                          editable={!controlsDisabled}
                          placeholder="Qty"
                          placeholderTextColor="#A69B91"
                          style={[styles.input, styles.drugAmountInput]}
                        />
                        <TouchableOpacity
                          disabled={controlsDisabled}
                          style={styles.removeButton}
                          onPress={() =>
                            setAlarmDraft(current =>
                              current
                                ? {
                                    ...current,
                                    drugs: current.drugs.filter(
                                      (_, drugIndex) => drugIndex !== index,
                                    ),
                                  }
                                : current,
                            )
                          }
                        >
                          <Icon name="close-circle" size={21} color="#B42318" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity
                      style={styles.addDrugButton}
                      disabled={controlsDisabled}
                      onPress={() =>
                        setAlarmDraft(current =>
                          current
                            ? {
                                ...current,
                                drugs: [
                                  ...current.drugs,
                                  { drugName: '', drugAmount: '1' },
                                ],
                              }
                            : current,
                        )
                      }
                    >
                      <Icon name="add" size={17} color="#F28C28" />
                      <Text style={styles.addDrugText}>Add medicine</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.primaryButton,
                        controlsDisabled ? styles.disabled : null,
                      ]}
                      disabled={controlsDisabled}
                      onPress={() => saveAlarm(alarmDraft)}
                    >
                      {working === `alarm:${alarmDraft.alarmId}` ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Icon name="save-outline" size={18} color="#FFFFFF" />
                      )}
                      <Text style={styles.primaryButtonText}>Save alarm</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.emptyText}>
                    No alarm slots were returned for this dispenser.
                  </Text>
                )
              ) : null}

              {activeSection === 'actions' ? (
                <View>
                  <Text style={styles.sectionTitle}>Device actions</Text>
                  <TouchableOpacity
                    style={styles.actionRow}
                    disabled={controlsDisabled}
                    onPress={() =>
                      confirmAction(
                        'takeMedicine',
                        'Present medicine now?',
                        'The dispenser will advance and present the current medicine dose.',
                      )
                    }
                  >
                    <Icon name="medical-outline" size={20} color="#F28C28" />
                    <View style={styles.actionText}>
                      <Text style={styles.actionTitle}>Take medicine now</Text>
                      <Text style={styles.actionDescription}>
                        Advance the medicine plate immediately.
                      </Text>
                    </View>
                    <Icon name="chevron-forward" size={18} color="#9A8F85" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionRow}
                    disabled={controlsDisabled}
                    onPress={() =>
                      confirmAction(
                        'muteAlarm',
                        'Mute current alarm?',
                        'The dispenser will silence its currently active alarm.',
                      )
                    }
                  >
                    <Icon
                      name="volume-mute-outline"
                      size={20}
                      color="#F28C28"
                    />
                    <View style={styles.actionText}>
                      <Text style={styles.actionTitle}>Mute current alarm</Text>
                      <Text style={styles.actionDescription}>
                        Silence the alarm currently sounding.
                      </Text>
                    </View>
                    <Icon name="chevron-forward" size={18} color="#9A8F85" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionRow}
                    disabled={controlsDisabled}
                    onPress={() =>
                      confirmAction(
                        'reboot',
                        'Reboot dispenser?',
                        'The dispenser will temporarily go offline while it restarts.',
                      )
                    }
                  >
                    <Icon name="power-outline" size={20} color="#B54708" />
                    <View style={styles.actionText}>
                      <Text style={styles.actionTitle}>Reboot dispenser</Text>
                      <Text style={styles.actionDescription}>
                        Restart the dispenser software.
                      </Text>
                    </View>
                    <Icon name="chevron-forward" size={18} color="#9A8F85" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionRow}
                    disabled={controlsDisabled}
                    onPress={() =>
                      confirmAction(
                        'resetMedicinePlate',
                        'Reset medicine plate?',
                        'This resets the medicine plate position. Continue only when the physical plate is correctly installed.',
                      )
                    }
                  >
                    <Icon
                      name="refresh-circle-outline"
                      size={20}
                      color="#B42318"
                    />
                    <View style={styles.actionText}>
                      <Text style={styles.actionTitle}>
                        Reset medicine plate
                      </Text>
                      <Text style={styles.actionDescription}>
                        Reinitialize the compartment plate position.
                      </Text>
                    </View>
                    <Icon name="chevron-forward" size={18} color="#9A8F85" />
                  </TouchableOpacity>
                </View>
              ) : null}

              <TouchableOpacity
                style={styles.unbindButton}
                disabled={busy}
                onPress={confirmUnbind}
              >
                {working === 'unbind' ? (
                  <ActivityIndicator color="#B42318" />
                ) : (
                  <Icon name="unlink-outline" size={17} color="#B42318" />
                )}
                <Text style={styles.unbindButtonText}>Unbind dispenser</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </View>
  );
};

export default PillDispenserManagementSection;

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 24,
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  titleIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFF4E6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  titleText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2E2A27',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#7A726A',
    lineHeight: 18,
    marginTop: 4,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF8EF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  errorBox: {
    backgroundColor: '#FFF1F0',
  },
  successBox: {
    backgroundColor: '#EFFAF4',
  },
  noticeText: {
    flex: 1,
    color: '#73573C',
    fontSize: 12,
    lineHeight: 17,
    marginLeft: 8,
  },
  errorText: {
    color: '#B42318',
  },
  successText: {
    color: '#287052',
  },
  centeredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#3E3732',
    marginBottom: 7,
  },
  helperText: {
    color: '#837970',
    fontSize: 12,
    lineHeight: 17,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5A514A',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DDD4CC',
    backgroundColor: '#FFFEFC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 43,
    fontSize: 14,
    color: '#2E2A27',
  },
  timePickerButton: {
    minHeight: 43,
    borderWidth: 1,
    borderColor: '#DDD4CC',
    backgroundColor: '#FFFEFC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timePickerValue: {
    color: '#2E2A27',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  timePickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  timePickerModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24,
  },
  timePickerHeader: {
    minHeight: 54,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5DDD5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timePickerAction: {
    minWidth: 64,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  timePickerActionText: {
    color: '#73573C',
    fontSize: 15,
  },
  timePickerDoneText: {
    color: '#C2650B',
    fontWeight: '700',
    textAlign: 'right',
  },
  timePickerTitle: {
    color: '#3E3732',
    fontSize: 15,
    fontWeight: '700',
  },
  iosTimePicker: {
    alignSelf: 'stretch',
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#F28C28',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  deviceSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E7DED6',
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#FFFCF8',
  },
  onlineDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    marginRight: 10,
  },
  online: {
    backgroundColor: '#1D9B5F',
  },
  offline: {
    backgroundColor: '#D92D20',
  },
  unknown: {
    backgroundColor: '#9A8F85',
  },
  summaryText: {
    flex: 1,
  },
  summaryTitle: {
    color: '#332D29',
    fontSize: 14,
    fontWeight: '700',
  },
  summaryMeta: {
    color: '#7A726A',
    fontSize: 11,
    marginTop: 2,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFF2E3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  healthGrid: {
    flexDirection: 'row',
    marginTop: 12,
    backgroundColor: '#F8F5F2',
    borderRadius: 12,
    paddingVertical: 10,
  },
  healthItem: {
    flex: 1,
    alignItems: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#D8CEC5',
  },
  healthValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3C342E',
  },
  healthLabel: {
    fontSize: 10,
    color: '#857A70',
    marginTop: 2,
  },
  sectionNav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginVertical: 16,
  },
  sectionButton: {
    flexGrow: 1,
    minWidth: '22%',
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: '#F3EEE9',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 7,
  },
  sectionButtonActive: {
    backgroundColor: '#73573C',
  },
  sectionButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#73573C',
  },
  sectionButtonTextActive: {
    color: '#FFFFFF',
  },
  fieldGroup: {
    marginBottom: 4,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  option: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#D8CFC7',
    backgroundColor: '#FFFFFF',
  },
  optionSelected: {
    borderColor: '#F28C28',
    backgroundColor: '#FFF2E3',
  },
  optionText: {
    color: '#675D55',
    fontSize: 12,
  },
  optionTextSelected: {
    color: '#B85C00',
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  switchText: {
    flex: 1,
    paddingRight: 12,
  },
  twoColumns: {
    flexDirection: 'row',
    gap: 10,
  },
  column: {
    flex: 1,
  },
  emptyText: {
    color: '#837970',
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 18,
    textAlign: 'center',
  },
  alarmTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  alarmTab: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: '#F0EAE4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alarmTabSelected: {
    backgroundColor: '#F28C28',
  },
  alarmTabText: {
    color: '#73573C',
    fontSize: 12,
    fontWeight: '700',
  },
  alarmTabTextSelected: {
    color: '#FFFFFF',
  },
  drugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
  },
  drugNameInput: {
    flex: 1,
  },
  drugAmountInput: {
    width: 68,
  },
  removeButton: {
    padding: 4,
  },
  addDrugButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingVertical: 6,
  },
  addDrugText: {
    color: '#C2650B',
    fontSize: 12,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4DCD5',
    paddingVertical: 13,
  },
  actionText: {
    flex: 1,
    marginHorizontal: 10,
  },
  actionTitle: {
    color: '#3C342E',
    fontSize: 13,
    fontWeight: '700',
  },
  actionDescription: {
    color: '#837970',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  unbindButton: {
    minHeight: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#F1B9B4',
    backgroundColor: '#FFF8F7',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    marginTop: 20,
  },
  unbindButtonText: {
    color: '#B42318',
    fontSize: 13,
    fontWeight: '700',
  },
});
