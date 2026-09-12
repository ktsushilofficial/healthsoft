# V8 vitals: iOS and Android SDK to user screen

Detailed implementation report | HealthsoftApp | 11 September 2026

**Follow-up implementation:** The iOS inner `arrayHR` parser, parsing-failure detection, category outcomes, and upload/read binding have since been corrected. See [current validation notes](v8-vitals-validation.md) for the changes and remaining hardware/backend acceptance work. The report below remains a point-in-time audit of commit `5777bc5`; its descriptions of those client bugs are historical.

Reviewed branch: `codex/fix-v8-vitals`. Reviewed application commit: `5777bc5` (`Fix V8 vitals dates, aggregation, parsing and history sync`). This report describes the current code, including remaining gaps. Report preparation does not change the application implementation.

## 1. What the app currently does

Both platforms download band history through seven requests: activity totals, activity details, continuous heart rate, single heart rate, HRV, automatic blood oxygen, and temperature. HRV records also carry heart rate, blood pressure, and stress. The app normalizes the vendor responses, selects the requested day, calculates daily statistics, and uploads one daily summary for the assigned device.

The Device Management screen reads local BLE data. Home and Activity read summaries back from the backend. These are separate data paths, with different display calculations and refresh behavior. Seeing a value locally does not prove that it was uploaded or that a backend screen has fetched it.

**The current implementation cannot yet be described as fully correct across both platforms.** The vendor iOS continuous-HR example uses an inner `arrayHR` field that the current parser does not recognize. A local replay of that exact structure produces a completed history response containing zero samples. Activity also keeps cached summaries without invalidating them after sync. Sections 6 and 14 describe these and other gaps.

Evidence is from application code, the bundled Android SDK and vendor source, iOS headers and vendor demo, and the supplied V8 protocol. Examples below use invented values to illustrate those structures; they are not patient readings or captured device sessions. No production API round-trip or physical-band comparison was performed for this report. Source references S1-S17 are linked in section 17.

## 2. The complete flow

```text
Band sensors and firmware record measurements
  -> native SDK builds a history command
  -> native BLE bridge queues/writes the command
  -> band notifications return bytes
  -> native SDK DataParsingWithData decodes bytes
  -> React Native V8Data event: dataType, dataEnd, dicData
  -> parseV8Payload normalizes records and timestamps
  -> V8BleProvider stores history/live buckets
  -> aggregateVitals selects the day and builds daily statistics
       -> Device screen and local daily table
       -> exact-day selection + fresh-live gap fill
       -> POST /api/v1/vitals/sync
            -> backend storage/merge behavior: outside this repository
            -> GET /api/v1/vitals/summary?deviceUUID=...&days=N
                 -> Home: today's heart, steps, blood pressure
                 -> Activity: selected-period cards and daily table
```

The app does not calculate ordinary band HR, SpO2, BP, HRV, stress, distance, or calories from raw sensor signals. Those values arrive from the band/SDK. App calculations are normalization, deduplication, daily totals/statistics, and presentation. ECG/PPG session HR has a separate waveform fallback, described in section 13. [S1-S9, S16]

## 3. Exactly which SDK methods are called

The React Native interface is shared. Android passes a start-date string such as `2026-09-11 00:00:00`; iOS receives epoch milliseconds and converts them into `NSDate`. Both begin with mode `0` and continue with mode `2`. Full iOS selectors include `withStartDate:`. [S1-S4]

| Data requested | Shared JS method | Android SDK method | iOS SDK method |
| --- | --- | --- | --- |
| Daily activity totals | `requestTotalActivity` | `BleSDK.GetTotalActivityDataWithMode` | `GetTotalActivityDataWithMode:withStartDate:` |
| Activity intervals | `requestDetailActivity` | `BleSDK.GetDetailActivityDataWithMode` | `GetDetailActivityDataWithMode:withStartDate:` |
| Continuous HR | `requestDynamicHR` | `BleSDK.GetDynamicHRWithMode` | `GetContinuousHRDataWithMode:withStartDate:` |
| Single HR | `requestStaticHR` | `BleSDK.GetStaticHRWithMode` | `GetSingleHRDataWithMode:withStartDate:` |
| HRV, stress, BP and HR | `requestHRV` | `BleSDK.GetHRVDataWithMode` | `GetHRVDataWithMode:withStartDate:` |
| Automatic SpO2 | `requestSpo2` | `BleSDK.Oxygen_data` | `GetAutomaticSpo2DataWithMode:withStartDate:` |
| Temperature | `requestTemperature` | `BleSDK.GetTemperature_historyData` | `GetTemperatureDataWithMode:withStartDate:` |

SDK callback IDs are platform-specific. They are not the same thing as BLE command opcodes. For example, Android callback `27` means dynamic HR, whereas iOS callback `27` means sleep. [S3, S4, S5, S11, S12]

