// src/screens/HomeScreen.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  ImageBackground,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import SeniorSelectionModal from '../components/SeniorSelectionModal';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getMockSeniorHomeSnapshot } from '../mocks/mockSeniorHomeSnapshot';
import { buildOpenStreetMapMarkerUrl } from '../utils/openStreetMap';

const HERO_IMAGES = [
  { uri: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80' },
  { uri: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80' },
  { uri: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=80' },
  { uri: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?auto=format&fit=crop&w=1200&q=80' },
  { uri: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&w=1200&q=80' },
];

const SENIOR_ROLE = 'SENIOR';

function capitalizeWord(s: string) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
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
  const { user, selectedSenior, seniors, getMySeniors, isCaretaker } = useAuth();
  const [modalVisible, setModalVisible] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);
  const [nowTick, setNowTick] = useState(() => new Date());

  const snapshotKey = useMemo(() => {
    if (!user) return 'preview';
    if (user.role === SENIOR_ROLE) return user.user_id;
    if (selectedSenior?.userId) return selectedSenior.userId;
    return `family-${user.user_id}`;
  }, [user, selectedSenior?.userId]);

  const liveSnapshot = useMemo(
    () => getMockSeniorHomeSnapshot(snapshotKey),
    [snapshotKey]
  );

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
    // Auto-prompt if no senior selected but seniors exist (caretakers only)
    if (isCaretaker && !selectedSenior && seniors.length > 0) {
      setModalVisible(true);
    }
  }, [selectedSenior, seniors.length, isCaretaker]);

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

  const greeting = useMemo(() => getGreetingFromDate(nowTick), [nowTick]);

  const bannerDisplayName = useMemo(() => {
    if (!user) return { line: 'Welcome!', subtitleDay: '' };
    if (user.role === SENIOR_ROLE) {
      const fn = capitalizeWord((user.first_name || '').trim());
      const ln = (user.last_name || '').trim();
      const line = fn ? `${fn}${ln ? ` ${ln}` : ''}!` : 'Welcome!';
      return { line, subtitleDay: '' };
    }
    if (selectedSenior) {
      const fn = capitalizeWord((selectedSenior.firstName || '').trim());
      const ln = (selectedSenior.lastName || '').trim();
      const line = fn ? `${fn}${ln ? ` ${ln}` : ''}!` : 'Welcome!';
      return { line, subtitleDay: '' };
    }
    return {
      line: 'Your family',
      subtitleDay: 'Select a senior above to personalize this card.',
    };
  }, [user, selectedSenior]);

  const weekdayLine = useMemo(() => {
    const d = nowTick;
    const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
    const monthDay = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    return `Have a wonderful ${weekday} — ${monthDay}`;
  }, [nowTick]);

  const openLastPositionMap = useCallback(() => {
    const lat = liveSnapshot.latitude;
    const lon = liveSnapshot.longitude;
    const url = buildOpenStreetMapMarkerUrl(lat, lon);
    navigation.navigate('WebView', {
      url,
      title: 'Last position (OpenStreetMap)',
    });
  }, [liveSnapshot.latitude, liveSnapshot.longitude, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Icon name="fitness" size={24} color="#FF9500" />
          </View>
          {isCaretaker && (
            <TouchableOpacity
              style={styles.headerRight}
              onPress={() => setModalVisible(true)}
            >
              <View style={{ marginRight: 8, alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#333' }}>
                  {selectedSenior ? `${selectedSenior.firstName}` : 'Select Senior'}
                </Text>
                <Text style={{ fontSize: 10, color: '#666' }}>
                  {selectedSenior ? 'Active Profile' : 'Tap to select'}
                </Text>
              </View>
              {selectedSenior?.profileImageUrl ? (
                <Image
                  source={{ uri: selectedSenior.profileImageUrl }}
                  style={styles.avatar}
                />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitials}>
                    {selectedSenior ? `${(selectedSenior.firstName?.[0] || '').toUpperCase()}${(selectedSenior.lastName?.[0] || '').toUpperCase()}` : '?'}
                  </Text>
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
          </View>
          <View style={styles.sunIcon}>
            <Icon name={greeting.icon} size={42} color={greeting.iconColor} />
          </View>
        </ImageBackground>

        {/* Location (reuses weather card layout) */}
        <View style={styles.weatherCard}>
          <View style={styles.weatherLeft}>
            <View style={styles.weatherHeader}>
              <Icon name="location" size={18} color="#FF9500" />
              <Text style={styles.weatherLocation}>Last known position</Text>
            </View>
            <View style={styles.coordBlock}>
              <Text style={styles.coordLabel}>Latitude</Text>
              <Text style={[styles.coordValue, styles.coordValueLat]} selectable>
                {`${liveSnapshot.latitude.toFixed(6)}°`}
              </Text>
              <Text style={[styles.coordLabel, styles.coordLabelLon]}>Longitude</Text>
              <Text style={[styles.coordValue, styles.coordValueLon]} selectable>
                {`${liveSnapshot.longitude.toFixed(6)}°`}
              </Text>
            </View>
            <Text style={styles.weatherRangeTight}>
              {`${Math.round(liveSnapshot.speedKph)} km/h · ${liveSnapshot.lastUpdatedLabel}`}
            </Text>
            <Text style={styles.weatherRange}>{liveSnapshot.networkLabel}</Text>
            <TouchableOpacity
              style={styles.mapButton}
              onPress={openLastPositionMap}
              activeOpacity={0.85}
            >
              <Icon name="map-outline" size={18} color="#FF9500" />
              <View style={styles.mapButtonTextCol}>
                <Text style={styles.mapButtonTitle}>View on map</Text>
                <Text style={styles.mapButtonSubtitle}>OpenStreetMap · marker at this point</Text>
              </View>
              <Icon name="chevron-forward" size={18} color="#C7C1BA" />
            </TouchableOpacity>
          </View>
          <Image source={locationThumb} style={styles.weatherImage} />
        </View>

        {/* Battery + safety (reuses Rahukalam / Yamagandam card row) */}
        <View style={styles.badgesRow}>
          <View style={[styles.badgeCard, styles.badgeWarm]}>
            <View style={styles.badgeHeader}>
              <Icon
                name={
                  liveSnapshot.charging
                    ? 'battery-charging'
                    : liveSnapshot.batteryPercent > 75
                      ? 'battery-full'
                      : liveSnapshot.batteryPercent > 30
                        ? 'battery-half'
                        : 'battery-dead-outline'
                }
                size={16}
                color="#D18B2E"
              />
              <Text style={styles.badgeTitle}>Battery</Text>
            </View>
            <Text style={styles.badgeHighlight}>{`${liveSnapshot.batteryPercent}%`}</Text>
            <Text style={styles.badgeTime}>
              {liveSnapshot.charging ? 'Charging now' : 'On battery power'}
            </Text>
          </View>
          <View style={[styles.badgeCard, styles.badgeCool]}>
            <View style={styles.badgeHeader}>
              <Icon
                name={
                  liveSnapshot.alarmSeverity === 'ok'
                    ? 'shield-checkmark'
                    : 'warning'
                }
                size={16}
                color="#D7643C"
              />
              <Text style={styles.badgeTitle}>Safety</Text>
            </View>
            <Text style={styles.badgeHighlight} numberOfLines={2}>
              {liveSnapshot.primaryAlarmLabel}
            </Text>
            <Text style={styles.badgeTime} numberOfLines={2}>
              {liveSnapshot.alarmDetail}
            </Text>
            <View style={styles.badgeAlarmMeta}>
              <Icon
                name="alarm-outline"
                size={12}
                color="#8A7565"
                style={styles.badgeAlarmIcon}
              />
              <Text style={styles.badgeAlarmMetaText} numberOfLines={2}>
                {`Last: ${liveSnapshot.lastAlarmKind} · ${liveSnapshot.lastAlarmAt}`}
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
                <Text style={styles.timeTitle}>{liveSnapshot.primaryAlarmLabel}</Text>
                <Text style={styles.timeSubtitle}>{liveSnapshot.alarmDetail}</Text>
                <View style={styles.lastAlarmRow}>
                  <Icon name="time-outline" size={16} color="#8A827A" />
                  <View style={styles.lastAlarmTextCol}>
                    <Text style={styles.lastAlarmLabel}>Last alarm</Text>
                    <Text style={styles.lastAlarmValue}>
                      {`${liveSnapshot.lastAlarmKind} · ${liveSnapshot.lastAlarmAt}`}
                    </Text>
                  </View>
                </View>
              </View>
              <Icon name="pulse" size={18} color="#C7C1BA" />
            </View>

            <View style={styles.timeRow}>
              <View style={[styles.timeSlot, styles.timeSlotGreen]}>
                <Text style={styles.timeSlotTitle}>Signal & network</Text>
                <Text style={styles.timeSlotValue}>{liveSnapshot.networkLabel}</Text>
              </View>
              <View style={[styles.timeSlot, styles.timeSlotPeach]}>
                <Text style={styles.timeSlotTitle}>Fix quality</Text>
                <Text style={styles.timeSlotValue}>
                  {liveSnapshot.hdop != null && liveSnapshot.satellites != null
                    ? `HDOP ${liveSnapshot.hdop} · ${liveSnapshot.satellites} satellites`
                    : 'GNSS lock OK'}
                </Text>
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
