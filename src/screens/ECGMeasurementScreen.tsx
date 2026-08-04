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
  Platform,
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
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { useAuth } from '../context/AuthContext';
import {
  shareEcgReportPdf,
  shareEcgReportPng,
  type EcgReportShareMetadata,
} from '../utils/ecgReport';
import {
  downsampleEcg,
  downsampleWaveformEnvelope,
  isEcgStreamStalled,
  shouldAutoFinishEcg,
  splitWaveformIntoStrips,
} from '../v8/ecg';
import { useV8DeviceManager } from '../v8/useV8DeviceManager';

const ACTIVE_PHASES = new Set(['starting', 'measuring', 'processing']);
const MIN_ECG_SAMPLE_RATE_HZ = 250;
const PREFERRED_ECG_SAMPLE_RATE_HZ = 500;
const ECG_MAX_RECORDING_DURATION_MS = 30_000;
const PPG_MAX_RECORDING_DURATION_MS = 120_000;
const ECG_STALL_NOTICE_MS = 4_000;
const ECG_REPORT_STRIP_COUNT = 3;
const ECG_REPORT_STRIP_SECONDS = 10;

type MeasurementMode = 'ecg' | 'ppg';

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
  mode,
}: {
  samples: number[];
  width: number;
  mode: MeasurementMode;
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
          <Path
            d={path}
            stroke={mode === 'ecg' ? '#D64545' : '#E67E22'}
            strokeWidth="2"
            fill="none"
          />
        </Svg>
      ) : (
        <View style={styles.waveformEmpty}>
          <Icon
            name={mode === 'ecg' ? 'pulse-outline' : 'heart-outline'}
            size={34}
            color={mode === 'ecg' ? '#CC8A8A' : '#D89A62'}
          />
          <Text style={styles.waveformEmptyTitle}>
            Waiting for {mode === 'ecg' ? 'ECG' : 'PPG'} waveform
          </Text>
          <Text style={styles.waveformEmptyText}>
            {mode === 'ecg'
              ? 'Keep still and maintain light contact with the metal electrode.'
              : 'Keep still and maintain sensor contact with your wrist.'}
          </Text>
        </View>
      )}
    </View>
  );
};