| History category | Android callback ID | iOS callback ID | Android command opcode |
| --- | --- | --- | --- |
| Activity totals | 24 | 25 | `0x51` |
| Activity details | 25 | 26 | `0x52` |
| Continuous HR | 27 | 28 | `0x54` |
| Single HR | 28 | 29 | `0x55` |
| HRV, stress, BP | 42 | 41 | `0x56` |
| Automatic SpO2 | 68 | 45 | `0x66` |
| Temperature | 59 | 48 | `0x62` |

The parser also recognizes additional callbacks, including manual oxygen and live measurements. Recognition does not mean that the seven-request sync actively initiates those measurements. In particular, BP and stress have no separate history request in this flow.

### History completion, pagination and scheduling

`readVitalsHistory(day)` waits for connection priming, then runs the seven categories sequentially. Calls for the same day share an in-flight promise; a conflicting day is rejected until that read finishes. Previously downloaded history is cleared before a new read; live buckets remain. [S1, S2]

Each category starts at mode `0`. After 50 matching, non-final history callbacks, the reader sends mode `2`. A matching history `dataEnd=true` completes the category. Live events and callbacks for other categories cannot complete it. Native method promise resolution only confirms the command operation; it does not mean all history arrived.

The reader allows five seconds without a matching response and at most 12 pages per category. It records failed categories and attempts the others. If any requested category fails, the run is partial and the normal sync flow refuses to upload. Received values can still be inspected locally. Disconnect cancels the pending read. An absent optional native SpO2/temperature method is skipped; a timeout from a present method is treated as failure, not proof that a sensor is unsupported.

Automatic sync is a shared JS workflow on both platforms: for the senior account and an assigned connected band, it checks every 30 seconds while the app is active, becomes due 15 minutes after the last successful sync, and retries a failure after 60 seconds. Returning to the foreground triggers a check. This code is not a guarantee of continuous iOS/Android background syncing.

Current entry points request and upload today only. There is no automatic missed-day backfill. Device-screen **Fetch Today** builds a local summary; **Sync Today** builds and posts it. **Refresh Vitals** calls `requestLiveSnapshot()`, which currently reads today's history. Home's **Sync now** also builds and posts today's summary. Reading history does not itself configure the band's automatic measurement schedules.

## 4. Common received-data and processing rules

The native bridge emits a `V8Data` event with the following logical envelope. `dicData` differs by platform: Android commonly supplies a list of records, while iOS uses a dictionary containing a named record array.

```json
{
  "dataType": "27",
  "dataEnd": true,
  "dicData": [
    {"date": "2026.09.11 10:00:00", "arrayDynamicHR": "72 74 73"}
  ]
}
```

`dataEnd=true` means the SDK reports the category complete; it does not prove that the application successfully extracted every metric. This distinction is the cause of the iOS HR gap. [S3-S5]

The parser accepts finite numbers and numeric strings, understands common SDK aliases, and normalizes case/punctuation in keys. It produces `V8VitalSample` records with a measurement `timestamp`, app `receivedAt`, `source` (`history` or `live`), and nullable metric fields. Missing metrics are `null`. It does not retain every vendor field or raw BLE packet in the daily summary. [S5, S6]

### Dates, freshness and validity

- Valid SDK dates are parsed strictly. Missing or invalid historical dates are excluded from daily aggregation; receipt time cannot relabel yesterday's historical reading as today.
- Date-only and timezone-free SDK timestamps use the phone's local calendar/timezone. Epoch values and ISO timestamps with offsets represent instants that are interpreted in the local timezone. `todayLocalDayKey()` uses the phone's date; the selected day is not independently calculated from the returned band clock or a stored senior timezone.
- A live record with no measurement timestamp may use receipt time. A nonempty but invalid timestamp is not repaired by receipt time.
- Ordinary physiological metrics must be finite and greater than zero. Activity metrics and stress allow zero. This is basic numeric validation, not an assessment of clinical accuracy or a vendor quality score.
- The missing-field upload fallback accepts only a value on the same day, no older than five minutes and not in the future. Freshness is checked separately for each metric, so a recent temperature event cannot refresh old HR.

The five-minute rule applies to gap filling during upload. Historical measurements from earlier today remain valid inputs to today's daily statistics. It is not a global rule that removes readings older than five minutes from all screens. [S6, S7]

### Deduplication and daily statistics

The ingestion identity includes measurement timestamp and all metric values. Statistical aggregation also deduplicates a metric by timestamp and value across buckets; BP identity includes the pair. Records are ordered by measurement time, not download order.

For HR, SpO2, HRV, temperature and stress, the app calculates minimum, maximum, arithmetic mean and latest valid value. Mean is rounded to a whole number except temperature, which uses one decimal. This is an equally weighted sample mean. It is not time-weighted; a period with dense continuous-HR readings contributes more than a period with sparse readings. Different values at the same timestamp remain separate observations; there is no sensor-source precedence rule for those conflicts. [S6]

## 5. Steps, distance, calories and activity metadata

### What we receive

Totals and detail history are both requested, but they describe overlapping activity and must not be added together. Android's SDK has already scaled distance and calories. An inspected SDK decoding example maps raw distance `123` to `1.23` and raw calories `1234` to `12.34`; the app does not divide them again. [S3, S11]

