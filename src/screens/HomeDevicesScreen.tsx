import React from 'react';
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
import HomeAssignedDeviceList from '../components/HomeAssignedDeviceList';
import type { HomeAssignedDevice } from '../utils/homeAssignedDevices';

type HomeDevicesRouteParams = {
  devices?: HomeAssignedDevice[];
  activeSeniorId?: string | null;
};

const HomeDevicesScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const params = (route.params || {}) as HomeDevicesRouteParams;
  const devices = Array.isArray(params.devices) ? params.devices : [];

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
        {devices.length === 0 ? (
          <View style={styles.emptyCard}>
            <Icon name="hardware-chip-outline" size={28} color="#AF9F92" />
            <Text style={styles.emptyTitle}>No devices assigned</Text>
            <Text style={styles.emptyBody}>
              Devices assigned to this senior will appear here.
            </Text>
          </View>
        ) : null}
        <HomeAssignedDeviceList
          devices={devices}
          seniorId={params.activeSeniorId ?? null}
        />
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
});
