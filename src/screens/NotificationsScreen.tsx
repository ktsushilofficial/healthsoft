// ============================================
// src/screens/NotificationsScreen.tsx
// ============================================
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import type { MissedDoseEvent } from '../types/missedDoses';
import {
  countMissedDosesOnDay,
  formatAlarmTime,
  formatMissedDoseDrug,
  groupMissedDosesByDay,
} from '../utils/missedDoses';
import { toLocalDayKey, todayLocalDayKey } from '../utils/vitalsDay';

const MISSED_DOSE_COLOR = '#FFD2A3';
const MISSED_DOSE_TODAY_COLOR = '#FFC0C0';

function formatReportedAt(reportedAt: number): string | null {
  if (!reportedAt) return null;
  const date = new Date(reportedAt);
  if (Number.isNaN(date.getTime())) return null;
  const time = formatAlarmTime(
    `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`,
  );
  return toLocalDayKey(date) === todayLocalDayKey()
    ? `Reported ${time}`
    : `Reported ${date.getDate()}/${date.getMonth() + 1}, ${time}`;
}

const NotificationsScreen = () => {
  const navigation = useNavigation();
  const { isCaretaker, selectedSenior, getSeniorMissedDoses } = useAuth();
  const seniorId = selectedSenior?.userId?.trim() ?? '';

  const [doses, setDoses] = useState<MissedDoseEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ignores responses for a senior the user has since switched away from.
  const requestIdRef = useRef(0);

  const loadMissedDoses = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const requestId = ++requestIdRef.current;
      if (!isCaretaker || !seniorId) {
        setDoses([]);
        setError(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      try {
        const next = await getSeniorMissedDoses(seniorId);
        if (requestId !== requestIdRef.current) return;
        setDoses(next);
        setError(null);
      } catch (e) {
        if (requestId !== requestIdRef.current) return;
        setError(e instanceof Error ? e.message : 'Could not load missed doses.');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [getSeniorMissedDoses, isCaretaker, seniorId],
  );

  useFocusEffect(
    useCallback(() => {
      void loadMissedDoses('initial');
    }, [loadMissedDoses]),
  );

  const groups = useMemo(() => groupMissedDosesByDay(doses), [doses]);
  const todayKey = todayLocalDayKey();
  const todayCount = useMemo(
    () => countMissedDosesOnDay(doses, todayKey),
    [doses, todayKey],
  );
  const seniorFirstName = (selectedSenior?.firstName || '').trim();

  const renderBody = () => {
    if (!isCaretaker) {
      return <EmptyState icon="notifications-off-outline" text="No notifications yet." />;
    }
    if (!seniorId) {
      return (
        <EmptyState
          icon="person-outline"
          text="Select a senior on the Home screen to see their missed doses."
        />
      );
    }
    if (loading && doses.length === 0) {
      return (
        <View style={styles.stateWrap}>
          <ActivityIndicator size="large" color="#F28C28" />
        </View>
      );
    }
    if (error && doses.length === 0) {
      return (
        <View style={styles.stateWrap}>
          <Icon name="cloud-offline-outline" size={36} color="#C18A5B" />
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => void loadMissedDoses('initial')}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (groups.length === 0) {
      return (
        <EmptyState
          icon="checkmark-circle-outline"
          text={`No missed doses${seniorFirstName ? ` for ${seniorFirstName}` : ''}.`}
        />
      );
    }
    return groups.map(group => (
      <View key={group.dayKey}>
        <View style={styles.sectionLabel}>
          <Text style={styles.sectionText}>{group.label}</Text>
        </View>
        {group.doses.map(dose => {
          const isToday = dose.date === todayKey;
          const reported = formatReportedAt(dose.reportedAt);
          return (
            <View
              key={`${dose.deviceSn}-${dose.date}-${dose.alarmTime}-${dose.reportedAt}`}
              style={[
                styles.notificationCard,
                { backgroundColor: isToday ? MISSED_DOSE_TODAY_COLOR : MISSED_DOSE_COLOR },
              ]}>
              <View style={styles.iconWrap}>
                <Icon name="medkit" size={20} color="#F28C28" />
              </View>
              <View style={styles.notificationInfo}>
                <Text style={styles.notificationTitle}>
                  Missed dose · {formatAlarmTime(dose.alarmTime)}
                </Text>
                <Text style={styles.notificationMessage}>
                  {dose.drugs.length > 0
                    ? dose.drugs.map(formatMissedDoseDrug).join(', ')
                    : 'No medicine details recorded for this alarm.'}
                </Text>
                {reported ? (
                  <Text style={styles.notificationTime}>{reported}</Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    ));
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadMissedDoses('refresh')}
            colors={['#F28C28']}
            tintColor="#F28C28"
          />
        }>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Icon name="arrow-back" size={22} color="#4C4A48" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notifications</Text>
          <View style={styles.headerSpacer} />
        </View>

        {isCaretaker && seniorId ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>
              {seniorFirstName ? `${seniorFirstName}’s missed doses` : 'Missed doses'}
            </Text>
            <Text style={styles.summarySubtitle}>
              {todayCount} today • {doses.length} total
            </Text>
          </View>
        ) : null}

        {error && doses.length > 0 ? (
          <Text style={styles.inlineError}>{error}</Text>
        ) : null}

        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  );
};

const EmptyState = ({ icon, text }: { icon: string; text: string }) => (
  <View style={styles.stateWrap}>
    <Icon name={icon} size={36} color="#C18A5B" />
    <Text style={styles.stateText}>{text}</Text>
  </View>
);

export default NotificationsScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F2EE',
  },
  content: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2E2A27',
  },
  headerSpacer: {
    width: 22,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2E2A27',
  },
  summarySubtitle: {
    fontSize: 12,
    color: '#7A726A',
    marginTop: 4,
  },
  sectionLabel: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sectionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7A726A',
  },
  notificationCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#F1E8DE',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFF1E3',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  notificationInfo: {
    flex: 1,
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2E2A27',
  },
  notificationMessage: {
    fontSize: 12,
    color: '#6E655D',
    marginTop: 4,
    lineHeight: 16,
  },
  notificationTime: {
    fontSize: 11,
    color: '#8A6F5A',
    marginTop: 6,
  },
  stateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  stateText: {
    fontSize: 14,
    color: '#6E655D',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: '#F28C28',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    marginTop: 16,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  inlineError: {
    fontSize: 12,
    color: '#B3261E',
    marginHorizontal: 16,
    marginBottom: 12,
  },
});
