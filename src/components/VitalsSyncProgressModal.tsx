import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  describeHistoryTransfer,
  historyTypeLabels,
  type V8HistoryReadStatus,
} from '../v8/historyReader';
import type { V8VitalsUploadPhase } from '../v8/models';

export type VitalsSyncProgress = {
  phase:
    | V8VitalsUploadPhase
    | 'preparing'
    | 'reading'
    | 'success'
    | 'error'
    | 'waiting';
  message?: string;
  missingTypes?: string[];
};

const STAGES = [
  { label: 'Read band', phase: 'reading' },
  { label: 'Check', phase: 'verifying' },
  { label: 'Upload', phase: 'uploading' },
  { label: 'Finish', phase: 'finishing' },
] as const;

export function describeVitalsSyncProgress(
  progress: VitalsSyncProgress,
  history: V8HistoryReadStatus,
) {
  switch (progress.phase) {
    case 'preparing':
      return {
        title: 'Getting ready',
        detail: 'Checking your hand band connection…',
      };
    case 'reading': {
      const current = history.phase === 'reading' ? history.currentType : null;
      return {
        title: 'Reading your hand band',
        detail: current
          ? `Reading ${historyTypeLabels[current] ?? 'vitals'}… ${describeHistoryTransfer(history)}`.trim()
          : 'Preparing today’s readings…',
      };
    }
    case 'verifying':
      return {
        title: 'Checking your readings',
        detail:
          'Confirming the band belongs to this senior and preparing today’s data.',
      };
    case 'uploading':
      return {
        title: 'Uploading your vitals',
        detail: 'Sending today’s readings securely. Waiting for confirmation…',
      };
    case 'finishing':
      return {
        title: 'Vitals received',
        detail: 'Saving the sync time on this phone…',
      };
    case 'success':
      return {
        title: progress.missingTypes?.length
          ? 'Available vitals synced'
          : 'Sync complete',
        detail: progress.missingTypes?.length
          ? 'Your available readings are saved. Some readings could not be downloaded.'
          : 'Today’s hand band readings are saved and ready to view.',
      };
    case 'waiting':
      return {
        title: 'Waiting for your band',
        detail:
          progress.message ??
          'Connect your hand band, then tap Sync now again.',
      };
    case 'error':
      return {
        title: 'Couldn’t complete sync',
        detail: progress.message ?? 'Please try syncing again.',
      };
  }
}