Android total record inside `dicData` (callback `24`):

```json
{
  "date": "2026.09.11",
  "step": "8000",
  "exerciseMinutes": "65",
  "distance": "5.80",
  "calories": "320.00",
  "goal": "80"
}
```

iOS callback `25` wraps equivalent records in `dicData.arrayTotalActivityData`; its demo also reads `activeMinutes`. Android's supplied total-activity decoder has the `activeMinutes` map insertion commented out, so that value may remain absent on Android. The report does not assume identical activity metadata availability on both platforms. [S11, S13]

Android detail record (callback `25`):

```json
{
  "date": "2026.09.11 10:00:00",
  "detailMinterStep": "200",
  "distance": "0.14",
  "calories": "8.20",
  "arraySteps": "20 20 20 20 20 20 20 20 20 20"
}
```

iOS callback `26` wraps records in `dicData.arrayDetailActivityData` and uses `step` for the interval total plus numeric `arraySteps`. The parser maps Android `detailMinterStep` and iOS `step` into `steps`. It uses the interval total; it does not additionally sum `arraySteps` or expose a minute-by-minute step chart from that array. [S5, S11, S13]

### What the app calculates

For each activity metric separately, the priority is: latest valid `totalActivity` value; otherwise latest valid `realtimeActivity` value; otherwise, for steps/distance/calories only, sum unique `detailActivity` intervals. Revised detail intervals with the same measurement time use the latest received revision. Detail sums are rounded to two decimals.

Example: two daily total snapshots contain 7,200 and 8,000 steps. Detail intervals total 7,950. The result is 8,000, not 15,200 or 15,950. If no total or realtime value exists and unique details contain 100, 150 and 200 steps, the result is 450. Repeated delivery of the 150 interval does not add another 150. A valid total of zero takes priority even if details disagree; the app has no conflict-reconciliation policy for that case.

Distance and calories follow that same priority independently. The app does not derive distance from step count or calories from HR. `exerciseMinutes`, `activeMinutes` and `goalPercent` come from totals/realtime only; the app does not reconstruct them from details or calculate a goal percentage from a configured target. [S6]

### What is synced and shown

| Metric | POST field | Device / local table | Home card | Activity |
| --- | --- | --- | --- | --- |
| Steps | `steps` | Daily count | Today's count, compact formatting | Day count; multi-day daily average |
| Distance | `distanceKm` | km; table uses 2 decimals | No card | Not displayed |
| Calories | `caloriesKcal` | kcal; table rounds to whole number | No card | Not displayed |
| Exercise duration | `exerciseMinutes` | Not in daily table/cards | No card | Not displayed |
| Active duration | `activeMinutes` | Not in daily table/cards | No card | Not displayed |
| Goal progress | `goalPercent` | Not in daily table/cards | No card | Not displayed |

Activity's seven-day steps figure is the sum of known steps divided by 7; the 30-day figure divides by 30. Missing days therefore contribute zero to that average once any day has data. With one recorded 7,000-step day and six missing days, it displays 1,000 average steps/day. That is different from averaging only days with readings. [S8-S10]

## 6. Heart rate

### What we call and receive

HR comes from dynamic history, static history and the HR field in HRV records; recognized live measurements can also contribute. The ordinary daily HR number is supplied by the device. [S1, S5]

Android dynamic HR: `GetDynamicHRWithMode`, callback `27`, list records containing `date` and `arrayDynamicHR`. The supplied protocol describes 15 HR values at five-second spacing. A shortened illustrative record is:

```json
{"date": "2026.09.11 10:00:00", "arrayDynamicHR": "72 74 73"}
```

For a recognized series, the app creates one sample per value:

```text
10:00:00 -> 72 BPM
10:00:05 -> 74 BPM
10:00:10 -> 73 BPM
...
15 values -> offsets 0, 5, 10, ... 70 seconds
```

Five seconds is the spacing of samples within a stored history record. It is not an app network polling interval, not the 15-minute upload interval, and not proof that the band records HR continuously all day. The current code treats the record timestamp as the first sample's time. Confirm that convention and the recording schedule against the target firmware. Older SDK comments mentioning a different count/interval conflict with the supplied protocol and should not be used as the implementation specification. [S5, S11, S15]

Android static HR: `GetStaticHRWithMode`, callback `28`, record `{"date":"2026.09.11 10:05:00","onceHeartValue":"76"}`. iOS single HR: `GetSingleHRDataWithMode:withStartDate:`, callback `29`, records in `arraySingleHR` with fields `date` and `singleHR`. These aliases are recognized. [S5, S11, S13]

### Open iOS dynamic-HR parser bug

The actual iOS vendor demo for `GetContinuousHRDataWithMode:withStartDate:` reads this structure:

```json
{
  "dataType": "28",
  "dataEnd": true,
  "dicData": {
    "arrayContinuousHR": [
      {"date": "2026.09.11 10:00:00", "arrayHR": [72, 74, 73]}
    ]
  }
}
```

