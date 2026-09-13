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
import {
  idleHistoryReadStatus,
  type V8HistoryCategoryStatus,
} from '../src/v8/historyReader';

afterEach(() => jest.restoreAllMocks());

const reading = (
  categories: Record<string, Partial<V8HistoryCategoryStatus>> = {},
) => ({
  ...idleHistoryReadStatus,
  phase: 'reading' as const,
  currentType: 'spo2',
  totalCategories: 3,
  categories: Object.fromEntries(
    Object.entries(categories).map(([type, value]) => [
      type,
      {
        receivedRecords: 0,
        extractedSamples: 0,
        rejectedRecords: 0,
        invalidTimestampRecords: 0,
        responsePackets: 0,
        pagesRequested: 0,
        outcome: 'reading' as const,
        error: null,
        ...value,
      },
    ]),
  ),
});

it('reports the current read category without reusing a previous completed read', () => {
  expect(
    describeVitalsSyncProgress({ phase: 'reading' }, reading()).detail,
  ).toBe('Reading blood oxygen… Waiting for the band to answer…');
  expect(
    describeVitalsSyncProgress(
      { phase: 'reading' },
      { ...reading(), phase: 'complete' },
    ).detail,
  ).toBe('Preparing today’s readings…');
});

it('never reports zero responses or a total that falls back as categories change', () => {
  // A category is published the moment it is requested, before any packet can
  // have arrived. That instant must not read as "0 responses received".
  expect(
    describeVitalsSyncProgress(
      { phase: 'reading' },
      reading({ totalActivity: {} }),
    ).detail,
  ).toBe('Reading blood oxygen… Waiting for the band to answer…');
  // Totals span the whole read, so starting a second category cannot drop the
  // count back below what the first one already reported.
  const afterFirst = describeVitalsSyncProgress(
    { phase: 'reading' },
    reading({ totalActivity: { responsePackets: 4, extractedSamples: 120 } }),
  ).detail;
  expect(afterFirst).toBe('Reading blood oxygen… 4 responses received, 120 readings so far.');
  expect(
    describeVitalsSyncProgress(
      { phase: 'reading' },
      reading({
        totalActivity: { responsePackets: 4, extractedSamples: 120 },
        spo2: {},
      }),
    ).detail,
  ).toBe(afterFirst);
});

it('counts one response and one reading in the singular', () => {
  expect(
    describeVitalsSyncProgress(
      { phase: 'reading' },
      reading({ totalActivity: { responsePackets: 1, extractedSamples: 1 } }),
    ).detail,
  ).toBe('Reading blood oxygen… 1 response received, 1 reading so far.');
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
