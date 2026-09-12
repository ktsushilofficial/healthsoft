// Synthetic values using the bundled Android decoder and iOS demo field shapes.
// These fixtures establish the client contract, not actual sensor accuracy.
export function sdkHistoryPackets(platform: 'ios' | 'android') {
  const date = '2026.09.11 10:00:00';
  const records = [
    [
      {
        date: '2026.09.11',
        step: '8000',
        distance: '5.80',
        calories: '320',
        exerciseMinutes: '65',
        goal: '80',
        ...(platform === 'ios' ? { activeMinutes: 20 } : {}),
      },
    ],
    [
      {
        date,
        ...(platform === 'ios'
          ? { step: 200, arraySteps: [20, 20] }
          : { detailMinterStep: '200', arraySteps: '20 20' }),
        distance: '0.14',
        calories: '8.2',
      },
    ],
    [
      {
        date: '2026.09.11 10:01:00',
        ...(platform === 'ios'
          ? { arrayHR: [72, 76] }
          : { arrayDynamicHR: '72 76' }),
      },
    ],
    [
      {
        date,
        ...(platform === 'ios' ? { singleHR: 80 } : { heartRate: '80' }),
      },
      {
        date: '2026.09.11 09:00:00',
        ...(platform === 'ios' ? { singleHR: 60 } : { heartRate: '60' }),
      },
    ],
    [
      {
        date,
        heartRate: '74',
        hrv: '55',
        stress: '0',
        ...(platform === 'ios'
          ? { systolicBP: 120, diastolicBP: 80 }
          : { highBP: '120', lowBP: '80' }),
      },
    ],
    [
      {
        date,
        ...(platform === 'ios'
          ? { automaticSpo2Data: 98 }
          : { Blood_oxygen: '98' }),
      },
    ],
    [
      {
        date,
        ...(platform === 'ios'
          ? { temperature: 36.5 }
          : { axillaryTemperature: '36.5' }),
      },
    ],
  ];
  const ids =
    platform === 'ios'
      ? ['25', '26', '28', '29', '41', '45', '48']
      : ['24', '25', '27', '28', '42', '68', '59'];
  const wrappers = [
    'arrayTotalActivityData',
    'arrayDetailActivityData',
    'arrayContinuousHR',
    'arraySingleHR',
    'arrayHrvData',
    'arrayAutomaticSpo2Data',
    'arrayemperatureData',
  ];
  return records.map((entries, index) => ({
    dataType: ids[index],
    dataEnd: true,
    dicData: platform === 'ios' ? { [wrappers[index]]: entries } : entries,
  }));
}