`arrayContinuousHR` is the outer collection; `arrayHR` is the inner numeric series. The current `mapRecordEntries()` checks `arrayDynamicHR` and `arrayContinuousHR` as series fields, but not `arrayHR`. Replaying the above payload through the current `parseV8Payload(payload, 'ios')` produced:

```json
{"dataType":"dynamicHR","source":"history","entries":[],"completed":true}
```

The read can therefore appear complete while continuous-HR readings are discarded. Static HR and HRV-associated HR can still populate a daily summary, masking the loss. The previously described iOS example with a numeric inner `arrayContinuousHR` was too simplified and does not match this vendor demo. Required correction: support inner `arrayHR` and add a fixture preserving the real wrapper, including pagination and midnight samples. This report records the bug; it does not implement that correction. [S5, S13]

### Calculation, sync and display

After normalization and exact-day filtering, valid deduplicated HR readings contribute to `hrMin`, `hrMax`, `hrAvg` and `hrLatest`. For samples 72, 74, 73, 76 in time order: min 72, max 76, rounded average 74, latest 76. A reading crossing midnight belongs to its resulting day, not automatically to the base record's day.

Device Management shows the latest HR recorded today. Its daily table shows average, minimum and maximum. Home shows daily maximum as H and minimum as L. Activity's single-day view shows average/high/low; its multi-day high/low are the highest and lowest **daily averages**, not the raw period extrema. Backend screens do not currently use `hrLatest`. [S6, S8-S10]

## 7. Blood oxygen / SpO2

Android calls `Oxygen_data`, whose automatic-history callback is `68`. Each decoded record contains `date` and `Blood_oxygen`, for example `{"date":"2026.09.11 10:00:00","Blood_oxygen":"97"}`. iOS calls `GetAutomaticSpo2DataWithMode:withStartDate:`, callback `45`, with records in `arrayAutomaticSpo2Data` containing `date` and `automaticSpo2Data`. [S3-S5, S11-S13]

The parser maps these fields to `spo2`, preserving the percent number. It does not infer oxygen saturation from HR or PPG in the daily flow. Zero is treated as absent/invalid; there is no explicit upper-bound quality filter here. Samples 96, 98, 97 produce min 96, max 98, average 97, latest 97.

POST fields are `spo2Min`, `spo2Max`, `spo2Avg`, `spo2Latest`. Device Management shows latest percent and the local table shows average. Home has no oxygen card. Activity shows average/high/low for a single day; multi-day high/low are extrema of daily averages. Automatic history retrieval does not start a new spot oxygen measurement. Manual oxygen callbacks are additionally understood, but are not a separate request in the standard history sequence. [S6, S8-S10]

## 8. HRV, blood pressure and stress

### Shared SDK response

Android `GetHRVDataWithMode` returns callback `42`; iOS `GetHRVDataWithMode:withStartDate:` returns callback `41`. The single response family carries several metrics. Android record example:

```json
{
  "date": "2026.09.11 10:00:00",
  "hrv": "45", "heartRate": "72", "stress": "25",
  "highBP": "120", "lowBP": "80", "vascularAging": "30"
}
```

iOS records are wrapped in `arrayHrvData` and use `systolicBP`/`diastolicBP` for the corresponding BP fields. The parser recognizes both platforms' names. Android's decoded `vascularAging` is not mapped into the app's daily vital model or sync contract. [S5, S11, S13]

### HRV

`hrv` becomes the app HRV value. The app does not calculate RMSSD, SDNN or another HRV index from RR/PPI intervals in this flow. It takes the vendor value and calculates daily min/max/mean/latest. The device screen labels HRV in milliseconds, but the vendor's exact HRV algorithm and interpretation are not established by the current integration.

POST fields are `hrvMin`, `hrvMax`, `hrvAvg`, `hrvLatest`. Device Management shows latest; its daily table shows average. Home and Activity do not currently render HRV, even though it is uploaded. [S5, S6, S8-S10]

### Blood pressure

Both systolic and diastolic must be positive in the same sample for it to contribute to BP statistics. The app does not calculate BP from HR or calibrate a waveform to pressure. It stores the vendor-provided values under paired systolic/diastolic fields.

The app calculates each component's min/max/mean separately and retains the latest pair by measurement time. For readings 120/90 then 130/80, its daily maxima are 130 and 90. A UI displaying `130/90` as H combines maxima from two different measurements; no such pair was necessarily recorded. Daily average is a statistical pair, not a spot reading either.

POST fields are `systolicBpMin/Max/Avg/Latest` and `diastolicBpMin/Max/Avg/Latest` (eight explicit JSON keys). Device Management shows the latest coherent pair; the local table shows the averaged pair. Home and Activity single-day high/low combine componentwise extrema. Activity multi-day high/low instead select among daily-average pairs, ranked by systolic then diastolic. A single consistent product definition is still needed for what a displayed BP high/low should mean. [S6, S8-S10]

### Stress

`stress` becomes the app stress value; zero is allowed. The app does not derive stress from HRV. It computes daily min/max/rounded mean/latest on the vendor number. The scale and vendor algorithm are not independently established by these mappings.

