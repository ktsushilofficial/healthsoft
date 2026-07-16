import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useBle } from '../bluetooth/BleProvider';
import V8DeviceTab from '../components/V8DeviceTab';
import type { BleDiscoveredDevice } from '../bluetooth/types';
import type { DeviceStackParamList } from '../types/navigation';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import {
  findAssignedDeviceForBleDevice,
  resolveDisplayedImei,
  type SeniorAssignedDevice,
} from '../utils/deviceAssignments';
import {
  clearCachedAssignedDeviceMatchesForSenior,
  findCachedAssignedDeviceMatch,
  getCachedAssignedDeviceMatchesForSenior,
  type CachedAssignedDeviceMatch,
  upsertCachedAssignedDeviceMatches,
} from '../utils/assignedDeviceMatchCache';

const contacts = [
  {
    id: '1',
    name: 'Sarah Johnson',
    relation: 'Wife',
    mobile: '+1 555-123-4567',
    home: '+1 555-765-4321',
    color: '#F6C7A7',
  },
  {
    id: '2',
    name: 'Michael Davis',
    relation: 'Father',
    mobile: '+1 555-987-6543',
    color: '#CBE4F6',
  },
];

const conditions = [
  { id: '1', label: 'Asthma', checked: false },
  { id: '2', label: 'Diabetes', checked: true },
  { id: '3', label: 'Hypertension', checked: true },
  { id: '4', label: 'High Cholesterol', checked: true },
  { id: '5', label: 'Sleep Apnea', checked: false },
  { id: '6', label: 'Allergies', checked: false },
];

const medicines = [
  {
    id: '1',
    name: 'Lipitor',
    generic: 'Atorvastatin',
    dose: '20 mg tablet',
    usage: 'Take 1 tablet at morning',
    type: 'pill',
  },
  {
    id: '2',
    name: 'Advair',
    generic: 'Fluticasone/Salmeterol',
    dose: '250 mcg / 50 mcg',
    usage: 'Take 1 puff twice daily',
    type: 'inhaler',
  },
];

type AssignedDeviceRow = {
  rowId: string;
  device: BleDiscoveredDevice;
  assignedDevice: SeniorAssignedDevice;
  source: 'live' | 'cached';
  cachedMatch: CachedAssignedDeviceMatch | null;
};

const DeviceScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<DeviceStackParamList>>();
  const route = useRoute<any>();
  const {
    user,
    isCaretaker,
    selectedSenior,
    getAssignedDevicesForSenior,
  } = useAuth();
  const tabs = useMemo(
    () => [
      { id: 'current', label: 'Current Devices' },
      { id: 'v8', label: 'Hand Band' },
    ],
    [],
  );
  const [activeTab, setActiveTab] = useState(() =>
    route.params?.activeTab === 'v8' ? 'v8' : tabs[0].id,
  );
  const hasPurchased = true;
  const [assignedDevices, setAssignedDevices] = useState<SeniorAssignedDevice[]>([]);
  const [assignedDevicesLoading, setAssignedDevicesLoading] = useState(false);
  const [assignedDevicesError, setAssignedDevicesError] = useState<string | null>(null);
  const [cachedAssignedMatches, setCachedAssignedMatches] = useState<CachedAssignedDeviceMatch[]>([]);
  const [cachedAssignedMatchesLoading, setCachedAssignedMatchesLoading] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const scanPromptKeyRef = React.useRef<string | null>(null);

  const {
    bleState,
    isScanning,
    isResolvingScanIdentities,
    devices,
    scanError,
    connectionStates,
    connectedDeviceIds,
    deviceIdentityById,
    startScan,
    stopScan,
    connectToDevice,
    disconnect,
  } = useBle();

  const activeSeniorId = useMemo(() => {
    if (isCaretaker) {
      return selectedSenior?.userId ?? null;
    }
    return user?.role === 'SENIOR' ? user.user_id : null;
  }, [isCaretaker, selectedSenior?.userId, user?.role, user?.user_id]);

  const pendantScanHints = useMemo(
    () => assignedDevices.flatMap(device => [
      device.name,
      device.imei,
      device.serialNumber,
      device.deviceIdentifier,
    ]).filter((value): value is string => !!value),
    [assignedDevices],
  );

  const knownDevices: BleDiscoveredDevice[] = useMemo(() => {
    const map = new Map<string, BleDiscoveredDevice>();

    devices.forEach(d => map.set(d.id, d));

    connectedDeviceIds.forEach(id => {
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: deviceIdentityById[id]?.model ?? 'Connected device',
          localName: null,
          rssi: null,
          isConnectable: null,
          serviceUUIDs: null,
        });
      }
    });

    return Array.from(map.values());
  }, [connectedDeviceIds, deviceIdentityById, devices]);

  const loadAssignedDevices = useCallback(async () => {
    if (!activeSeniorId) {
      setAssignedDevices([]);
      setAssignedDevicesLoading(false);
      setAssignedDevicesError(
        isCaretaker ? 'Select a senior profile first to view assigned devices.' : null,
      );
      return;
    }

    setAssignedDevicesLoading(true);
    setAssignedDevicesError(null);

    try {
      const nextDevices = await getAssignedDevicesForSenior(activeSeniorId);
      setAssignedDevices(nextDevices);
    } catch (error) {
      setAssignedDevices([]);
      setAssignedDevicesError(
        error instanceof Error ? error.message : 'Failed to load assigned devices.',
      );
    } finally {
      setAssignedDevicesLoading(false);
    }
  }, [activeSeniorId, getAssignedDevicesForSenior, isCaretaker]);

  useEffect(() => {
    loadAssignedDevices();
  }, [loadAssignedDevices]);

  useEffect(() => {
    if (route.params?.activeTab === 'v8') {
      setActiveTab('v8');
    }
  }, [route.params?.activeTab]);

  useEffect(() => {
    if (!route.params?.showScanHandBandPrompt || activeTab !== 'v8') {
      return;
    }

    const promptKey = String(route.params?.promptedAt ?? 'latest');
    if (scanPromptKeyRef.current === promptKey) {
      return;
    }
    scanPromptKeyRef.current = promptKey;

    Alert.alert(
      'Scan and select hand band',
      'Scan nearby hand bands, then select the assigned hand band for this senior.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Scan Now',
          onPress: () => {
            if (!isScanning) {
              startScan(10000, pendantScanHints);
            }
          },
        },
      ],
      { cancelable: true },
    );
  }, [activeTab, isScanning, pendantScanHints, route.params?.promptedAt, route.params?.showScanHandBandPrompt, startScan]);

  useEffect(() => {
    let cancelled = false;

    const loadCachedMatches = async () => {
      if (!activeSeniorId) {
        setCachedAssignedMatches([]);
        setCachedAssignedMatchesLoading(false);
        return;
      }

      setCachedAssignedMatchesLoading(true);
      try {
        const cachedMatches = await getCachedAssignedDeviceMatchesForSenior(activeSeniorId);
        if (!cancelled) {
          setCachedAssignedMatches(cachedMatches);
        }
      } catch {
        if (!cancelled) {
          setCachedAssignedMatches([]);
        }
      } finally {
        if (!cancelled) {
          setCachedAssignedMatchesLoading(false);
        }
      }
    };

    loadCachedMatches();

    return () => {
      cancelled = true;
    };
  }, [activeSeniorId]);

  const visibleDevices = useMemo(
    () =>
      knownDevices
        .map(device => ({
          device,
          assignedDevice: findAssignedDeviceForBleDevice(
            device,
            deviceIdentityById[device.id],
            assignedDevices,
          ),
        }))
        .filter(
          (
            item,
          ): item is { device: BleDiscoveredDevice; assignedDevice: SeniorAssignedDevice } =>
            item.assignedDevice !== null,
        ),
    [assignedDevices, deviceIdentityById, knownDevices],
  );

  useEffect(() => {
    let cancelled = false;

    const persistVisibleMatches = async () => {
      if (!activeSeniorId || visibleDevices.length === 0) {
        return;
      }

      const nextCacheEntries: CachedAssignedDeviceMatch[] = visibleDevices
        .map(({ device, assignedDevice }) => ({
          seniorId: activeSeniorId,
          bleDeviceId: device.id,
          assignmentId: assignedDevice.assignmentId,
          assignedDeviceId: assignedDevice.deviceId,
          deviceIdentifier: assignedDevice.deviceIdentifier,
          imei: resolveDisplayedImei(deviceIdentityById[device.id], assignedDevice),
          deviceName: device.name ?? assignedDevice.name ?? null,
          localName: device.localName ?? null,
          updatedAt: Date.now(),
        }))
        .filter(entry => !!entry.bleDeviceId && !!entry.imei);

      if (nextCacheEntries.length === 0) {
        return;
      }

      try {
        const merged = await upsertCachedAssignedDeviceMatches(nextCacheEntries);
        if (!cancelled) {
          setCachedAssignedMatches(merged.filter(entry => entry.seniorId === activeSeniorId));
        }
      } catch {
        // Best-effort local cache update.
      }
    };

    persistVisibleMatches();

    return () => {
      cancelled = true;
    };
  }, [activeSeniorId, deviceIdentityById, visibleDevices]);

  const assignedImeisSummary = useMemo(() => {
    const imeis = assignedDevices
      .map(device => device.imei ?? device.serialNumber ?? null)
      .filter((value): value is string => !!value);
    return imeis.join(', ');
  }, [assignedDevices]);

  const assignedDeviceRows = useMemo<AssignedDeviceRow[]>(() => {
    const liveRows: AssignedDeviceRow[] = visibleDevices.map(({ device, assignedDevice }) => ({
      rowId: `live-${device.id}`,
      device,
      assignedDevice,
      source: 'live',
      cachedMatch: null,
    }));

    const liveAssignedIds = new Set(liveRows.map(row => row.assignedDevice.id));

    const cachedRows: AssignedDeviceRow[] = activeSeniorId
      ? assignedDevices
          .filter(assignedDevice => !liveAssignedIds.has(assignedDevice.id))
          .map<AssignedDeviceRow | null>(assignedDevice => {
            const cachedMatch = findCachedAssignedDeviceMatch(
              activeSeniorId,
              assignedDevice,
              cachedAssignedMatches,
            );
            if (!cachedMatch) {
              return null;
            }

            return {
              rowId: `cached-${assignedDevice.id}-${cachedMatch.bleDeviceId}`,
              device: {
                id: cachedMatch.bleDeviceId,
                name: cachedMatch.deviceName ?? assignedDevice.name ?? null,
                localName: cachedMatch.localName ?? null,
                rssi: null,
                isConnectable: null,
                serviceUUIDs: null,
              },
              assignedDevice,
              source: 'cached',
              cachedMatch,
            };
          })
          .filter((item): item is AssignedDeviceRow => item !== null)
      : [];

    if (!activeSeniorId || assignedDevices.length > 0 || !assignedDevicesError) {
      return [...liveRows, ...cachedRows];
    }

    const fallbackRows: AssignedDeviceRow[] = cachedAssignedMatches.map(cachedMatch => ({
      rowId: `cached-fallback-${cachedMatch.bleDeviceId}-${cachedMatch.assignmentId ?? cachedMatch.assignedDeviceId ?? cachedMatch.imei ?? 'saved'}`,
      device: {
        id: cachedMatch.bleDeviceId,
        name: cachedMatch.deviceName,
        localName: cachedMatch.localName,
        rssi: null,
        isConnectable: null,
        serviceUUIDs: null,
      },
      assignedDevice: {
        id: cachedMatch.assignmentId ?? cachedMatch.assignedDeviceId ?? cachedMatch.bleDeviceId,
        assignmentId: cachedMatch.assignmentId,
        deviceId: cachedMatch.assignedDeviceId,
        deviceIdentifier: cachedMatch.deviceIdentifier,
        imei: cachedMatch.imei,
        serialNumber: null,
        bluetoothMacAddress: null,
        name: cachedMatch.deviceName,
        status: 'CACHED',
        raw: {},
      },
      source: 'cached',
      cachedMatch,
    }));

    return [...liveRows, ...fallbackRows];
  }, [activeSeniorId, assignedDevices, assignedDevicesError, cachedAssignedMatches, visibleDevices]);

  const otherScannedDevices = useMemo(() => {
    const visibleIds = new Set(visibleDevices.map(item => item.device.id));
    return knownDevices.filter(device => !visibleIds.has(device.id));
  }, [knownDevices, visibleDevices]);

  const getStatusLabel = (device: BleDiscoveredDevice, options?: { cachedOnly?: boolean }) => {
    const state = connectionStates[device.id];
    if (state === 'connected') return 'Connected';
    if (state === 'connecting') return 'Connecting...';
    if (state === 'disconnecting') return 'Disconnecting...';
    if (state === 'error') return 'Error';
    if (options?.cachedOnly) return 'Saved device';
    if (typeof device.rssi === 'number') return `RSSI: ${device.rssi}`;
    return 'Available';
  };

  const clearSavedAssignedDeviceList = useCallback(async () => {
    if (!activeSeniorId) {
      return;
    }

    setIsClearingCache(true);
    try {
      await clearCachedAssignedDeviceMatchesForSenior(activeSeniorId);
      setCachedAssignedMatches([]);
    } finally {
      setIsClearingCache(false);
    }
  }, [activeSeniorId]);


  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.navigate('Home' as never)}>
            <Icon name="arrow-back" size={22} color="#F28C28" />
          </TouchableOpacity>
          <View style={styles.brand} />
          <View style={styles.headerSpacer} />
        </View>

        {hasPurchased ? (
          <>
            <View style={styles.segmentWrap}>
              {tabs.map(tab => {
                const selected = activeTab === tab.id;
                return (
                  <TouchableOpacity
                    key={tab.id}
                    style={[styles.segment, selected ? styles.segmentActive : null]}
                    onPress={() => setActiveTab(tab.id)}
                  >
                    <Text style={[styles.segmentText, selected ? styles.segmentTextActive : null]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {activeTab === 'contacts' ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Emergency Contacts</Text>
                <Text style={styles.cardSubtitle}>
                  Your emergency contacts may be notified in case of a medical
                  emergency or alert.
                </Text>
                <TouchableOpacity style={styles.primaryButton}>
                  <Icon name="add" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>
                    Add Emergency Contact
                  </Text>
                </TouchableOpacity>

                {contacts.map(contact => (
                  <View key={contact.id} style={styles.contactCard}>
                    <View style={styles.contactHeader}>
                      <View
                        style={[
                          styles.avatar,
                          { backgroundColor: contact.color || '#F6C7A7' },
                        ]}
                      >
                        <Text style={styles.avatarText}>
                          {contact.name
                            .split(' ')
                            .map(part => part[0])
                            .slice(0, 2)
                            .join('')}
                        </Text>
                      </View>
                      <View style={styles.contactInfo}>
                        <Text style={styles.contactName}>{contact.name}</Text>
                        <Text style={styles.contactRelation}>
                          {contact.relation}
                        </Text>
                      </View>
                      <Icon name="call" size={20} color="#F28C28" />
                    </View>

                    <View style={styles.contactRow}>
                      <Text style={styles.contactLabel}>Mobile</Text>
                      <Text style={styles.contactValue}>{contact.mobile}</Text>
                      <Icon name="call" size={16} color="#F28C28" />
                    </View>
                    {contact.home ? (
                      <View style={styles.contactRow}>
                        <Text style={styles.contactLabel}>Home</Text>
                        <Text style={styles.contactValue}>{contact.home}</Text>
                        <Icon name="call" size={16} color="#F28C28" />
                      </View>
                    ) : null}
                  </View>
                ))}

                <TouchableOpacity style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Edit</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {activeTab === 'conditions' ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  Pre-existing Health Conditions
                </Text>
                <Text style={styles.cardSubtitle}>
                  Select any relevant pre-existing health conditions for your
                  medical profile.
                </Text>

                {conditions.map(item => (
                  <View key={item.id} style={styles.checkboxRow}>
                    <View
                      style={[
                        styles.checkbox,
                        item.checked
                          ? styles.checkboxChecked
                          : styles.checkboxEmpty,
                      ]}
                    >
                      {item.checked ? (
                        <Icon name="checkmark" size={14} color="#FFFFFF" />
                      ) : null}
                    </View>
                    <Text style={styles.checkboxLabel}>{item.label}</Text>
                  </View>
                ))}

                <TouchableOpacity style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Save</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {activeTab === 'medicines' ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Medicines Taken</Text>
                <Text style={styles.cardSubtitle}>
                  Keep track of medications you are currently taking.
                </Text>
                <TouchableOpacity style={styles.primaryButton}>
                  <Icon name="add" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>Add Medicine</Text>
                </TouchableOpacity>

                {medicines.map(item => (
                  <View key={item.id} style={styles.medicineCard}>
                    <View
                      style={[
                        styles.medicineIcon,
                        item.type === 'inhaler'
                          ? styles.medicineIconPurple
                          : styles.medicineIconGold,
                      ]}
                    >
                      <Icon
                        name={item.type === 'inhaler' ? 'medical' : 'bandage'}
                        size={22}
                        color="#FFFFFF"
                      />
                    </View>
                    <View style={styles.medicineInfo}>
                      <Text style={styles.medicineName}>
                        {item.name}{' '}
                        <Text style={styles.medicineGeneric}>
                          ({item.generic})
                        </Text>
                      </Text>
                      <Text style={styles.medicineDetail}>{item.dose}</Text>
                      <Text style={styles.medicineDetail}>{item.usage}</Text>
                    </View>
                    <Icon name="pencil" size={18} color="#F28C28" />
                  </View>
                ))}

                <TouchableOpacity style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Edit</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {activeTab === 'current' ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Pendant Devices</Text>
                <Text style={styles.cardSubtitle}>
                  Scan, link and manage nearby assigned pendants.
                </Text>
                <TouchableOpacity
                  style={styles.assignedDevicesChip}
                  onPress={() => navigation.navigate('AssignedDevices')}
                  activeOpacity={0.85}
                >
                  <Icon name="hardware-chip-outline" size={17} color="#F28C28" />
                  <Text style={styles.assignedDevicesChipText}>Assigned devices</Text>
                  <Icon name="chevron-forward" size={16} color="#C4A574" />
                </TouchableOpacity>
                {activeSeniorId ? (
                  <Text style={styles.cardSubtitle}>
                    {assignedDevicesLoading
                      ? 'Loading assigned devices...'
                      : cachedAssignedMatchesLoading
                        ? 'Loading saved device list...'
                      : isResolvingScanIdentities
                        ? 'Reading IMEI from scanned devices...'
                      : `Assigned devices: ${assignedDevices.length}`}
                  </Text>
                ) : null}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      styles.actionButton,
                      !activeSeniorId || isResolvingScanIdentities ? styles.primaryButtonDisabled : null,
                    ]}
                    onPress={() => {
                      if (isScanning) stopScan();
                      else startScan(10000, pendantScanHints);
                    }}
                    disabled={!activeSeniorId || isResolvingScanIdentities}
                  >
                  {isScanning ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : isResolvingScanIdentities ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Icon name="bluetooth" size={18} color="#FFFFFF" />
                  )}
                  <Text style={styles.primaryButtonText}>
                    {isScanning
                      ? 'Scanning...'
                      : isResolvingScanIdentities
                        ? 'Reading IMEI...'
                        : bleState === 'PoweredOn'
                          ? 'Scan Nearby'
                          : 'Enable Bluetooth'}
                  </Text>
                </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.refreshButton,
                      !activeSeniorId || assignedDevicesLoading || isResolvingScanIdentities ? styles.primaryButtonDisabled : null,
                    ]}
                    onPress={loadAssignedDevices}
                    disabled={!activeSeniorId || assignedDevicesLoading || isResolvingScanIdentities}
                  >
                    {assignedDevicesLoading ? (
                      <ActivityIndicator color="#F28C28" />
                    ) : (
                      <Icon name="refresh" size={18} color="#F28C28" />
                    )}
                    <Text style={styles.refreshButtonText}>
                      {assignedDevicesLoading ? 'Refreshing...' : 'Refresh'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {activeSeniorId ? (
                  <TouchableOpacity
                    style={[
                      styles.clearCacheButton,
                      cachedAssignedMatches.length === 0 || isClearingCache ? styles.primaryButtonDisabled : null,
                    ]}
                    onPress={clearSavedAssignedDeviceList}
                    disabled={cachedAssignedMatches.length === 0 || isClearingCache}
                  >
                    {isClearingCache ? (
                      <ActivityIndicator color="#8B5E34" />
                    ) : (
                      <Icon name="trash-outline" size={16} color="#8B5E34" />
                    )}
                    <Text style={styles.clearCacheButtonText}>
                      {isClearingCache ? 'Clearing Saved List...' : `Clear Saved List (${cachedAssignedMatches.length})`}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {bleState !== 'PoweredOn' ? (
                  <Text style={styles.warningText}>Bluetooth is not powered on.</Text>
                ) : null}

                {assignedDevicesError ? <Text style={styles.warningText}>{assignedDevicesError}</Text> : null}
                {scanError ? <Text style={styles.warningText}>{scanError}</Text> : null}

                {!assignedDevicesLoading && !cachedAssignedMatchesLoading && activeSeniorId && assignedDevices.length === 0 && !assignedDevicesError ? (
                  <Text style={styles.cardSubtitle}>(No devices are assigned to this senior yet.)</Text>
                ) : null}

                {!assignedDevicesLoading && !cachedAssignedMatchesLoading && assignedDevices.length > 0 && assignedDeviceRows.length === 0 ? (
                  <Text style={styles.cardSubtitle}>
                    {assignedImeisSummary
                      ? `No assigned device found nearby yet. Expected IMEI: ${assignedImeisSummary}`
                      : 'No assigned device found nearby yet.'}
                  </Text>
                ) : null}

                {assignedDeviceRows.slice(0, 12).map(({ rowId, device, assignedDevice, source, cachedMatch }) => {
                  const state = connectionStates[device.id] ?? 'disconnected';
                  const isConnected = state === 'connected';
                  const isBusy = state === 'connecting' || state === 'disconnecting';
                  const identity = deviceIdentityById[device.id];
                  const displayImei = resolveDisplayedImei(
                    identity ?? (cachedMatch?.imei ? { imei: cachedMatch.imei } : undefined),
                    assignedDevice,
                  );
                  const isCachedOnly = source === 'cached' && !knownDevices.some(knownDevice => knownDevice.id === device.id);

                  return (
                    <View key={rowId} style={styles.deviceRow}>
                      <Icon name="radio" size={20} color={isCachedOnly ? '#8B7F74' : '#F28C28'} />
                      <View style={styles.deviceInfo}>
                        <Text style={styles.deviceName}>
                          {assignedDevice.name ?? cachedMatch?.deviceName ?? device.name ?? device.localName ?? 'Unknown device'}
                        </Text>
                        <Text style={styles.deviceStatus}>{getStatusLabel(device, { cachedOnly: isCachedOnly })}</Text>
                        <Text style={styles.deviceStatus}>
                          {displayImei ? `IMEI: ${displayImei}` : 'IMEI: —'}
                        </Text>
                        {identity?.batteryLevel != null ? (
                          <Text style={styles.deviceStatus}>Battery: {identity.batteryLevel}%</Text>
                        ) : null}
                        {identity?.firmwareRevision ? (
                          <Text style={styles.deviceStatus}>
                            FW: {identity.firmwareRevision}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.deviceActions}>
                        <TouchableOpacity
                          style={[
                            styles.linkButton,
                            isConnected ? styles.linkButtonSecondary : null,
                            isBusy ? { opacity: 0.6 } : null,
                          ]}
                          onPress={() => (isConnected ? disconnect(device.id) : connectToDevice(device.id))}
                          disabled={isBusy}
                        >
                          <Text style={styles.linkButtonText}>
                            {isConnected ? 'Disconnect' : isBusy ? 'Working...' : 'Connect'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.secondaryChip}
                          onPress={() => {
                            navigation.navigate('DeviceDetail', {
                              deviceId: device.id,
                              deviceName: assignedDevice.name ?? cachedMatch?.deviceName ?? device.name ?? device.localName ?? 'Device',
                              assignedImei: displayImei,
                            });
                          }}
                        >
                          <Text style={styles.secondaryChipText}>Manage</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}

                {otherScannedDevices.length > 0 ? (
                  <>
                    <View style={styles.sectionDivider} />
                    <Text style={styles.sectionTitle}>Other Pendant Devices</Text>
                    <Text style={styles.sectionSubtitle}>
                      Nearby pendants that are not in the assigned-device list.
                    </Text>

                    {otherScannedDevices.slice(0, 12).map(device => {
                      const state = connectionStates[device.id] ?? 'disconnected';
                      const isConnected = state === 'connected';
                      const isBusy = state === 'connecting' || state === 'disconnecting';
                      const identity = deviceIdentityById[device.id];
                      const displayImei = resolveDisplayedImei(identity);

                      return (
                        <View key={`other-${device.id}`} style={styles.deviceRow}>
                          <Icon name="radio" size={20} color="#8B7F74" />
                          <View style={styles.deviceInfo}>
                            <Text style={styles.deviceName}>
                              {device.name ?? device.localName ?? 'Unknown device'}
                            </Text>
                            <Text style={styles.deviceStatus}>{getStatusLabel(device)}</Text>
                            <Text style={styles.deviceStatus}>
                              {displayImei ? `IMEI: ${displayImei}` : 'IMEI: —'}
                            </Text>
                            {identity?.batteryLevel != null ? (
                              <Text style={styles.deviceStatus}>Battery: {identity.batteryLevel}%</Text>
                            ) : null}
                            {identity?.firmwareRevision ? (
                              <Text style={styles.deviceStatus}>
                                FW: {identity.firmwareRevision}
                              </Text>
                            ) : null}
                          </View>
                          <View style={styles.deviceActions}>
                            <TouchableOpacity
                              style={[
                                styles.linkButton,
                                isConnected ? styles.linkButtonSecondary : null,
                                isBusy ? { opacity: 0.6 } : null,
                              ]}
                              onPress={() => (isConnected ? disconnect(device.id) : connectToDevice(device.id))}
                              disabled={isBusy}
                            >
                              <Text style={styles.linkButtonText}>
                                {isConnected ? 'Disconnect' : isBusy ? 'Working...' : 'Connect'}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.secondaryChip}
                              onPress={() => {
                                navigation.navigate('DeviceDetail', {
                                  deviceId: device.id,
                                  deviceName: device.name ?? device.localName ?? 'Device',
                                  assignedImei: displayImei,
                                });
                              }}
                            >
                              <Text style={styles.secondaryChipText}>Manage</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                  </>
                ) : null}
              </View>
            ) : null}

            {activeTab === 'v8' ? (
              <V8DeviceTab
                showSyncLatestPrompt={!!route.params?.showSyncLatestPrompt}
                promptToken={route.params?.promptedAt ?? null}
              />
            ) : null}
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.deviceTitle}>Payment Details</Text>
            <View style={styles.paymentCard}>
              <View style={styles.paymentChipRow}>
                <Text style={styles.cardDigits}>•••• 5678</Text>
                <Icon name="wifi" size={18} color="#FFFFFF" />
              </View>
              <Text style={styles.cardBrand}>VISA</Text>
            </View>

            <View style={styles.deviceInfoRow}>
              <Text style={styles.deviceInfoLabel}>Subscription Start Date</Text>
              <Text style={styles.deviceInfoValue}>Jun 20, 2023</Text>
            </View>
            <View style={styles.deviceInfoRow}>
              <Text style={styles.deviceInfoLabel}>Subscription End Date</Text>
              <Text style={styles.deviceInfoValue}>Jun 20, 2024</Text>
            </View>
            <View style={styles.deviceInfoRow}>
              <Text style={styles.deviceInfoLabel}>Next Payment Due</Text>
              <Text style={styles.deviceInfoValue}>May 20, 2024</Text>
            </View>
            <View style={styles.deviceInfoRow}>
              <Text style={styles.deviceInfoLabel}>Last Payment Made</Text>
              <Text style={styles.deviceInfoValue}>Apr 20, 2023</Text>
            </View>

            <TouchableOpacity style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Make Payment</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default DeviceScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F2EE',
  },
  content: {
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  brand: {
    width: 24,
    height: 24,
  },
  headerSpacer: {
    width: 22,
  },
  segmentWrap: {
    flexDirection: 'row',
    backgroundColor: '#EFE7DD',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 18,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 14,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: {
    fontSize: 12,
    color: '#8B7F74',
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#2E2A27',
  },
  deviceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  deviceTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2E2A27',
  },
  unlinkChip: {
    backgroundColor: '#F28C28',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  unlinkText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  deviceCard: {
    alignItems: 'center',
    marginBottom: 12,
  },
  deviceImage: {
    width: 110,
    height: 70,
    borderRadius: 16,
    backgroundColor: '#F28C28',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  deviceCardName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2E2A27',
  },
  deviceInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#EEE6DD',
  },
  deviceInfoLabel: {
    fontSize: 13,
    color: '#7A726A',
  },
  deviceInfoValue: {
    fontSize: 14,
    color: '#2E2A27',
    fontWeight: '600',
  },
  deviceDivider: {
    height: 1,
    backgroundColor: '#EFE7DD',
    marginVertical: 16,
  },
  paymentCard: {
    backgroundColor: '#3B3F6B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    marginTop: 12,
  },
  paymentChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardDigits: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
  },
  cardBrand: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    alignSelf: 'flex-end',
    marginTop: 20,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F7F4',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  deviceActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceInfo: {
    flex: 1,
    marginLeft: 10,
  },
  deviceName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E2A27',
  },
  deviceStatus: {
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
  secondaryChip: {
    marginLeft: 8,
    backgroundColor: '#F6F1EA',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F1E2CF',
  },
  secondaryChipText: {
    color: '#F28C28',
    fontSize: 12,
    fontWeight: '600',
  },
  warningText: {
    color: '#B00020',
    marginTop: 8,
    textAlign: 'center',
  },
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
  sectionDivider: {
    height: 1,
    backgroundColor: '#EFE7DD',
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2E2A27',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#7A726A',
    marginBottom: 12,
    lineHeight: 17,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 16,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F28C28',
    borderRadius: 22,
    paddingVertical: 12,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    marginBottom: 0,
  },
  refreshButton: {
    minWidth: 118,
    marginLeft: 10,
    borderRadius: 22,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#F1E2CF',
    backgroundColor: '#F6F1EA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonText: {
    color: '#F28C28',
    fontWeight: '600',
    marginLeft: 6,
  },
  clearCacheButton: {
    alignSelf: 'center',
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F6EEE4',
    borderWidth: 1,
    borderColor: '#E7D5C1',
    flexDirection: 'row',
    alignItems: 'center',
  },
  clearCacheButtonText: {
    color: '#8B5E34',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    marginLeft: 6,
  },
  assignedDevicesChip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 14,
    borderRadius: 999,
    backgroundColor: '#FFFBF7',
    borderWidth: 1,
    borderColor: '#F5DCC4',
    shadowColor: '#C4A574',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  assignedDevicesChipText: {
    marginLeft: 8,
    marginRight: 4,
    fontSize: 13,
    fontWeight: '700',
    color: '#5C4A3A',
    letterSpacing: 0.2,
  },
  secondaryButton: {
    backgroundColor: '#F28C28',
    borderRadius: 22,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  contactCard: {
    backgroundColor: '#F9F7F4',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  contactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontWeight: '700',
    color: '#5B4636',
  },
  contactInfo: {
    flex: 1,
    marginLeft: 12,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2E2A27',
  },
  contactRelation: {
    fontSize: 13,
    color: '#7A726A',
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#EEE6DD',
  },
  contactLabel: {
    fontSize: 12,
    color: '#7A726A',
    width: 60,
  },
  contactValue: {
    flex: 1,
    fontSize: 14,
    color: '#2E2A27',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F7F4',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F1E8DE',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: '#F28C28',
  },
  checkboxEmpty: {
    borderWidth: 2,
    borderColor: '#F28C28',
  },
  checkboxLabel: {
    fontSize: 14,
    color: '#2E2A27',
  },
  medicineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F7F4',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  medicineIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  medicineIconGold: {
    backgroundColor: '#F2B046',
  },
  medicineIconPurple: {
    backgroundColor: '#8D6CE8',
  },
  medicineInfo: {
    flex: 1,
  },
  medicineName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2E2A27',
  },
  medicineGeneric: {
    fontSize: 12,
    color: '#7A726A',
  },
  medicineDetail: {
    fontSize: 12,
    color: '#6E665E',
    marginTop: 2,
  },
});
