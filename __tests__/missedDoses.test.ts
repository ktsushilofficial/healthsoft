import {
  countMissedDosesOnDay,
  formatAlarmTime,
  formatMissedDoseDrug,
  groupMissedDosesByDay,
  missedDoseDayLabel,
  parseMissedDoses,
} from '../src/utils/missedDoses';

// Sample payload shared by the backend team for this endpoint.
const SAMPLE = [
  { date: '2026-10-15', alarmTime: '12:54', deviceSn: '08-00002442e3324d5e', drugs: [{ drugName: 'Dolo', drugAmount: '1' }], reportedAt: 1792049641116 },
  { date: '2026-10-15', alarmTime: '12:00', deviceSn: '08-00002442e3324d5e', drugs: [], reportedAt: 1792046401470 },
  { date: '2026-10-15', alarmTime: '10:45', deviceSn: '08-00002442e3324d5e', drugs: [], reportedAt: 1792041901406 },
  { date: '2026-10-15', alarmTime: '10:44', deviceSn: '08-00002442e3324d5e', drugs: [], reportedAt: 1792041301441 },
  { date: '2026-10-14', alarmTime: '04:02', deviceSn: '08-00002442e3324d5e', drugs: [], reportedAt: 1791979924043 },
];

const NOW = new Date(2026, 9, 15, 17, 0);

describe('parseMissedDoses', () => {
  it('keeps the sample payload intact, newest alarm first', () => {
    const shuffled = [SAMPLE[4], SAMPLE[2], SAMPLE[0], SAMPLE[3], SAMPLE[1]];
    expect(parseMissedDoses(shuffled)).toEqual(SAMPLE);
  });

  it('drops malformed rows and drugs instead of throwing', () => {
    expect(parseMissedDoses(null)).toEqual([]);
    expect(parseMissedDoses({ data: SAMPLE })).toEqual([]);
    expect(
      parseMissedDoses([
        null,
        { alarmTime: '09:00' },
        { date: '15/10/2026', alarmTime: '09:00' },
        {
          date: '2026-10-15',
          alarmTime: '09:00',
          drugs: [null, { drugAmount: '2' }, { drugName: ' Crocin ', drugAmount: 2 }],
        },
      ]),
    ).toEqual([
      {
        date: '2026-10-15',
        alarmTime: '09:00',
        deviceSn: '',
        drugs: [{ drugName: 'Crocin', drugAmount: '2' }],
        reportedAt: 0,
      },
    ]);
  });
});

describe('formatting', () => {
  it('renders 24h alarm times as 12h', () => {
    expect(formatAlarmTime('00:05')).toBe('12:05 AM');
    expect(formatAlarmTime('04:02')).toBe('4:02 AM');
    expect(formatAlarmTime('12:54')).toBe('12:54 PM');
    expect(formatAlarmTime('23:59')).toBe('11:59 PM');
    expect(formatAlarmTime('later')).toBe('later');
  });

  it('labels days relative to now', () => {
    expect(missedDoseDayLabel('2026-10-15', NOW)).toBe('Today');
    expect(missedDoseDayLabel('2026-10-14', NOW)).toBe('Yesterday');
    expect(missedDoseDayLabel('2026-10-12', NOW)).toBe('Mon, 12 Oct 2026');
  });

  it('shows the drug amount only when present', () => {
    expect(formatMissedDoseDrug({ drugName: 'Dolo', drugAmount: '1' })).toBe('Dolo × 1');
    expect(formatMissedDoseDrug({ drugName: 'Dolo', drugAmount: '' })).toBe('Dolo');
  });
});

describe('grouping', () => {
  it('groups by the dispenser day and counts today', () => {
    const events = parseMissedDoses(SAMPLE);
    const groups = groupMissedDosesByDay(events, NOW);
    expect(groups.map(g => [g.label, g.doses.length])).toEqual([
      ['Today', 4],
      ['Yesterday', 1],
    ]);
    expect(countMissedDosesOnDay(events, '2026-10-15')).toBe(4);
    expect(countMissedDosesOnDay(events, '2026-10-13')).toBe(0);
  });
});
