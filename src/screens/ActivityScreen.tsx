// ============================================
// src/screens/ActivityScreen.tsx
// ============================================
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { InteractionManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useV8DeviceManager } from '../v8/useV8DeviceManager';

const ActivityScreen = () => {
  const { connectionStates, latestLiveData, requestLiveSnapshot } = useV8DeviceManager();
  const isHandBandConnected = Object.values(connectionStates).some(state => state === 'connected');
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Defer heavy content until after the tab transition animation finishes.
  const [ready, setReady] = useState(false);

  useFocusEffect(
    React.useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        setReady(true);
      });
      return () => task.cancel();
    }, []),
  );

  // Only tick while screen is focused to avoid re-renders when on other tabs.
  useFocusEffect(
    React.useCallback(() => {
      if (!isHandBandConnected) return undefined;
      setNowMs(Date.now());
      const timer = setInterval(() => setNowMs(Date.now()), 5000);
      return () => clearInterval(timer);
    }, [isHandBandConnected]),
  );

  const lastUpdateLabel = useMemo(() => {
    if (!isHandBandConnected) return null;
    const receivedAt = latestLiveData?.receivedAt ?? null;
    if (!receivedAt) return 'Waiting for first live packet...';
    const diffSec = Math.max(0, Math.floor((nowMs - receivedAt) / 1000));
    return `Last update: ${diffSec}s ago`;
  }, [isHandBandConnected, latestLiveData?.receivedAt, nowMs]);

  // Read directly from latestLiveData — it now merges all fields from different
  // data types (HR, SpO2, steps, etc.), so the expensive allSamples flatMap +
  // backward scan through all history entries is no longer needed.
  const displaySteps = latestLiveData?.steps ?? null;
  const displayDistanceKm = latestLiveData?.distanceKm ?? null;
  const displayTemperatureC = latestLiveData?.temperatureC ?? null;
  const displaySystolic = latestLiveData?.systolicBp ?? null;
  const displayDiastolic = latestLiveData?.diastolicBp ?? null;
  const displaySpo2 = latestLiveData?.spo2 ?? null;
  const displayHeartRate = latestLiveData?.heartRate ?? null;

  useFocusEffect(
    React.useCallback(() => {
      if (!isHandBandConnected) return undefined;
      const initialTask = InteractionManager.runAfterInteractions(() => {
        requestLiveSnapshot().catch(() => {});
      });
      const interval = setInterval(() => {
        InteractionManager.runAfterInteractions(() => {
          requestLiveSnapshot().catch(() => {});
        });
      }, 45000);
      return () => {
        initialTask.cancel();
        clearInterval(interval);
      };
    }, [isHandBandConnected, requestLiveSnapshot]),
  );

  if (!ready) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color="#F28C28" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Icon name="fitness" size={20} color="#F28C28" />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Health Activity</Text>
          {isHandBandConnected ? (
            <>
              <View style={styles.liveBadge}>
                <Icon name="watch-outline" size={14} color="#1D8A45" />
                <Text style={styles.liveBadgeText}>Live from Hand Band</Text>
              </View>
              {lastUpdateLabel ? <Text style={styles.liveMeta}>{lastUpdateLabel}</Text> : null}
            </>
          ) : null}

          <View style={[styles.metricCard, styles.metricSteps]}>
            <View style={styles.metricIconWrap}>
              <Icon name="footsteps" size={26} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <Text style={styles.metricValue}>
                {isHandBandConnected
                  ? (displaySteps != null ? `${displaySteps}` : '--')
                  : '8,512'}
              </Text>
              <Text style={styles.metricLabel}>Today Step Count</Text>
              <View style={styles.progressTrack}>
                <View style={styles.progressFill} />
                <View style={styles.goalChip}>
                  <Text style={styles.goalText}>Goal: 10,000</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="heart" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>
                  {isHandBandConnected && displaySystolic != null && displayDiastolic != null
                    ? `${displaySystolic}/${displayDiastolic}`
                    : (isHandBandConnected ? '--/--' : '118/78')}
                </Text>
                <Text style={styles.metricUnit}>mmHg</Text>
              </View>
              <Text style={styles.metricLabel}>Blood Pressure</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="water" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <Text style={styles.metricValue}>
                {isHandBandConnected
                  ? (displaySpo2 != null ? `${displaySpo2}%` : '--')
                  : '98%'}
              </Text>
              <Text style={styles.metricLabel}>Blood Oxygen</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="pulse" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>
                  {isHandBandConnected
                    ? (displayHeartRate != null ? `${displayHeartRate}` : '--')
                    : '75'}
                </Text>
                <Text style={styles.metricUnit}>BPM</Text>
              </View>
              <Text style={styles.metricLabel}>Heart Rate</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="resize" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>
                  {isHandBandConnected && displayDistanceKm != null
                    ? `${displayDistanceKm.toFixed(2)}`
                    : (isHandBandConnected ? '--' : '4.60')}
                </Text>
                <Text style={styles.metricUnit}>km</Text>
              </View>
              <Text style={styles.metricLabel}>Distance Today</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="thermometer" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>
                  {isHandBandConnected && displayTemperatureC != null
                    ? `${displayTemperatureC.toFixed(1)}`
                    : (isHandBandConnected ? '--' : '36.6')}
                </Text>
                <Text style={styles.metricUnit}>°C</Text>
              </View>
              <Text style={styles.metricLabel}>Body Temperature</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ActivityScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F2EE',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2E2A27',
    marginBottom: 12,
  },
  liveBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F8ED',
    borderColor: '#B9E9CA',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 12,
  },
  liveBadgeText: {
    marginLeft: 6,
    color: '#1D8A45',
    fontSize: 12,
    fontWeight: '700',
  },
  liveMeta: {
    fontSize: 12,
    color: '#5E8A6C',
    marginBottom: 10,
    marginLeft: 2,
  },
  metricCard: {
    backgroundColor: '#FAF8F5',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0E7DD',
  },
  metricSteps: {
    paddingBottom: 16,
  },
  metricIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFF2E5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  metricInfo: {
    flex: 1,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2E2A27',
  },
  metricUnit: {
    fontSize: 14,
    color: '#7A726A',
    marginLeft: 6,
    marginTop: 4,
  },
  metricLabel: {
    fontSize: 14,
    color: '#7A726A',
    marginTop: 4,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  progressTrack: {
    marginTop: 10,
    height: 12,
    backgroundColor: '#F1E7DB',
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressFill: {
    height: 12,
    width: '70%',
    backgroundColor: '#F28C28',
    borderRadius: 10,
  },
  goalChip: {
    position: 'absolute',
    right: 8,
    backgroundColor: '#E27D1A',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  goalText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
