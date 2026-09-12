import React from 'react';
import {
  AccessibilityInfo,
  Animated,
  Text,
  TouchableOpacity,
} from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import VitalsSyncProgressModal, {
  describeVitalsSyncProgress,
} from '../src/components/VitalsSyncProgressModal';
import { idleHistoryReadStatus } from '../src/v8/historyReader';

afterEach(() => jest.restoreAllMocks());

it('reports the current read category without reusing a previous completed read', () => {
  const history = {
    ...idleHistoryReadStatus,
    phase: 'reading' as const,
    currentType: 'spo2',
  };
  expect(describeVitalsSyncProgress({ phase: 'reading' }, history).detail).toBe(
    'Reading blood oxygen…',
  );
  expect(
    describeVitalsSyncProgress(
      { phase: 'reading' },
      { ...history, phase: 'complete' },
    ).detail,
  ).toBe('Preparing today’s readings…');
});

it('distinguishes unavailable readings, a confirmed upload, and errors', () => {
  expect(
    describeVitalsSyncProgress({ phase: 'uploading' }, idleHistoryReadStatus)
      .detail,
  ).toContain('Waiting for confirmation');
  expect(
    describeVitalsSyncProgress({ phase: 'finishing' }, idleHistoryReadStatus)
      .title,
  ).toBe('Vitals received');
  expect(
    describeVitalsSyncProgress(
      { phase: 'success', missingTypes: ['hrv'] },
      idleHistoryReadStatus,
    ).title,
  ).toBe('Available vitals synced');
  expect(
    describeVitalsSyncProgress(
      { phase: 'error', message: 'Band disconnected' },
      idleHistoryReadStatus,
    ).detail,
  ).toBe('Band disconnected');
});

it('respects reduced motion and allows hiding a running sync before showing completion', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const loop = jest.spyOn(Animated, 'loop');
  const onClose = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <VitalsSyncProgressModal
        visible
        progress={{ phase: 'reading' }}
        history={idleHistoryReadStatus}
        onClose={onClose}
      />,
    );
  });
  const text = () =>
    renderer.root
      .findAllByType(Text)
      .map(node => node.props.children)
      .flat()
      .join(' ');
  expect(text()).toContain('Hide progress');
  expect(text()).not.toContain('Sync complete');
  expect(loop).not.toHaveBeenCalled();
  await act(async () => {
    renderer.root.findByType(TouchableOpacity).props.onPress();
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => {
    renderer.update(
      <VitalsSyncProgressModal
        visible
        progress={{ phase: 'success', missingTypes: ['hrv'] }}
        history={idleHistoryReadStatus}
        onClose={onClose}
      />,
    );
  });
  expect(text()).toContain('Available vitals synced');
  expect(text()).toContain('HRV');
  expect(text()).toContain('Done');
  await act(async () => {
    renderer.unmount();
  });
});
