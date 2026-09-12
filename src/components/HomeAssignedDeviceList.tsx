import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import DeviceIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { HomeAssignedDevice } from '../utils/homeAssignedDevices';

const ICONS = {
  pendant: { name: 'necklace', color: '#D97706', backgroundColor: '#FFF7E6' },
  band: { name: 'watch-variant', color: '#EF4444', backgroundColor: '#FEF2F2' },
  pillDispenser: {
    name: 'pill',
    color: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  other: {
    name: 'devices',
    color: '#64748B',
    backgroundColor: '#F1F5F9',
  },
};

export default function HomeAssignedDeviceList({
  devices,
  seniorId,
}: {
  devices: HomeAssignedDevice[];
  seniorId: string | null;
}) {
  const navigation = useNavigation<any>();
  const openDevice = (device: HomeAssignedDevice) => {
    if (device.kind === 'band') navigation.navigate('Activity');
    else if (device.kind === 'pillDispenser')
      navigation.navigate('PillDispenser');
    else if (device.kind === 'pendant')
      navigation.navigate('PendantDetail', {
        seniorId: seniorId ?? undefined,
        deviceUuid: device.deviceUuid ?? undefined,
        imei: device.imei ?? undefined,
        deviceName: device.name,
      });
  };

  return (
    <>
      {devices.map(device => {
        const icon = ICONS[device.kind];
        const canOpen =
          device.kind !== 'other' &&
          !!seniorId &&
          (device.kind !== 'pendant' || !!(device.deviceUuid || device.imei));
        const batteryIcon = device.charging
          ? 'battery-charging'
          : device.batteryPercent == null
          ? 'battery-dead-outline'
          : device.batteryPercent > 75
          ? 'battery-full'
          : device.batteryPercent > 30
          ? 'battery-half'
          : 'battery-dead';
        return (
          <TouchableOpacity
            key={device.key}
            style={styles.card}
            activeOpacity={0.8}
            disabled={!canOpen}
            accessibilityRole={canOpen ? 'button' : undefined}
            onPress={() => openDevice(device)}
          >
            <View
              style={[styles.icon, { backgroundColor: icon.backgroundColor }]}
            >
              <DeviceIcon name={icon.name} size={26} color={icon.color} />
            </View>
            <View style={styles.details}>
              <Text style={styles.name}>{device.name}</Text>
              {device.alarmLabel ? (
                <Text style={styles.alarm}>{device.alarmLabel}</Text>
              ) : null}
              {device.identifier ? (
                <Text style={styles.identifier} numberOfLines={1}>
                  {device.identifier}
                </Text>
              ) : null}
            </View>
            <View style={styles.statusColumn}>
              <Text style={styles.status}>{device.status}</Text>
              {device.kind === 'pendant' ? (
                <View style={styles.battery}>
                  <Icon name={batteryIcon} size={14} color="#8A827A" />
                  <Text style={styles.batteryText}>
                    {device.batteryPercent == null
                      ? 'NA'
                      : `${device.batteryPercent}%`}
                  </Text>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  details: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '800', color: '#1B2A4A' },
  alarm: { fontSize: 12, fontWeight: '700', color: '#B42318', marginTop: 3 },
  identifier: { fontSize: 12, color: '#8F8276', marginTop: 3 },
  statusColumn: { alignItems: 'flex-end', marginLeft: 8, maxWidth: '35%' },
  status: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    textAlign: 'right',
  },
  battery: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  batteryText: { fontSize: 12, color: '#8A827A', marginLeft: 4 },
});