export default function VitalsSyncProgressModal({
  visible,
  progress,
  history,
  onClose,
}: {
  visible: boolean;
  progress: VitalsSyncProgress | null;
  history: V8HistoryReadStatus;
  onClose: () => void;
}) {
  const [reduceMotion, setReduceMotion] = useState(true);
  const rotation = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(1)).current;
  const phase = progress?.phase;
  const busy = !!phase && !['success', 'error', 'waiting'].includes(phase);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (mounted) setReduceMotion(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    rotation.setValue(0);
    if (!visible || !busy || reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, reduceMotion, rotation, visible]);

  useEffect(() => {
    if (!visible || reduceMotion) {
      reveal.setValue(1);
      return;
    }
    reveal.setValue(0.8);
    const animation = Animated.spring(reveal, {
      toValue: 1,
      friction: 7,
      tension: 70,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [phase, reduceMotion, reveal, visible]);

  if (!progress) return null;
  const copy = describeVitalsSyncProgress(progress, history);
  const success = phase === 'success';
  const color = phase === 'error' ? '#B42318' : '#0B8A5B';
  const currentStep = STAGES.findIndex(step => step.phase === phase);
  const completedCategories = Object.values(history.categories).filter(
    category =>
      category.outcome !== 'reading' && category.outcome !== 'notRead',
  ).length;
  // The denominator is what this read will attempt. Counting every label the
  // app can parse said "of 7" for a sync that only ever asks for three, and
  // counting the categories published so far grew the denominator as it went.
  const plannedCategories = history.totalCategories;
  const icon = success
    ? 'checkmark'
    : phase === 'error'
    ? 'alert'
    : phase === 'uploading' || phase === 'finishing'
    ? 'cloud-upload-outline'
    : 'watch-outline';

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.content} bounces={false}>
            <Text style={styles.eyebrow}>HAND BAND SYNC</Text>
            <View style={styles.orbit}>
              <Animated.View
                style={[
                  styles.ring,
                  {
                    borderTopColor: color,
                    transform: [
                      {
                        rotate: rotation.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg'],
                        }),
                      },
                    ],
                  },
                ]}
              />
              <Animated.View
                style={[styles.iconCircle, { transform: [{ scale: reveal }] }]}
              >
                <Icon name={icon} size={38} color={color} />
              </Animated.View>
            </View>
            <View accessibilityLiveRegion="polite">
              <Text style={styles.title}>{copy.title}</Text>
              <Text style={styles.detail}>{copy.detail}</Text>
            </View>
            {phase === 'reading' &&
            history.phase === 'reading' &&
            plannedCategories > 0 ? (
              <Text style={styles.readCount}>
                {completedCategories} of {plannedCategories} reading groups
                checked
              </Text>
            ) : null}
            {busy || success ? (
              <View style={styles.steps}>
                {STAGES.map((step, index) => {
                  const done = success || index < currentStep;
                  const active = index === currentStep;
                  return (
                    <View key={step.phase} style={styles.step}>
                      <View
                        style={[
                          styles.stepDot,
                          (done || active) && styles.stepActive,
                        ]}
                      >
                        {done ? (
                          <Icon name="checkmark" size={12} color="#FFFFFF" />
                        ) : (
                          <Text
                            style={[
                              styles.stepNumber,
                              active && styles.activeNumber,
                            ]}
                          >
                            {index + 1}
                          </Text>
                        )}
                      </View>
                      <Text
                        style={[
                          styles.stepLabel,
                          (done || active) && styles.activeLabel,
                        ]}
                      >
                        {step.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
            {success && progress.missingTypes?.length ? (
              <Text style={styles.missing}>
                Unavailable:{' '}
                {progress.missingTypes
                  .map(type => historyTypeLabels[type] ?? type)
                  .join(', ')}
                .
              </Text>
            ) : null}
            {busy ? (
              <Text style={styles.hint}>
                Keep the band near your phone. Hiding this panel keeps the sync
                running.
              </Text>
            ) : null}
            <TouchableOpacity
              style={styles.button}
              onPress={onClose}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>
                {busy ? 'Hide progress' : 'Done'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 32, 42, 0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  card: { backgroundColor: '#FFFFFF', borderRadius: 28, maxHeight: '90%' },
  content: { padding: 24, alignItems: 'center' },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.8,
    fontWeight: '700',
    color: '#6B7D73',
  },
  orbit: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 24,
  },
  ring: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#E5F3EC',
  },
  iconCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#F0FAF4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 23,
    fontWeight: '800',
    color: '#1B2A4A',
    textAlign: 'center',
  },
  detail: {
    fontSize: 14,
    lineHeight: 21,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 10,
  },
  readCount: { fontSize: 12, color: '#0B8A5B', marginTop: 12 },
  steps: { flexDirection: 'row', width: '100%', marginVertical: 24 },
  step: { flex: 1, alignItems: 'center', gap: 6 },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EEF2F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepActive: { backgroundColor: '#0B8A5B' },
  stepNumber: { fontSize: 11, color: '#7C8A82', fontWeight: '700' },
  activeNumber: { color: '#FFFFFF' },
  stepLabel: { fontSize: 11, color: '#7C8A82', textAlign: 'center' },
  activeLabel: { color: '#0B8A5B', fontWeight: '700' },
  missing: {
    fontSize: 12,
    lineHeight: 18,
    color: '#946200',
    backgroundColor: '#FFF8E8',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  hint: { fontSize: 12, lineHeight: 18, color: '#7C8A82', textAlign: 'center' },
  button: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: '#0B8A5B',
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 22,
  },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