POST fields are `stressMin`, `stressMax`, `stressAvg`, `stressLatest`. Device Management shows latest and the local table shows average. Home and Activity do not currently display stress. [S5, S6, S8-S10]

## 9. Temperature

Android calls `GetTemperature_historyData`, callback `59`; records contain `date` and `temperature`. Its decoder converts the two-byte raw value using a factor of 0.1 before emitting the temperature. iOS calls `GetTemperatureDataWithMode:withStartDate:`, callback `48`. The vendor demo uses the misspelled outer key `arrayemperatureData` and inner field `temperature`. The application recognizes that wrapper. Example:

```json
{
  "arrayemperatureData": [
    {"date": "2026.09.11 10:00:00", "temperature": 36.5}
  ]
}
```

The app maps the SDK value directly to `temperatureC`; it does not divide by ten again or perform Fahrenheit conversion. It filters nonpositive values and computes daily minimum, maximum, one-decimal average and latest. Samples 36.4, 36.7, 36.5 produce average 36.5. Confirm the target hardware's temperature sensor semantics; a field labeled temperature does not by itself establish a core-body-temperature measurement. [S3-S6, S11-S13]

POST fields are `tempMin`, `tempMax`, `tempAvg`, `tempLatest`. Device Management shows latest degrees C; the local table shows average to one decimal. Home has no temperature card. Activity shows a single-day average/high/low, and multi-day extrema of daily averages. No axillary-history request is added to the standard seven-request sequence just because the parser recognizes an axillary callback. [S8-S10]

## 10. What exactly is uploaded

`syncTodayVitalsToBackend(day, summaries)` requires the senior role, checks that the connected MAC belongs to that senior, and resolves the matching assigned device's `deviceId` as `deviceUUID`. It maps application summary names to the web API names, chooses only an exact `recordDate` match, and fills missing values only from eligible same-day fresh live data. It never chooses another day's row and renames it today. [S1, S7]

Missing metrics stay `null`; valid zero activity remains zero. When there are no usable values at all, the app refuses to upload an empty row. A successfully completed category can have no measurements, so a complete download can still upload a partially populated metric set. This differs from a failed/incomplete history download, which the normal build-and-sync path blocks.

If one fresh live value fills a wholly missing metric, it can become all four min/max/avg/latest fields. That row then represents a one-observation statistic; the payload does not tell the backend that it used live fallback or provide a sample count.

The current endpoint is `POST /api/v1/vitals/sync`, implemented by `syncV8VitalsByDevice`. The older senior-specific `/api/v1/seniors/{id}/v8/vitals/daily-sync` helper still exists, but is not the endpoint used by this provider flow. [S1, S9]

Complete illustrative request, using synthetic values:

```json
{
  "deviceUUID": "example-assigned-device-uuid",
  "syncDays": 1,
  "syncFrom": "2026-09-11",
  "syncTo": "2026-09-11",
  "vitalSummaries": [{
    "recordDate": "2026-09-11",
    "steps": 8000,
    "distanceKm": 5.8,
    "caloriesKcal": 320,
    "exerciseMinutes": 65,
    "activeMinutes": null,
    "goalPercent": 80,
    "hrMin": 72, "hrMax": 76, "hrAvg": 74, "hrLatest": 76,
    "spo2Min": 96, "spo2Max": 98, "spo2Avg": 97, "spo2Latest": 97,
    "hrvMin": 40, "hrvMax": 50, "hrvAvg": 45, "hrvLatest": 45,
    "systolicBpMin": 120, "systolicBpMax": 130,
    "systolicBpAvg": 125, "systolicBpLatest": 130,
    "diastolicBpMin": 80, "diastolicBpMax": 90,
    "diastolicBpAvg": 85, "diastolicBpLatest": 80,
    "tempMin": 36.4, "tempMax": 36.7,
    "tempAvg": 36.5, "tempLatest": 36.5,
    "stressMin": 20, "stressMax": 30,
    "stressAvg": 25, "stressLatest": 25
  }]
}
```

Only daily aggregates are posted. There are no individual HR samples, measurement timestamps, source labels, sample counts, raw step arrays, ECG arrays, quality indicators, or per-category completion flags in this contract. Consequently this payload cannot support an accurate intraday history chart or a per-vital measurement-age label on another phone.

After a successful request, the app records the last-sync timestamp locally and schedules the next automatic attempt. The server implementation is not in this repository: acceptance of nulls, replacement versus merge, duplicate same-day upserts, timezone handling and retention must be tested against the real API. A successful client request is not proof of the server's storage semantics.

## 11. How the backend data is fetched and displayed

Both screens call `getV8VitalsSummary(deviceUUID, days)`, which performs:

```text
GET /api/v1/vitals/summary?deviceUUID=<assigned device ID>&days=<N>
```

This read requires network/API access, not a local BLE connection. Home and Activity accept an array response or arrays under `vitalSummaries`, `summaries`, `data`, or `data.vitalSummaries`. Their normalizers accept finite JSON numbers; a numeric string such as `"72"` is not converted to 72 here, unlike the SDK parser. These are client-supported response shapes, not a claim that all are returned by the server. [S8, S9]