const EcgReportStrip = ({
  samples,
  width,
  range,
  stripIndex,
}: {
  samples: number[];
  width: number;
  range: { min: number; max: number };
  stripIndex: number;
}) => {
  const chartWidth = Math.max(240, width);
  const chartHeight = 112;
  const path = useMemo(() => {
    const points = downsampleWaveformEnvelope(
      samples,
      Math.max(240, Math.floor(chartWidth * 2)),
    );
    if (points.length < 2 || samples.length < 2) return '';
    const amplitude = Math.max(1, range.max - range.min);
    const verticalPadding = 9;
    return points
      .map((point, index) => {
        const x = (point.index / (samples.length - 1)) * chartWidth;
        const clippedValue = Math.min(range.max, Math.max(range.min, point.value));
        const y =
          chartHeight -
          verticalPadding -
          ((clippedValue - range.min) / amplitude) *
            (chartHeight - verticalPadding * 2);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [chartWidth, range.max, range.min, samples]);

  const startSecond = stripIndex * ECG_REPORT_STRIP_SECONDS;
  const endSecond = startSecond + ECG_REPORT_STRIP_SECONDS;

  return (
    <View style={styles.reportStrip}>
      <View style={styles.reportStripLabelRow}>
        <Text style={styles.reportStripLabel}>
          Lead I-like · Strip {stripIndex + 1}
        </Text>
        <Text style={styles.reportStripTime}>
          {startSecond}–{endSecond} sec
        </Text>
      </View>
      <View style={styles.reportStripChart}>
        <Svg width={chartWidth} height={chartHeight}>
          <Rect width={chartWidth} height={chartHeight} fill="#FFFCFC" />
          {Array.from({ length: 49 }, (_, index) => index + 1).map(index => {
            const major = index % 5 === 0;
            return (
              <Line
                key={`report-v-${index}`}
                x1={(chartWidth / 50) * index}
                x2={(chartWidth / 50) * index}
                y1="0"
                y2={chartHeight}
                stroke={major ? '#E7AAAA' : '#F5DEDE'}
                strokeWidth={major ? 0.8 : 0.45}
              />
            );
          })}
          {Array.from({ length: 15 }, (_, index) => index + 1).map(index => {
            const major = index % 5 === 0;
            return (
              <Line
                key={`report-h-${index}`}
                x1="0"
                x2={chartWidth}
                y1={(chartHeight / 16) * index}
                y2={(chartHeight / 16) * index}
                stroke={major ? '#E7AAAA' : '#F5DEDE'}
                strokeWidth={major ? 0.8 : 0.45}
              />
            );
          })}
          {path ? (
            <Path
              d={path}
              stroke="#E54848"
              strokeWidth="1.35"
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
          ) : null}
        </Svg>
      </View>
    </View>
  );
};

const EcgReportWaveform = ({
  samples,
  width,
  sampleRateHz,
}: {
  samples: number[];
  width: number;
  sampleRateHz: number | null;
}) => {
  const strips = useMemo(
    () => splitWaveformIntoStrips(samples, ECG_REPORT_STRIP_COUNT),
    [samples],
  );
  const range = useMemo(() => {
    if (samples.length === 0) return { min: -1, max: 1 };
    const sorted = [...samples].sort((a, b) => a - b);
    const lowerIndex = Math.floor((sorted.length - 1) * 0.01);
    const upperIndex = Math.ceil((sorted.length - 1) * 0.99);
    let min = sorted[lowerIndex];
    let max = sorted[upperIndex];
    if (max <= min) {
      min -= 1;
      max += 1;
    }
    const padding = (max - min) * 0.08;
    return { min: min - padding, max: max + padding };
  }, [samples]);

  return (
    <View style={styles.reportWaveformSection}>
      <View style={styles.reportWaveformHeadingRow}>
        <View>
          <Text style={styles.reportWaveformTitle}>30-second ECG recording</Text>
          <Text style={styles.reportWaveformSubtitle}>
            Three consecutive 10-second strips
          </Text>
        </View>
        <Text style={styles.reportWaveformRate}>
          {sampleRateHz ? `${sampleRateHz} Hz` : 'Raw ECG'}
        </Text>
      </View>
      {strips.map((strip, index) => (
        <EcgReportStrip
          key={`ecg-report-strip-${index}`}
          samples={strip}
          width={width}
          range={range}
          stripIndex={index}
        />
      ))}
      <Text style={styles.reportWaveformFootnote}>
        Time grid: 0.2 sec small divisions · amplitude auto-scaled from raw device data
      </Text>
    </View>
  );
};

const ECGMeasurementScreen = () => {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const { user, selectedSenior, selectedSeniorHandBandMacs } = useAuth();
  const {
    connectionStates,
    ensureAutoConnect,
    ecgSession,
    startEcgMeasurement,
    finishEcgMeasurement,
    cancelEcgMeasurement,
    resetEcgMeasurement,
  } = useV8DeviceManager();
  const [measurementMode, setMeasurementMode] =
    useState<MeasurementMode>('ecg');
  const [now, setNow] = useState(Date.now());
  const [actionBusy, setActionBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState<'png' | 'pdf' | null>(null);
  const allowLeaveRef = useRef(false);
  const reportRef = useRef<View>(null);
  const autoFinishSessionRef = useRef<string | null>(null);
  const connected = Object.values(connectionStates).some(
    state => state === 'connected',
  );
  const ecgSeniorId =
    user?.role === 'SENIOR'
      ? user.user_id?.trim()
      : user?.role === 'CARE_TAKER' || user?.role === 'GUARDIAN'
        ? selectedSenior?.userId?.trim()
        : '';
  const canUseEcg =
    !!ecgSeniorId && selectedSeniorHandBandMacs.length > 0;
  const active = !!ecgSession && ACTIVE_PHASES.has(ecgSession.phase);
  const reportReady = ecgSession?.phase === 'completed';
  const sessionMode = ecgSession?.requestedMode ?? measurementMode;
  const modeLabel = sessionMode === 'ecg' ? 'ECG' : 'PPG';
  const reportSeniorName = useMemo(() => {
    if (user?.role === 'SENIOR') {
      return [user.first_name, user.last_name].filter(Boolean).join(' ') ||
        'Senior';
    }
    return selectedSenior
      ? [selectedSenior.firstName, selectedSenior.lastName]
          .filter(Boolean)
          .join(' ') || 'Selected senior'
      : 'Selected senior';
  }, [
    selectedSenior,
    user?.first_name,
    user?.last_name,
    user?.role,
  ]);

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
        `Stop ${modeLabel} measurement?`,
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
  }, [active, cancelEcgMeasurement, modeLabel, navigation]);

  const run = useCallback(
    async (action: () => Promise<void>, fallback: string) => {
      setActionBusy(true);
      try {
        await action();
      } catch (error) {
        Alert.alert(modeLabel, error instanceof Error ? error.message : fallback);
      } finally {
        setActionBusy(false);
      }
    },
    [modeLabel],
  );

  const handleConnect = () =>
    run(async () => {
      await ensureAutoConnect();
      Alert.alert(
        'Connecting hand band',
        `Wait until the hand band shows as connected, then start ${modeLabel}.`,
      );
    }, 'Unable to connect the assigned hand band.');

  const handleStart = () =>
    run(
      () => startEcgMeasurement(measurementMode),
      `Unable to start ${measurementMode === 'ecg' ? 'ECG' : 'PPG'} measurement.`,
    );
  const handleFinish = useCallback(
    () => run(finishEcgMeasurement, `Unable to finish ${modeLabel} measurement.`),
    [finishEcgMeasurement, modeLabel, run],
  );

  useEffect(() => {
    if (!ecgSession || ecgSession.phase !== 'measuring') return;
    if (
      !shouldAutoFinishEcg(
        ecgSession,
        now,
        ecgSession.requestedMode === 'ecg'
          ? ECG_MAX_RECORDING_DURATION_MS
          : PPG_MAX_RECORDING_DURATION_MS,
      )
    ) {
      return;
    }
    if (autoFinishSessionRef.current === ecgSession.id) return;

    autoFinishSessionRef.current = ecgSession.id;
    handleFinish().catch(() => {});
  }, [ecgSession, handleFinish, now]);

  const handleCancel = () => {
    Alert.alert(`Cancel ${modeLabel}?`, 'The current recording will be discarded.', [
      { text: 'Keep measuring', style: 'cancel' },
      {
        text: 'Cancel recording',
        style: 'destructive',
        onPress: () => {
          run(cancelEcgMeasurement, `Unable to cancel ${modeLabel} measurement.`).catch(
            () => {},
          );
        },
      },
    ]);
  };

  const captureReportPng = useCallback(async (): Promise<string> => {
    if (!reportRef.current || !ecgSession || !reportReady) {
      throw new Error('Complete the recording before exporting the report.');
    }
    return captureRef(reportRef, {
      format: 'png',
      quality: 1,
      result: 'base64',
    });
  }, [ecgSession, reportReady]);

  const buildShareMetadata = useCallback((): EcgReportShareMetadata => {
    const recordedDate = new Date(
      ecgSession?.completedAt ?? ecgSession?.startedAt ?? Date.now(),
    );
    const datePart = recordedDate.toISOString().slice(0, 10);
    const safeSeniorName = reportSeniorName
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    return {
      fileStem: `healthsoft-${sessionMode}-${safeSeniorName || 'senior'}-${datePart}`,
      title: `Healthsoft ${modeLabel} report`,
      subject: `Healthsoft ${modeLabel} report - ${reportSeniorName} - ${datePart}`,
    };
  }, [
    ecgSession?.completedAt,
    ecgSession?.startedAt,
    modeLabel,
    reportSeniorName,
    sessionMode,
  ]);

  const handleShareReport = useCallback(
    async (format: 'png' | 'pdf') => {
      if (exportBusy) return;
      setExportBusy(format);
      try {
        const pngBase64 = await captureReportPng();
        const metadata = buildShareMetadata();
        if (format === 'png') {
          await shareEcgReportPng(pngBase64, metadata);
        } else {
          await shareEcgReportPdf(pngBase64, metadata);
        }
      } catch (error) {
        Alert.alert(
          'Unable to share report',
          error instanceof Error
            ? error.message
            : 'The waveform report could not be created.',
        );
      } finally {
        setExportBusy(null);
      }
    },
    [buildShareMetadata, captureReportPng, exportBusy],
  );

  if (!canUseEcg) {
    const needsSeniorSelection =
      (user?.role === 'CARE_TAKER' || user?.role === 'GUARDIAN') &&
      !selectedSenior?.userId;
    const restrictionMessage = needsSeniorSelection
      ? 'Select a senior before starting a waveform measurement.'
      : ecgSeniorId
        ? 'The selected senior does not have an assigned hand band.'
        : 'ECG and PPG measurements are available to seniors, caretakers, and guardians.';
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.restricted}>
          <Icon name="lock-closed-outline" size={42} color="#8A817A" />
          <Text style={styles.restrictedTitle}>Measurement unavailable</Text>
          <Text style={styles.restrictedText}>
            {restrictionMessage}
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
  const missingMetricStatus =
    active && ecgSession.samples.length === 0
      ? 'Waiting'
      : active
        ? 'Receiving'
        : 'Not provided';
  const waveformSource = ecgSession?.waveformSource ?? null;
  const measuredSampleRateHz = ecgSession?.sampleRateHz ?? null;
  const streamStalled =
    ecgSession != null &&
    isEcgStreamStalled(ecgSession, now, ECG_STALL_NOTICE_MS);
  const samplingAssessment =
    waveformSource == null
      ? `Waiting for the ${modeLabel} signal channel…`
      : waveformSource === 'ppg'
        ? 'Optical PPG pulse waveform detected.'
        : measuredSampleRateHz == null
          ? 'ECG channel detected. Measuring its sample frequency…'
          : measuredSampleRateHz >= PREFERRED_ECG_SAMPLE_RATE_HZ
            ? `${measuredSampleRateHz} Hz ECG meets the preferred acquisition target.`
            : measuredSampleRateHz >= MIN_ECG_SAMPLE_RATE_HZ
              ? `${measuredSampleRateHz} Hz ECG meets the minimum acquisition target.`
              : `${measuredSampleRateHz} Hz ECG is below the 250 Hz minimum target.`;
  const signalSourceLabel = waveformSource == null
    ? `Signal: waiting for ${modeLabel}`
    : waveformSource === 'ecg'
      ? 'Signal: ECG contact electrode'
      : 'Signal: optical PPG sensor';
  const signalProtocolLabel = waveformSource == null
    ? null
    : Platform.OS === 'android' &&
        waveformSource === 'ecg' &&
        ecgSession?.waveformField?.toLowerCase() === 'arrayppgrawdata'
      ? 'Android protocol 0x07 · SDK field arrayPpgRawData (ECG)'
      : [
          ecgSession?.waveformDataType
            ? `dataType ${ecgSession.waveformDataType}`
            : null,
          ecgSession?.waveformField ?? null,
        ]
          .filter(Boolean)
          .join(' · ');
  const displayStatusMessage =
    streamStalled
      ? 'Signal paused — waiting for more samples from the hand band'
      : reportReady &&
          waveformSource === 'ecg' &&
          measuredSampleRateHz != null &&
          measuredSampleRateHz < MIN_ECG_SAMPLE_RATE_HZ
        ? 'Recording completed with insufficient ECG sample frequency'
        : ecgSession?.statusMessage ?? 'Listening for hand band data…';

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
        <Text style={styles.headerTitle}>Take {modeLabel}</Text>
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
          <>
            <View style={styles.modeSelectorRow}>
              {(['ecg', 'ppg'] as const).map(mode => {
                const selected = measurementMode === mode;
                const isEcg = mode === 'ecg';
                return (
                  <TouchableOpacity
                    key={mode}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[
                      styles.modeCard,
                      selected &&
                        (isEcg
                          ? styles.modeCardActiveEcg
                          : styles.modeCardActivePpg),
                    ]}
                    onPress={() => setMeasurementMode(mode)}
                  >
                    <Icon
                      name={isEcg ? 'pulse' : 'heart'}
                      size={23}
                      color={
                        selected
                          ? isEcg
                            ? '#D64545'
                            : '#E67E22'
                          : '#8A817A'
                      }
                    />
                    <Text style={styles.modeCardTitle}>
                      {isEcg ? 'ECG' : 'PPG'}
                    </Text>
                    <Text style={styles.modeCardSubtitle}>
                      {isEcg ? 'Contact electrode' : 'Optical pulse'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.card}>
              <View
                style={[
                  styles.heroIcon,
                  measurementMode === 'ppg' && styles.heroIconPpg,
                ]}
              >
                <Icon
                  name={measurementMode === 'ecg' ? 'pulse' : 'heart'}
                  size={38}
                  color={measurementMode === 'ecg' ? '#D64545' : '#E67E22'}
                />
              </View>
              <Text style={styles.title}>Prepare for your {modeLabel}</Text>
              <Text style={styles.subtitle}>
                {measurementMode === 'ecg'
                  ? 'The contact-electrode ECG records automatically for 30 seconds.'
                  : 'Record the optical pulse waveform for up to 2 minutes.'}
              </Text>
              {(measurementMode === 'ecg'
                ? [
                    'Wear the band snugly on your wrist, about one finger above the wrist bone.',
                    'Sit with both feet flat and rest your band-wearing arm naturally on a table.',
                    'With your other hand, gently place your index finger on the metal contact at the center of the band.',
                    'Maintain light contact and remain still and quiet for the full 30 seconds.',
                  ]
                : [
                    'Sit comfortably and keep your arm relaxed.',
                    'Wear the band snugly against clean, dry skin.',
                    'Keep the optical sensor in steady contact with your wrist.',
                    'Stay still and do not speak during the recording.',
                  ]
              ).map((instruction, index) => (
                <View key={instruction} style={styles.instructionRow}>
                  <View
                    style={[
                      styles.stepCircle,
                      measurementMode === 'ecg' && styles.stepCircleEcg,
                    ]}
                  >
                    <Text
                      style={[
                        styles.stepText,
                        measurementMode === 'ecg' && styles.stepTextEcg,
                      ]}
                    >
                      {index + 1}
                    </Text>
                  </View>
                  <Text style={styles.instructionText}>{instruction}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <View
            ref={reportRef}
            collapsable={false}
            style={reportReady ? styles.reportCard : undefined}
          >
            {reportReady ? (
              <View style={styles.reportHeader}>
                <View style={styles.reportBrandRow}>
                  <View style={styles.reportBrandIcon}>
                    <Icon name="pulse" size={19} color="#FFFFFF" />
                  </View>
                  <View>
                    <Text style={styles.reportBrand}>HEALTHSOFT</Text>
                    <Text style={styles.reportType}>
                      {waveformSource === 'ecg' &&
                      measuredSampleRateHz != null &&
                      measuredSampleRateHz >= MIN_ECG_SAMPLE_RATE_HZ
                        ? 'Single-lead ECG waveform report'
                        : waveformSource === 'ecg'
                          ? 'Low-rate device waveform report'
                        : waveformSource === 'ppg'
                          ? 'Pulse waveform (PPG) report'
                          : 'Hand band waveform report'}
                    </Text>
                  </View>
                </View>
                <View style={styles.reportMetaRow}>
                  <View>
                    <Text style={styles.reportMetaLabel}>Senior</Text>
                    <Text style={styles.reportMetaValue}>
                      {reportSeniorName}
                    </Text>
                  </View>
                  <View style={styles.reportMetaRight}>
                    <Text style={styles.reportMetaLabel}>Recorded</Text>
                    <Text style={styles.reportMetaValue}>
                      {new Date(
                        ecgSession.completedAt ?? ecgSession.startedAt,
                      ).toLocaleString()}
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}
            {reportReady ? (
              <View style={styles.reportSummaryRow}>
                <View style={styles.reportSummaryMetric}>
                  <Text style={styles.reportSummaryValue}>
                    {ecgSession.heartRate ?? '—'}
                  </Text>
                  <Text style={styles.reportSummaryLabel}>Heart rate bpm</Text>
                </View>
                <View style={styles.reportSummaryDivider} />
                <View style={styles.reportSummaryMetric}>
                  <Text style={styles.reportSummaryValue}>
                    {formatDuration(elapsedMs)}
                  </Text>
                  <Text style={styles.reportSummaryLabel}>Duration</Text>
                </View>
                <View style={styles.reportSummaryDivider} />
                <View style={styles.reportSummaryMetric}>
                  <Text style={styles.reportSummaryValue}>
                    {ecgSession.samples.length.toLocaleString()}
                  </Text>
                  <Text style={styles.reportSummaryLabel}>Samples</Text>
                </View>
              </View>
            ) : (
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
                    <Icon name="alert" size={16} color="#D64545" />
                  )}
                  <Text style={styles.phaseBadgeText}>
                    {ecgSession.samples.length.toLocaleString()} samples
                  </Text>
                </View>
              </View>
            )}

            {reportReady && waveformSource === 'ecg' ? (
              <EcgReportWaveform
                samples={ecgSession.samples}
                width={width - 80}
                sampleRateHz={measuredSampleRateHz}
              />
            ) : (
              <EcgWaveform
                samples={ecgSession.samples}
                width={reportReady ? width - 80 : width - 48}
                mode={sessionMode}
              />
            )}

            <View style={styles.statusCard}>
              <Text style={styles.statusTitle}>
                {displayStatusMessage}
              </Text>
              {ecgSession.error ? (
                <Text style={styles.errorText}>{ecgSession.error}</Text>
              ) : null}
              <View style={styles.signalSourceCard}>
                <Text style={styles.signalSourceTitle}>{signalSourceLabel}</Text>
                {signalProtocolLabel ? (
                  <Text style={styles.signalSourceDetail}>
                    {signalProtocolLabel}
                  </Text>
                ) : null}
              </View>
              <View
                style={[
                  styles.samplingNotice,
                  waveformSource === 'ecg' &&
                    ecgSession.sampleRateHz != null &&
                    ecgSession.sampleRateHz < MIN_ECG_SAMPLE_RATE_HZ
                    ? styles.samplingWarning
                    : null,
                ]}
              >
                <Icon
                  name={
                    waveformSource === 'ecg' &&
                    ecgSession.sampleRateHz != null &&
                    ecgSession.sampleRateHz >= MIN_ECG_SAMPLE_RATE_HZ
                      ? 'checkmark-circle-outline'
                      : 'information-circle-outline'
                  }
                  size={17}
                  color={
                    waveformSource === 'ecg' &&
                      ecgSession.sampleRateHz != null &&
                      ecgSession.sampleRateHz < MIN_ECG_SAMPLE_RATE_HZ
                      ? '#A85B20'
                      : '#71665E'
                  }
                />
                <Text style={styles.samplingNoticeText}>
                  {samplingAssessment}
                </Text>
              </View>
              <View style={styles.metricsRow}>
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>
                    {ecgSession.sampleRateHz ?? missingMetricStatus}
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
            {reportReady ? (
              <Text style={styles.reportDisclaimer}>
                {waveformSource === 'ppg'
                  ? 'Optical pulse waveform (PPG), not an electrocardiogram. It must not be interpreted as ECG.'
                  : 'Device-generated single-lead waveform for informational use only. Time uses the received sample rate; amplitude is auto-scaled raw device data, not calibrated mV. This report is not a medical diagnosis.'}
              </Text>
            ) : null}
          </View>
        )}

        {!ecgSession ? (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!connected || actionBusy}
            style={[
              styles.primaryButton,
              measurementMode === 'ppg' && styles.primaryButtonPpg,
              (!connected || actionBusy) && styles.disabledButton,
            ]}
            onPress={handleStart}
          >
            {actionBusy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Icon
                name={measurementMode === 'ecg' ? 'pulse' : 'heart'}
                size={20}
                color="#FFFFFF"
              />
            )}
            <Text style={styles.primaryButtonText}>Start {modeLabel}</Text>
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
                sessionMode === 'ppg' && styles.primaryButtonPpg,
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
              <Text style={styles.primaryButtonText}>Finish {modeLabel}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.completedActions}>
            {reportReady ? (
              <View style={styles.shareRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={!!exportBusy}
                  style={[
                    styles.shareButton,
                    exportBusy && styles.disabledButton,
                  ]}
                  onPress={() => handleShareReport('png')}
                >
                  {exportBusy === 'png' ? (
                    <ActivityIndicator color="#9D3C35" />
                  ) : (
                    <Icon name="image-outline" size={18} color="#9D3C35" />
                  )}
                  <Text style={styles.shareButtonText}>Share PNG</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={!!exportBusy}
                  style={[
                    styles.shareButton,
                    exportBusy && styles.disabledButton,
                  ]}
                  onPress={() => handleShareReport('pdf')}
                >
                  {exportBusy === 'pdf' ? (
                    <ActivityIndicator color="#9D3C35" />
                  ) : (
                    <Icon
                      name="document-text-outline"
                      size={18}
                      color="#9D3C35"
                    />
                  )}
                  <Text style={styles.shareButtonText}>Share PDF</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity
              style={[
                styles.primaryButton,
                sessionMode === 'ppg' && styles.primaryButtonPpg,
              ]}
              onPress={resetEcgMeasurement}
            >
              <Icon name="refresh" size={19} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>Take another {modeLabel}</Text>
            </TouchableOpacity>
          </View>
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
  modeSelectorRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  modeCard: {
    flex: 1,
    minHeight: 96,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  modeCardActiveEcg: {
    borderColor: '#D64545',
    backgroundColor: '#FFF5F5',
  },
  modeCardActivePpg: {
    borderColor: '#E67E22',
    backgroundColor: '#FFF8F0',
  },
  modeCardTitle: {
    color: '#3E3833',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 5,
  },
  modeCardSubtitle: { color: '#8A817A', fontSize: 11, marginTop: 2 },
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
  heroIconPpg: { backgroundColor: '#FFF1E1' },
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
  stepCircleEcg: { backgroundColor: '#FDECEC' },
  stepTextEcg: { color: '#D64545' },
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
  reportWaveformSection: {
    marginTop: 12,
    marginBottom: 14,
  },
  reportWaveformHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  reportWaveformTitle: {
    color: '#39332F',
    fontSize: 13,
    fontWeight: '800',
  },
  reportWaveformSubtitle: {
    color: '#8A817A',
    fontSize: 9,
    marginTop: 2,
  },
  reportWaveformRate: {
    color: '#8B4848',
    fontSize: 10,
    fontWeight: '800',
  },
  reportStrip: { marginBottom: 9 },
  reportStripLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  reportStripLabel: {
    color: '#554D47',
    fontSize: 8,
    fontWeight: '700',
  },
  reportStripTime: { color: '#8A817A', fontSize: 8 },
  reportStripChart: {
    height: 112,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E9CACA',
    backgroundColor: '#FFFCFC',
  },
  reportWaveformFootnote: {
    color: '#9A8F88',
    fontSize: 7.5,
    textAlign: 'center',
    marginTop: -1,
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
  },
  reportHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E0DB',
    paddingBottom: 14,
    marginBottom: 8,
  },
  reportBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reportBrandIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#D64545',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  reportBrand: {
    color: '#2E2925',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
  },
  reportType: { color: '#756D67', fontSize: 11, marginTop: 2 },
  reportMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  reportMetaRight: { alignItems: 'flex-end', flex: 1, marginLeft: 12 },
  reportMetaLabel: {
    color: '#938A83',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  reportMetaValue: {
    color: '#403A35',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  reportSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF7F5',
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  reportSummaryMetric: { flex: 1, alignItems: 'center' },
  reportSummaryValue: {
    color: '#342E2A',
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  reportSummaryLabel: {
    color: '#8A817A',
    fontSize: 7.5,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  reportSummaryDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: '#DDD4CE',
  },
  reportDisclaimer: {
    color: '#8A817A',
    fontSize: 9,
    lineHeight: 13,
    textAlign: 'center',
    marginHorizontal: 8,
    marginTop: -4,
  },
  statusTitle: { color: '#39332F', fontSize: 15, fontWeight: '700' },
  errorText: { color: '#B33D32', fontSize: 13, marginTop: 6, lineHeight: 18 },
  signalSourceCard: {
    borderRadius: 12,
    backgroundColor: '#F7F4F1',
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginTop: 11,
  },
  signalSourceTitle: { color: '#403A35', fontSize: 12, fontWeight: '800' },
  signalSourceDetail: { color: '#756D67', fontSize: 10, marginTop: 3 },
  samplingNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    borderRadius: 12,
    backgroundColor: '#F5F2EF',
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginTop: 11,
  },
  samplingWarning: { backgroundColor: '#FFF1E4' },
  samplingNoticeText: {
    flex: 1,
    color: '#655D57',
    fontSize: 11,
    lineHeight: 15,
  },
  metricsRow: { alignItems: 'center', marginTop: 16 },
  metric: { alignItems: 'center' },
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
  primaryButtonPpg: { backgroundColor: '#E67E22' },
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
  completedActions: { gap: 10 },
  shareRow: { flexDirection: 'row', gap: 10 },
  shareButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5CACA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareButtonText: { color: '#9D3C35', fontSize: 13, fontWeight: '800' },
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
