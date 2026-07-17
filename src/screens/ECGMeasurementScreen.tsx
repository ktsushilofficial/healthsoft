import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import Svg, { Line, Path } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { downsampleEcg } from '../v8/ecg';
import { useV8DeviceManager } from '../v8/useV8DeviceManager';

const ACTIVE_PHASES = new Set(['starting', 'measuring', 'processing']);

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0',
  )}`;
}

const EcgWaveform = ({
  samples,
  width,
}: {
  samples: number[];
  width: number;
}) => {
  const height = 180;
  const chartWidth = Math.max(240, width);
  const path = useMemo(() => {
    const points = downsampleEcg(samples, Math.max(80, Math.floor(chartWidth)));
    if (points.length < 2) return '';
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = Math.max(1, max - min);
    return points
      .map((value, index) => {
        const x = (index / (points.length - 1)) * chartWidth;
        const y = height - 14 - ((value - min) / range) * (height - 28);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [chartWidth, samples]);

  return (
    <View style={styles.waveformWrap}>
      {samples.length > 1 ? (
        <Svg width={chartWidth} height={height}>
          {[1, 2, 3, 4].map(index => (
            <Line
              key={`h-${index}`}
              x1="0"
              x2={chartWidth}
              y1={(height / 5) * index}
              y2={(height / 5) * index}
              stroke="#F5D9D9"
              strokeWidth="1"
            />
          ))}
          {[1, 2, 3, 4, 5].map(index => (
            <Line
              key={`v-${index}`}
              y1="0"
              y2={height}
              x1={(chartWidth / 6) * index}
              x2={(chartWidth / 6) * index}
              stroke="#F5D9D9"
              strokeWidth="1"
            />
          ))}
          <Path d={path} stroke="#D64545" strokeWidth="2" fill="none" />
        </Svg>
      ) : (
        <View style={styles.waveformEmpty}>
          <Icon name="pulse-outline" size={34} color="#CC8A8A" />
          <Text style={styles.waveformEmptyTitle}>
            Waiting for ECG waveform
          </Text>
          <Text style={styles.waveformEmptyText}>
            Keep still and maintain contact with the hand band.
          </Text>
        </View>
      )}
    </View>
  );
};

const ECGMeasurementScreen = () => {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const {
    connectionStates,
    ensureAutoConnect,
    ecgSession,
    startEcgMeasurement,
    finishEcgMeasurement,
    cancelEcgMeasurement,
    resetEcgMeasurement,
  } = useV8DeviceManager();
  const [now, setNow] = useState(Date.now());
  const [actionBusy, setActionBusy] = useState(false);
  const allowLeaveRef = useRef(false);
  const connected = Object.values(connectionStates).some(
    state => state === 'connected',
  );
  const active = !!ecgSession && ACTIVE_PHASES.has(ecgSession.phase);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    return navigation.addListener('beforeRemove', (event: any) => {
      if (!active || allowLeaveRef.current) return;
      event.preventDefault();
      Alert.alert(
        'Stop ECG measurement?',
        'Leaving this screen will cancel the current recording.',
        [
          { text: 'Continue measuring', style: 'cancel' },
          {
            text: 'Stop and leave',
            style: 'destructive',
            onPress: () => {
              cancelEcgMeasurement().finally(() => {
                allowLeaveRef.current = true;
                navigation.dispatch(event.data.action);
              });
            },
          },
        ],
      );
    });
  }, [active, cancelEcgMeasurement, navigation]);

  const run = useCallback(
    async (action: () => Promise<void>, fallback: string) => {
      setActionBusy(true);
      try {
        await action();
      } catch (error) {
        Alert.alert('ECG', error instanceof Error ? error.message : fallback);
      } finally {
        setActionBusy(false);
      }
    },
    [],
  );

  const handleConnect = () =>
    run(async () => {
      await ensureAutoConnect();
      Alert.alert(
        'Connecting hand band',
        'Wait until the hand band shows as connected, then start ECG.',
      );
    }, 'Unable to connect the assigned hand band.');

  const handleStart = () =>
    run(startEcgMeasurement, 'Unable to start ECG measurement.');
  const handleFinish = () =>
    run(finishEcgMeasurement, 'Unable to finish ECG measurement.');

  const handleCancel = () => {
    Alert.alert('Cancel ECG?', 'The current recording will be discarded.', [
      { text: 'Keep measuring', style: 'cancel' },
      {
        text: 'Cancel recording',
        style: 'destructive',
        onPress: () => {
          run(cancelEcgMeasurement, 'Unable to cancel ECG measurement.').catch(
            () => {},
          );
        },
      },
    ]);
  };

  if (user?.role !== 'SENIOR') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.restricted}>
          <Icon name="lock-closed-outline" size={42} color="#8A817A" />
          <Text style={styles.restrictedTitle}>Senior access only</Text>
          <Text style={styles.restrictedText}>
            ECG measurements must be started by the senior wearing the hand
            band.
          </Text>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.secondaryButtonText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const elapsedMs = ecgSession
    ? (ecgSession.completedAt ?? now) - ecgSession.startedAt
    : 0;
  const phaseLabel = !ecgSession
    ? 'Ready'
    : ecgSession.phase === 'completed'
    ? 'Completed'
    : ecgSession.phase === 'failed'
    ? 'Needs retry'
    : ecgSession.phase === 'processing'
    ? 'Processing'
    : 'Measuring';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel="Go back"
          style={styles.headerButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="chevron-back" size={24} color="#2E2925" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Take ECG</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.connectionRow}>
          <View
            style={[
              styles.connectionDot,
              connected ? styles.connectedDot : styles.disconnectedDot,
            ]}
          />
          <Text style={styles.connectionText}>
            {connected ? 'Hand band connected' : 'Hand band not connected'}
          </Text>
          {!connected && !active ? (
            <TouchableOpacity disabled={actionBusy} onPress={handleConnect}>
              <Text style={styles.connectAction}>Connect</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {!ecgSession ? (
          <View style={styles.card}>
            <View style={styles.heroIcon}>
              <Icon name="pulse" size={38} color="#D64545" />
            </View>
            <Text style={styles.title}>Prepare for your ECG</Text>
            <Text style={styles.subtitle}>
              A steady recording usually takes at least 30 seconds.
            </Text>
            {[
              'Sit comfortably and rest your arm on a table.',
              'Wear the hand band snugly against clean, dry skin.',
              'Touch the ECG contact as instructed by your band.',
              'Stay still and do not speak during the recording.',
            ].map((instruction, index) => (
              <View key={instruction} style={styles.instructionRow}>
                <View style={styles.stepCircle}>
                  <Text style={styles.stepText}>{index + 1}</Text>
                </View>
                <Text style={styles.instructionText}>{instruction}</Text>
              </View>
            ))}
          </View>
        ) : (
          <>
            <View style={styles.measurementHeader}>
              <View>
                <Text style={styles.phaseLabel}>{phaseLabel}</Text>
                <Text style={styles.timer}>{formatDuration(elapsedMs)}</Text>
              </View>
              <View
                style={[
                  styles.phaseBadge,
                  ecgSession.phase === 'failed' && styles.failureBadge,
                ]}
              >
                {active ? (
                  <ActivityIndicator size="small" color="#D64545" />
                ) : (
                  <Icon
                    name={
                      ecgSession.phase === 'completed' ? 'checkmark' : 'alert'
                    }
                    size={16}
                    color="#D64545"
                  />
                )}
                <Text style={styles.phaseBadgeText}>
                  {ecgSession.samples.length.toLocaleString()} samples
                </Text>
              </View>
            </View>

            <EcgWaveform samples={ecgSession.samples} width={width - 48} />

            <View style={styles.statusCard}>
              <Text style={styles.statusTitle}>
                {ecgSession.statusMessage ?? 'Listening for hand band data…'}
              </Text>
              {ecgSession.error ? (
                <Text style={styles.errorText}>{ecgSession.error}</Text>
              ) : null}
              <View style={styles.metricsRow}>
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>
                    {ecgSession.heartRate ?? '—'}
                  </Text>
                  <Text style={styles.metricLabel}>Heart rate</Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>
                    {ecgSession.signalQuality ?? '—'}
                  </Text>
                  <Text style={styles.metricLabel}>Signal quality</Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>
                    {ecgSession.sampleRateHz ?? '—'}
                  </Text>
                  <Text style={styles.metricLabel}>Sample Hz</Text>
                </View>
              </View>
              {ecgSession.classification ? (
                <View style={styles.resultRow}>
                  <Icon
                    name="information-circle-outline"
                    size={18}
                    color="#6B625C"
                  />
                  <Text style={styles.resultText}>
                    Device result: {ecgSession.classification}
                  </Text>
                </View>
              ) : null}
            </View>
          </>
        )}

        {!ecgSession ? (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!connected || actionBusy}
            style={[
              styles.primaryButton,
              (!connected || actionBusy) && styles.disabledButton,
            ]}
            onPress={handleStart}
          >
            {actionBusy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Icon name="pulse" size={20} color="#FFFFFF" />
            )}
            <Text style={styles.primaryButtonText}>Start ECG</Text>
          </TouchableOpacity>
        ) : active ? (
          <View style={styles.actionRow}>
            <TouchableOpacity
              disabled={actionBusy}
              style={styles.cancelButton}
              onPress={handleCancel}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={actionBusy || ecgSession.phase === 'processing'}
              style={[
                styles.primaryButton,
                styles.finishButton,
                (actionBusy || ecgSession.phase === 'processing') &&
                  styles.disabledButton,
              ]}
              onPress={handleFinish}
            >
              {actionBusy || ecgSession.phase === 'processing' ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Icon name="stop" size={18} color="#FFFFFF" />
              )}
              <Text style={styles.primaryButtonText}>Finish ECG</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={resetEcgMeasurement}
          >
            <Icon name="refresh" size={19} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Take another ECG</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.disclaimer}>
          This recording is provided by the hand band and is not a diagnosis.
          Seek medical care if you feel unwell.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ECGMeasurementScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F4F1' },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: '#2E2925', fontSize: 19, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingBottom: 36 },
  connectionRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  connectionDot: { width: 9, height: 9, borderRadius: 5, marginRight: 8 },
  connectedDot: { backgroundColor: '#20A66A' },
  disconnectedDot: { backgroundColor: '#D26A5C' },
  connectionText: {
    flex: 1,
    color: '#504A45',
    fontSize: 13,
    fontWeight: '600',
  },
  connectAction: { color: '#C44D3D', fontSize: 13, fontWeight: '700' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 20,
    marginBottom: 16,
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FDECEC',
    marginBottom: 14,
  },
  title: {
    textAlign: 'center',
    fontSize: 22,
    color: '#2E2925',
    fontWeight: '700',
  },
  subtitle: {
    textAlign: 'center',
    color: '#756D67',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 20,
  },
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFF1E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  stepText: { color: '#B85D17', fontWeight: '800', fontSize: 13 },
  instructionText: { flex: 1, color: '#4D4641', fontSize: 14, lineHeight: 20 },
  measurementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
    paddingHorizontal: 2,
  },
  phaseLabel: {
    color: '#7A716B',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  timer: {
    color: '#2E2925',
    fontSize: 30,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  phaseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    backgroundColor: '#FDECEC',
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  failureBadge: { backgroundColor: '#FFF2E3' },
  phaseBadgeText: { color: '#8B4848', fontSize: 11, fontWeight: '700' },
  waveformWrap: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#FFF9F9',
    marginVertical: 12,
  },
  waveformEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 25,
  },
  waveformEmptyTitle: {
    color: '#755C5C',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
  },
  waveformEmptyText: {
    color: '#9A8585',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 3,
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  statusTitle: { color: '#39332F', fontSize: 15, fontWeight: '700' },
  errorText: { color: '#B33D32', fontSize: 13, marginTop: 6, lineHeight: 18 },
  metricsRow: { flexDirection: 'row', marginTop: 16 },
  metric: { flex: 1 },
  metricValue: { color: '#2E2925', fontSize: 17, fontWeight: '700' },
  metricLabel: { color: '#8A817A', fontSize: 10, marginTop: 2 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E7E0DB',
    marginTop: 14,
    paddingTop: 12,
  },
  resultText: { flex: 1, color: '#625B55', fontSize: 12 },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#D64545',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 20,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  disabledButton: { opacity: 0.45 },
  actionRow: { flexDirection: 'row', gap: 10 },
  cancelButton: {
    minHeight: 52,
    minWidth: 96,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  cancelButtonText: { color: '#9D3C35', fontSize: 14, fontWeight: '800' },
  finishButton: { flex: 1 },
  disclaimer: {
    color: '#8A817A',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginHorizontal: 14,
    marginTop: 16,
  },
  restricted: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  restrictedTitle: {
    color: '#2E2925',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 14,
  },
  restrictedText: {
    color: '#756D67',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 7,
  },
  secondaryButton: {
    marginTop: 22,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 13,
  },
  secondaryButtonText: { color: '#4D4641', fontWeight: '700' },
});