### Home

Home requests one day, selects today's row, and renders heart H/L, steps and BP H/L. It loads when its dependencies change, refreshes after the provider's successful-sync timestamp changes, and supports pull-to-refresh. Stale in-flight results are guarded by request identity. A missing current-day row yields missing values; an earlier date is not relabeled today.

Its locally generated post-sync daily table and backend-fetched cards are separate state. A preview can therefore show new local values while the dashboard still shows a previous server response. Home treats nonpositive physiological fields as missing. [S8]

### Activity

| Selection | API `days` | Local display window | What cards calculate |
| --- | --- | --- | --- |
| Today | 1 | Current local date | Steps; daily vital average and min/max |
| Yesterday | 2 | Previous local date only | Same calculations for yesterday |
| This Week | 7 | Today and preceding 6 days | Steps/7; extrema of daily vital averages |
| Last 1 Month | 30 | Today and preceding 29 days | Steps/30; extrema of daily vital averages |

The weekly selection is rolling seven days, not a calendar week; the month selection is rolling 30 days. Multi-day BP uses daily-average pairs as described in section 8. The daily Activity table displays date, steps, HR average, SpO2 average, temperature average and BP average. It does not display HRV, stress, calories, distance, or latest fields.

Activity caches rows by senior ID plus requested day count, and caches the device UUID separately. A matching cache entry returns immediately without another GET. There is no TTL or successful-sync invalidation in this code; cached results can remain stale while that screen instance survives. The row cache clears when the active senior changes. Activity's numeric normalizer also preserves zero-valued vitals, so old backend zero placeholders can appear differently from Home. [S8]

### Assigned-device selection mismatch

Sync resolves a band MAC through `getAssignedHandBandMacAddress`, which supports assignment fields beyond `deviceIdentifier`. Home and Activity instead select the first assigned device whose `deviceIdentifier` looks like a MAC and which has `deviceId`. An assignment with its MAC only in `bluetoothMacAddress` can sync successfully but fail screen selection. With multiple bands, the first selected device may also differ from the band just synced. The selection logic needs to be shared across upload and readback. [S1, S8, S14]

## 12. Local state, live mode and freshness labels

`V8BleProvider` keeps history buckets in memory, uses incremental duplicate indexes, and batches visible updates at about 100 ms. A versioned Keychain history cache (`healthsoft.v8.history.v2`) saves up to the last 120 entries per bucket. That cache is for local state restoration, not a complete long-term measurement ledger. A fresh history read rebuilds historical buckets; a new band connection resets in-memory vitals. [S1]

The Device Management section labeled **Live Vitals** uses today's aggregate history plus live buckets: latest HR/SpO2/BP/temperature/HRV/stress, alongside daily activity values. The label does not mean every number was just measured. Its general Updated label is based on `latestLiveData.receivedAt`, not each displayed metric's measurement time. A single recent event can therefore coexist with older displayed values. [S10]

For explicit realtime activity, JS `setRealtimeStepEnabled(enabled, includeTemperature)` calls Android `BleSDK.RealTimeStep(enabled, includeTemperature)`. iOS calls `RealTimeDataWithType:(enabled ? 1 : 0)` and does not forward the `includeTemperature` argument. Realtime callback IDs are Android `23` and iOS `24`. These live records are handled separately from history completion. Enabling this stream is not the same as enabling automatic histories for all physiological sensors. [S3-S5]

## 13. ECG/PPG, sleep and other SDK capabilities

ECG/PPG are visible measurement-session features and deserve explicit separation from daily vitals. JS `startEcgMeasurement(mode)` starts a contact ECG or optical PPG session. [S3, S4, S16]

- Android contact ECG uses `SetDeviceMeasurementWithType(AutoTestMode.AutoHRV, ecgMeasurementDurationMs, true)` plus `setECGRealtimeDuringHRVEnabled(true)`. iOS uses `manualMeasurementWithDataType:hrvData_v8 measurementTime:30 open:YES`, then enables realtime ECG after the start acknowledgement.
- Optical PPG uses Android `ppgWithMode(1, 0)` and iOS `ppgWithMode:1 ppgStatus:0`; stop uses mode 3 and exit mode 5. This SDK command name does not mean that a glucose value is available in our daily vitals contract.
- Received session data includes waveform arrays and available result/status fields. Android's legacy raw ECG field can be named `arrayPpgRawData`; iOS has `arrayEcgRawData`. The ECG parser tracks waveform source separately.
- Device-reported session HR is preferred. The app has a waveform fallback that detrends/smooths data, detects energy peaks, filters implausible/irregular beat intervals, and estimates BPM as `round(60 / median interval in seconds)`, subject to confidence and quality gates. It requires sufficient signal duration; it is distinct from simply averaging device HR history.
- Session state and a capped sample set are stored locally; up to 20,000 samples are persisted. Existing sharing produces waveform/report artifacts through the system share flow. ECG waveforms are not included in `/vitals/sync`, and no ECG readback is provided by `/vitals/summary` in this client.

The Android contact-ECG duration path is a separate unresolved audit item: the bridge passes 30,000, whereas the supplied protocol describes a seconds field and the inspected SDK writes the number directly. Verify and correct this against the command specification and hardware before treating platform session duration as equivalent. Waveform calibration, source routing and device-result behavior also require their own hardware acceptance; the daily-vitals correction did not certify ECG accuracy.

Sleep is exposed by native `requestSleep` (`GetDetailSleepDataWithMode` on both platforms) but is not included in the seven-request daily vitals read or summary payload. RR/PPI, vascular aging and other vendor capabilities likewise have no daily fields described here. Having a method in the SDK is not evidence that the app fetches, syncs and displays that metric.

## 14. Remaining fixes and confirmation work

The first five items are directly evidenced client behaviors. The remaining items concern contract/product choices or device validation. None is silently counted as fixed by this report.

| Priority | Finding | Required change / acceptance evidence |
| --- | --- | --- |
| High | iOS dynamic HR inner `arrayHR` is dropped; completion still succeeds | Parse the real wrapper; test sample count, five-second offsets, pagination and midnight |
| High | Activity reuses cached rows after successful sync | Invalidate/refetch on sync, date rollover and assignment change; verify new server values appear |
| High | Upload and readback resolve different assigned-device fields | Share the same normalized assignment/device selection; test MAC-only alternate fields and multiple bands |
| Medium | BP H/L can combine components from different readings | Define paired-reading selection or explicitly label separate component extrema; align all screens |
| Medium | Device Live/Updated labels do not describe each value's age | Label latest recorded values and show per-metric measurement time/freshness |
| Medium | Home rejects zero physiological values while Activity displays them; both reject numeric strings | Share a documented API normalizer; test null, zero, numbers and any server-supported string form |
| Medium | Weekly/monthly steps treat missing days as zero; vital ranges are ranges of daily means | Confirm intended definitions and make labels match; distinguish missing days from recorded zero |
| High validation | Server null/merge/upsert behavior is unknown | Exercise POST then GET for all fields, repeated syncs, nulls and partial metric sets in a test environment |
| High validation | ECG duration units differ from protocol evidence | Correct/confirm Android command value and test contact ECG duration and result routing |
| Device validation | Sensor schedules, BP/stress/HRV algorithms, temperature semantics, history retention and time conventions | Compare exact raw/decoded records on real iOS/Android devices with the vendor app and firmware details |
| Scope decision | Today-only upload misses unsynced earlier days | Decide whether backfill is required; do not imply current code performs it |

Also confirm Android active-minute availability with the supplier. The SDK mapping currently omits that field. Do not invent it from exercise duration or another metric to make the API row look complete.

## 15. Validation performed and limits

For this report, application/native code and vendor payload definitions were traced, and callback IDs and units were checked against the bundled SDK evidence. Fourteen synthetic payload examples covering the seven history categories on both platforms were replayed through the current parser. Thirteen returned samples. The exact iOS `arrayContinuousHR`/inner `arrayHR` example returned zero entries with `completed=true`. This checks the illustrative parser structures, not full device or API behavior.

The preceding correction work had passing automated coverage for date selection, activity totals and detail deduplication, nullable payloads, fresh/stale live fallback, sample ordering, pagination, disconnects and blocked partial uploads. Those checks do not replace a fixture using the actual iOS inner `arrayHR` field. Earlier simplified fixtures were insufficient to establish full iOS continuous-HR support.

Recommended acceptance sequence: record the same band's model/firmware and clock; download all seven categories on Android and iOS; retain the decoded payloads; compare app sample counts and aggregates; POST a known synthetic/test summary and GET it back; verify each screen after repeated syncs, midnight and assignment changes. Include a true zero-step day, missing sensors, a transfer over 50 callbacks, and a mid-download disconnect. Use these results to close the corresponding items in section 14.

## 16. SDK versions and evidence boundaries

The compiled Android library is `android/app/libs/v8sdk1.0.jar`; it matches the supplied vendor JAR. The iOS library is `ios/V8SDK/libBleSDK.a`; it matches the supplied vendor archive. Hashes recorded during the SDK review:

```text
Android SHA-256
194361e8032015e087a7f2e4eb2c53b1d40e3ae90f23955c9f478a1bcf5a37c6

iOS SHA-256
4418ee39065a199587c886ff140116af38a3b332aa7eec284347fc69857a7a99
```

Android vendor source and bytecode provide decoding evidence. iOS headers establish method names/enums, and the supplied demo establishes expected dictionary structures. The closed iOS library and firmware still require actual device captures for complete runtime confirmation. These findings describe the bundled integration, not every V8 SDK release or every band marketed under the same name.

## 17. Source map

Links target files in the reviewed workspace. Method names and sections above provide search anchors if later edits shift line numbers.

- **S1 - Provider, read/build/sync, live state and scheduling:** [V8BleProvider.tsx](/Users/sushil/Documents/HealthsoftApp/src/v8/V8BleProvider.tsx:1600).
- **S2 - History pagination/completion:** [historyReader.ts](/Users/sushil/Documents/HealthsoftApp/src/v8/historyReader.ts:30).
- **S3 - Android native calls and notifications:** [V8BleModule.kt](/Users/sushil/Documents/HealthsoftApp/android/app/src/main/java/in/healthsoftcare/seniorcare/v8/V8BleModule.kt:401).
- **S4 - iOS native calls and notifications:** [V8BleModule.m](/Users/sushil/Documents/HealthsoftApp/ios/V8Bridge/V8BleModule.m:462).
- **S5 - Payload parsing and aliases:** [parser.ts](/Users/sushil/Documents/HealthsoftApp/src/v8/parser.ts:1).
- **S6 - Aggregation and model:** [vitals.ts](/Users/sushil/Documents/HealthsoftApp/src/v8/vitals.ts:91), [models.ts](/Users/sushil/Documents/HealthsoftApp/src/v8/models.ts:1).
- **S7 - Exact-day and freshness rules:** [todayVitalsRow.ts](/Users/sushil/Documents/HealthsoftApp/src/v8/todayVitalsRow.ts:1), [sampleDay.ts](/Users/sushil/Documents/HealthsoftApp/src/utils/sampleDay.ts:1), [vitalsDay.ts](/Users/sushil/Documents/HealthsoftApp/src/utils/vitalsDay.ts:1).
- **S8 - Backend-fed screens:** [HomeScreen.tsx](/Users/sushil/Documents/HealthsoftApp/src/screens/HomeScreen.tsx:738), [ActivityScreen.tsx](/Users/sushil/Documents/HealthsoftApp/src/screens/ActivityScreen.tsx:159).
- **S9 - POST and GET API methods:** [AuthContext.tsx](/Users/sushil/Documents/HealthsoftApp/src/context/AuthContext.tsx:1468).
- **S10 - Local display:** [V8DeviceManageScreen.tsx](/Users/sushil/Documents/HealthsoftApp/src/screens/V8DeviceManageScreen.tsx:201), [DailyVitalsTable.tsx](/Users/sushil/Documents/HealthsoftApp/src/components/DailyVitalsTable.tsx:8).
- **S11 - Android vendor decoder and field names:** [ResolveUtil.java](</Users/sushil/Documents/HealthsoftApp/V8 SDK/v8/v8test/blesdk_2301/src/main/java/com/jstyle/blesdkv8/other/ResolveUtil.java>), [DeviceKey.java](</Users/sushil/Documents/HealthsoftApp/V8 SDK/v8/v8test/blesdk_2301/src/main/java/com/jstyle/blesdkv8/constant/DeviceKey.java>), [BleSDK.java](</Users/sushil/Documents/HealthsoftApp/V8 SDK/v8/v8test/blesdk_2301/src/main/java/com/jstyle/blesdkv8/Util/BleSDK.java>).
- **S12 - iOS SDK declarations:** [BleSDK_Header_V8.h](/Users/sushil/Documents/HealthsoftApp/ios/V8SDK/BleSDK_Header_V8.h).
- **S13 - iOS vendor examples:** [heartRateHistoryData.m](</Users/sushil/Documents/HealthsoftApp/V8 SDK/V8 IOS/Ble SDK Demo/Ble SDK Demo/heartRateHistoryData.m:103>), [activityHistoryData.m](</Users/sushil/Documents/HealthsoftApp/V8 SDK/V8 IOS/Ble SDK Demo/Ble SDK Demo/activityHistoryData.m>), [HRV_HistoryData.m](</Users/sushil/Documents/HealthsoftApp/V8 SDK/V8 IOS/Ble SDK Demo/Ble SDK Demo/HRV_HistoryData.m>), [spo2HistoryData.m](</Users/sushil/Documents/HealthsoftApp/V8 SDK/V8 IOS/Ble SDK Demo/Ble SDK Demo/spo2HistoryData.m>), [temperatureHistoryData.m](</Users/sushil/Documents/HealthsoftApp/V8 SDK/V8 IOS/Ble SDK Demo/Ble SDK Demo/temperatureHistoryData.m>).
- **S14 - Assignment MAC handling:** [deviceAssignments.ts](/Users/sushil/Documents/HealthsoftApp/src/utils/deviceAssignments.ts:136).
- **S15 - Supplied protocol:** [V8-API-EN.pdf](</Users/sushil/Documents/HealthsoftApp/V8 SDK/V8-API-EN.pdf>), especially history definitions on pages 5-7.
- **S16 - ECG parsing and signal processing:** [ecg.ts](/Users/sushil/Documents/HealthsoftApp/src/v8/ecg.ts:203), [nativeV8.ts](/Users/sushil/Documents/HealthsoftApp/src/v8/nativeV8.ts).
- **S17 - Earlier correction validation notes:** [v8-vitals-validation.md](/Users/sushil/Documents/HealthsoftApp/docs/v8-vitals-validation.md).
