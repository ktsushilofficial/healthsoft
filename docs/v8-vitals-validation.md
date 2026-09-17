# V8 vitals correction and validation

The client now preserves measurement dates and missing values, uses separate Android/iOS callback maps, recognizes Android `detailMinterStep`, and spaces dynamic HR samples five seconds apart. Android SDK distances/calories are already scaled; the app no longer guesses distance units from magnitude.

The device screen and upload use the same daily aggregation. Valid daily activity totals take precedence; otherwise unique detail intervals are summed. Latest vitals use measurement time. Blood pressure requires a paired reading. Duplicate identity includes every metric, including SpO2 and stress.

Live readings are separate from history responses and keep per-metric timestamps. Upload fallback requires a same-day value measured within five minutes; this is an application freshness policy. Missing physiological values remain null, while valid zero activity remains zero. An entirely empty day is not uploaded. Older zero-filled backend rows are not rewritten by this change.

History is read one category at a time. After 50 callbacks the reader sends continuation mode 2 unless it has reached the day boundary. A matching history `dataEnd` or a drained day boundary completes that category; a live callback cannot complete a history read. Five seconds without a matching response before the boundary, two minutes total per category, or the 64-page cap fails that category. The total duration limit does not reset on packets or continuation requests; it is an application safety bound that still needs validation against full-day physical-band transfers. A failed, unsupported or unparsable category no longer stops the read: the reader continues to the next category, the day is aggregated from whatever arrived, and the metrics it could not collect are uploaded as null. Categories without a native request method are not requested; a timeout is not silently interpreted as an unsupported sensor.

## Today-only history window

The app now accepts history requests only for the phone's current local calendar day. Each read fixes a window from local midnight through the time that read starts, including both endpoints. SDK records outside that window are not expanded into stored samples, and series crossing either boundary are filtered per sample. Vendor record start/end times are retained separately for pagination, since a 15-value HR record expands into ascending five-second samples even when records arrive newest first. Late old notifications cannot reintroduce older samples. Live measurements use their actual receipt/measurement time and exclude earlier-day and future values.

The supplied 13 September iOS log contains descending 4 August record timestamps. When history reaches a record whose last sample is before today's midnight, the reader drains the already-requested page (50 callbacks, `dataEnd`, or a five-second quiet period) and does not request another page. Draining prevents the next category's command from interrupting a current response. A record starting yesterday but extending into today does not trigger the cutoff. If record order reverses and the reader stops without `dataEnd`, the category is marked partial instead of claiming complete coverage. The SDK has no exposed end-timestamp or cancel-history command, so it may still transmit out-of-window records in a page already requested; the app ignores them. `requestedEnd` and per-category `stoppedAtDayStart` report the window and cutoff. Tests cover Android/iOS filtering, midnight-crossing series, exact upper bounds, late old packets, no older-page requests, short-page draining, out-of-order responses, and upload values.

The Android QA screenshot at 22:37 on 12 September showed continuous HR still reading after two completed categories; QA reported trying since 22:05. The installed build and packet logs are unknown, so this does not establish the underlying Bluetooth/firmware cause. The prior inactivity timeout could be extended by matching packets without a completion marker. Regression tests now reproduce that stream, verify the firm two-minute bound across pages and resumed callbacks, and verify that the Android provider continues all later categories, retains available vitals, and releases the read for retry. The device screen and sync panel show response/sample counts; failed category reasons are visible in the device screen. Hardware reproduction on QA's band remains outstanding.

Device details now use the same serial command channel as history. Connection priming and screen refresh share one refresh operation, wait for each requested field to arrive, retry an unanswered query once after 1.5 seconds, and report fields that still have no response. Native send acceptance alone is not treated as a successful detail read. Disconnects cancel active/queued queries; connecting resets previously reported details. Android `ResolveUtil.getDeviceTime` supplies `strDeviceTime`, which is now parsed only as a device-time response. Firmware continues to use the SDK's `deviceVersion` field. The screen adds a separate details refresh button, readable missing-value states, wrapping/copyable field values, and an advertised-model row. For `JCV8B 6DDC93` with MAC `D6:1B:DF:6D:DC:93`, that row displays `JCV8B`; it is derived from the Bluetooth name, not a verified hardware model number. iOS uses the advertised name because its bundled SDK has no name-read method. Refreshing details does not change monitoring settings or the band clock. On each new connection, the app now sends the phone’s local date and time before reading device details or history. The Hand Band screen also offers “Sync Time with Phone”; both paths serialize the write and clock readback, retry an unanswered read once, and expose failures. A clock response refreshes Device Time; it is not an independent check of clock accuracy. Duplicate connected events do not repeat the write. Physical-band confirmation of firmware replies is still required.

## No backend resume cursor (13 September)

At the user's request the band read no longer depends on the saved vitals summary. The earlier resume design assumed the band accepts an arbitrary timestamp cursor; the vendor header states the opposite - `startDate` is ignored unless it exactly matches the date of a record already stored on the watch, and mode 0 reads from the latest position backwards. A server audit time, rounded to the second, will not match a stored record, so the cursor was silently discarded and the band dumped its flash regardless.

`getV8VitalsSummary` is therefore no longer called before a read, and the session baseline that existed only to merge a shorter read has been removed along with `selectVitalsSyncCheckpoint` and its tests. Every read requests local midnight for all seven categories. The window is enforced on this side instead: records outside midnight-to-read-cutoff are dropped at parse time, and pagination stops rather than requesting pages older than the window. `historyReadStatus.requestedStart` and `requestedEnd` report that window, and a test asserts the summary API is not called during a read. The screens that display saved backend vitals still use that API; only the read path dropped it.

## Heart rate comes from the HRV record (13 September)

At the user's request the sync no longer asks for continuous heart rate. `GetContinuousHRData` / `GetDynamicHRWithMode` returns 15 samples under one record date, so per-sample times are derived at an assumed 5-second spacing, and the band replays its stored flash for it. `GetSingleHRData` / `GetStaticHRWithMode` returns one reading per record with its own real timestamp and no derived times. The parser and reader still handle continuous-HR packets if any arrive; only the request was removed, and a test asserts it is never sent.

The consequence is fewer heart-rate samples per day, so the daily minimum and maximum are thinner: spot readings miss peaks between measurements. How thin depends on the band's automatic monitoring interval, which `GetAutomaticMonitoringWithDataType` would report and which has never been called. With the test fixtures the day's heart rate now comes from two single-HR records plus the heart rate carried inside the HRV record.

One ordering note: when two sources report a heart rate for the same second, `hrLatest` is decided by arrival order because the sort is stable. Such a tie is arbitrary.

Both ends of the band window are logged in development. `History request sent` reports the category, the mode, and the exact start date passed (null on continuation mode 2, which carries no date on either bridge).

`Band readings received` fires for every parsed packet, history and live alike, and reports the category, the source, `dataEnd`, how many records the band offered against how many fell inside the window, the newest and oldest record dates, the full list of record dates, and every parsed vital value with its timestamp. Only metrics that are present appear on a sample, so an SpO2 packet logs `spo2`, an HRV packet logs heart rate, HRV, stress and both blood pressures, and an activity total logs all six activity fields. `recordsOffered` against `recordsInsideWindow` is the direct measure of whether the band honoured the start date; `dates` lists everything it sent, while `samples` lists only what survived parsing and the window.

## No heart-rate category is requested (13 September)

A device capture on 13 September showed each HRV record carrying `heartRate` measured at the same moment as the HRV value, on an hourly schedule at three and a half minutes past the hour. At the user's request neither heart-rate category is requested any more: continuous HR was dropped first, and single HR after it. HRV now supplies the day's heart rate alongside HRV, stress and blood pressure from one transfer.

A sync requests four categories: activity totals, HRV, blood oxygen, temperature.

The same capture confirmed two things that were previously assumed. Records arrive newest first, strictly descending, which is what the early-stop pagination relies on. And the band's automatic measurement interval is hourly, so roughly twenty-four records a day fit inside a single fifty-record page.

The cost is concentration of risk: HRV is now the only source of heart rate, stress, systolic and diastolic blood pressure. A failed or unparsable HRV category sends all four to the backend as null, where previously a heart-rate category could still supply a pulse. A test covers that case explicitly. Heart rate is also sampled hourly rather than continuously, so the day's minimum and maximum are resting-range values and will not capture exertion peaks between measurements.

That capture also showed `stress` and `vascularAging` carrying identical values in all four records. `vascularAging` is not parsed. Whether the SDK decodes one byte into both fields is unresolved, so the uploaded `stress` value should be treated as unverified.

## Temperature removed from the sync and the app (13 September)

A device capture on 13 September showed temperature as by far the most expensive category: 800 stored records offered to extract 73 of today's, fifty response packets, and the only category to reach the packet ceiling and stop at the day boundary. Activity totals took one packet, HRV twelve and blood oxygen sixteen, and both of those finished naturally.

The same capture showed values of 33.4, 34.2 and 34.5 degrees. Those are wrist skin temperatures, which is what the sensor measures; the activity screen labelled that figure "Body Temperature" and the home screen showed it as a vital. A reader would have seen a family member's body temperature reported several degrees below normal.

At the user's decision temperature is no longer requested and no longer displayed. Removed from the sync request list, from the home screen vital cards and vitals list, from the device screen, from the activity screen's summary card, range calculation, row type, backend field mapping and seven-day table column, and from the shared daily vitals table. The parser, the native bridges and the `requestTemperature` method are unchanged, so a temperature packet arriving from some other path is still handled.

The backend contract is unchanged: `tempMin`, `tempMax`, `tempAvg` and `tempLatest` are still sent, always as null. A test asserts both that the category is never requested and that those four fields upload as null.

A sync now requests three categories: activity totals, HRV and blood oxygen.

## Activity totals replace detail activity (13 September)

At the user's request the sync no longer asks for detail activity. `GetDetailActivityData` returns per-interval records across the whole day and was only ever a fallback: `motion()` takes steps, distance and calories from the newest `totalActivity` record and reaches for summed intervals only when neither totals nor realtime activity produced a value. Exercise minutes, active minutes and goal percent never had that fallback at all. Removing the request drops a multi-page transfer whose result was discarded on every successful read.

Five categories are now requested: activity totals, single heart rate, HRV, blood oxygen, temperature. The fallback code remains, so detail-activity packets that arrive from some other path are still summed; only the request was removed, and a test asserts it is never sent.

The consequence is that activity depends on the totals record alone. If that category fails or returns nothing for today, steps, distance and calories are now null rather than being rebuilt from intervals, because realtime activity only reports when the step count changes. That trade was accepted deliberately: the totals record is one cumulative snapshot per day and is the cheapest category the band offers.

## On-demand heart rate for hrLatest: tried and removed (13 September)

`hrLatest` was briefly made a reading taken at sync time rather than the newest stored value. Today's read asked the band to measure (iOS `manualMeasurementWithDataType:heartRateData_V8`, Android `SetDeviceMeasurementWithType(AutoHeartRate, seconds, true)`) for 30 seconds, the vendor header's documented minimum, and the reply was expected as `DeviceMeasurement_HR` (iOS 58, Android 74), which the parser maps to a live `staticHR` sample.

On a connected band the measurement did not produce a usable value. The packet arrived and parsed to a single sample, but nothing in it passed the `heartRate > 0` check the resolver requires, so the promise ran out its window and resolved null. Field values were not captured: these logs reach the JS debugger only, not logcat, so the exact contents of that frame are unconfirmed and no progress-packet shape has been validated against hardware.

At the user's request the step is removed rather than debugged. Heart rate comes from HRV, whose every record already carries a `heartRate` measured at the same moment, so the measurement was buying a number the read already had - at the cost of 30 seconds plus grace on every refresh, after the history categories had already finished, holding the band's single command channel throughout. The trade accepted is freshness: `hrLatest` is now as recent as the band's own HRV logging interval, hourly in the 13 September capture, rather than a reading taken at the moment of the tap.

Removed from `V8BleProvider`: `runHeartRateMeasurement`, `measureHeartRateNow` and its context field, `heartRateMeasurementRef` and its dispatch on the live path, the `HR_MEASUREMENT_*` constants, and the call in `readVitalsHistory`. A test asserts a read never sends the measurement command and takes `hrLatest` from history. The bridged `startHeartRateMeasurement` / `stopHeartRateMeasurement` methods are left in place on both platforms, unused, so a deliberate user-triggered measurement can be built on them later without redoing the native work.

One note survives the removal: the duration unit is seconds on both platforms - the Android SDK writes the value into bytes 4-5 of the 0x28 packet unchanged. The Android contact-ECG path passes `30_000` for the same argument and its comment claims milliseconds. That is unrelated to this change, is not corrected here, and needs physical-band confirmation.

## Sync progress reported zeros (13 September)

Tapping Sync now showed "0 responses received, 0 samples read." on the progress modal. Three separate faults, all in the display rather than the transfer:

`describeHistoryTransfer` reported only the category currently in front. A category is published the instant it is requested, before any packet can have arrived, so the first frame of every category read as zero; and because the counters are per-category, the running total fell back to zero each time the read moved on. It now sums the whole read, so the number only grows, and reports "Waiting for the band to answer…" while nothing has come back yet rather than claiming zero.

The modal's "N of 7 reading groups checked" took its denominator from `historyTypeLabels`, every category the parser can recognise. A sync asks for three, so it could never pass 3 of 7. Counting the categories published so far would instead have grown the denominator as the read advanced, so `V8HistoryReadStatus` now carries `totalCategories`, fixed from the request list before the first category starts; the line is hidden until a read has published one.

Tests cover the read total never falling back between categories, no frame reporting zero responses, singular wording at one, and `totalCategories` surviving a two-category read. The per-second behaviour against a physical band was not observed; these are unit-level assertions on the status the reader publishes.

## Stall bounds (13 September)

Every step of a sync is bounded and failure moves to the next step rather than stopping the run. Each history category has a 5-second inactivity timeout, a 2-minute total limit and a 64-page cap; a category that times out, is unsupported or cannot be parsed is recorded as failed, its metrics stay null, and the remaining categories are still read, aggregated and uploaded. Device detail queries retry once after 1.5 seconds and then report the field as unanswered without blocking the others.

Commands are serialised on the band's single command channel, so a queued task that never settles previously blocked every later command, including the history read and therefore all automatic syncs, until the app was restarted. Each queued task now has its own bound: 15 seconds for a device command and a 20-minute backstop for a history read, which the per-category limits keep unreachable. On expiry that caller fails and the queue advances. A disconnect also releases the queue immediately, so a reconnect is not held behind a command left waiting on the dead connection.

The backend checkpoint lookup is bounded at 6 seconds, shorter than the HTTP client's own 15-second timeout and token-refresh retry. A slow, offline or failing lookup falls back to reading from local midnight instead of delaying the band read. Regression tests cover a native command that never settles, a disconnect during a stuck command, and a summary lookup that never responds.

Ingestion uses incremental duplicate indexes and buffers; visible history/debug updates are batched at 100 ms. Connecting a band resets in-memory vitals. A versioned local cache prevents records parsed with the old timestamp rules from being restored into the corrected pipeline.

## Automated verification

Tests cover SDK-shaped Android/iOS callbacks through provider upload, exact-day selection, null serialization, stale/future live fallback, midnight HR series, reversed history order, duplicate/revised activity intervals, distinct SpO2/stress records, page continuation, timeouts, disconnects, and blocked uploads after partial downloads. The app smoke test now unmounts its renderer so the full suite exits normally.

## Checks requiring hardware or server access

- Verify `/api/v1/vitals/sync` accepts null fields and handles partial metric sets as intended. The client payload types allow null and the request layer passes it through; the server implementation is not in this repository. No production upload was performed during this work.
- Record the exact band model/firmware and compare the same stored records against the vendor app on Android and iOS, including zero-activity days and missing vitals.
- Exercise downloads exceeding 50 callbacks, a mid-download disconnect, and repeated syncs. Confirm totals remain stable and the UI clearly indicates incomplete reads.
- Confirm monitoring schedules, enabled sensors, BP/stress semantics, temperature units, and retention with the supplier. This change does not choose or overwrite unknown device monitoring settings.
- The existing one-day automatic upload policy remains. Historical backfill and ECG calibration/routing require their own confirmed requirements and hardware evidence.


## Follow-up: SDK download to upload safeguards

- The iOS vendor wrapper `arrayContinuousHR: [{date, arrayHR: [...]}]` now expands correctly. Five-second offsets cross midnight without re-dating samples. Malformed series positions remain gaps; subsequent timestamps do not shift earlier.
- Each packet carries received-record, extracted-sample, rejected-record and invalid-date counts. The reader accumulates them across pages. Rejected records are reported per category but no longer block completion: the samples that parsed are kept and uploaded, and a category is marked failed only when nothing at all survived parsing. Rejected records are still surfaced on the device screen.
- Empty SDK lists/dictionaries and absent `dicData` on completion are distinct from unknown wrappers, malformed records and invalid historical dates. A zero-valued SDK sample is syntactically extracted; physiological zero sentinels are still excluded by aggregation. Counts do not certify sensor accuracy or distinguish undocumented sentinels.
- Per-category results distinguish `downloaded`, `empty`, `failed`, and `unavailable` (a missing optional native method). A timeout remains a failure. Neither an available method nor an empty response certifies firmware sensor support. The device screen identifies parsing failures and missing optional methods.
- A finished read — complete or partial — saves its own daily summary and live fallback with the day, connected-device ID, connection generation, and selected senior. Upload requires that current read and matching supplied rows. It uses the saved summary, so late notifications cannot alter the upload. A new read, disconnect/reconnect (including the same band), connection error, cleared data, or changed senior invalidates the old result. Checks repeat after asynchronous assignment lookup immediately before POST.
- Synthetic fixtures now exercise all seven SDK methods on both platforms through the provider and compare every field in the outgoing API body. Tests cover iOS `arrayHR`, actual Android aliases, nullable Android active minutes, zero stress, total/detail precedence, matching request start dates, and identical serialization on repeated uploads. Mocked POST success proves client behavior only; it does not prove server storage or GET readback.

### Acceptance work still requiring external evidence

| Concern | Current client behavior | Evidence required to close it |
| --- | --- | --- |
| Firmware capability and retention | No timeout-based capability inference; missing native methods are explicit | On each supported model/firmware, record which of the seven methods returns measurements, empty history, an explicit unsupported response, or a failure. Confirm supported sensors and retention with the supplier. |
| Band clock and measurement definitions | Phone-local requested day, strict historical timestamps, five-second HR offsets | Compare band time, phone timezone, SDK timestamps and vendor app near midnight on Android/iOS. Confirm whether HR record dates mark the first sample, and confirm BP, stress, HRV and temperature definitions/units with the supplier. No undocumented clock adjustment or sensor configuration is applied. |
| Android historical active minutes | `null` when absent; exercise minutes remain a separate field | The bundled `ResolveUtil.getTotalStepData` comments out the `ActiveMinutes` map insertion. Obtain a supported SDK fix or a confirmed protocol field/layout before adding native decoding; do not substitute another duration. |
| Nullable API fields | Payload preserves null, numeric zero and dated values | Use a dedicated test device/day. POST a fixture containing all fields and GET `/api/v1/vitals/summary?deviceUUID=...&days=1`; compare all metric fields and `recordDate`, not just HTTP status. |
| Repeated updates | Repeated uploads of a saved read serialize identically | POST the same test payload twice; GET must return one device/day record with unchanged values. Check the server's device/day unique key/upsert implementation. |
| Later partial metric sets | Client sends missing values as null | After a full test upload, POST a same-day payload with selected metrics null and another metric changed. GET and check the agreed merge contract: previously recorded valid metrics should be preserved if null means “no new observation.” Repeat with an explicit zero activity/stress value to ensure zero is not treated as missing. A backend change is required if the service overwrites valid data contrary to that contract. |

The backend implementation and test credentials are not present in this repository. No live API write/readback or physical-band validation was performed for this follow-up. The client does not guess server merge semantics or perform a potentially racy GET/merge/POST workaround. Screen cache invalidation, component-wise BP extrema, and ECG duration are separate findings from the original report and are outside this SDK-history-to-sync change.


### Phone-reported continuous-HR failure (12 September)

The screenshot identifies the failed category but does not identify its cause. The phone log capture has so far shown disconnect/reconnect events without a completed reproduction. Build 33 is installed on the connected iPhone.

The error now retains each category's reason: no response, transfer stopped before its completion marker (response count/page), rejected records/invalid dates, native command rejection, or page-limit exhaustion. An earlier action error is hidden while another read is running, avoiding the contradictory “Reading…” and old failure message shown in the screenshot.

Two pagination constraints were corrected during inspection: native continuation mode 2 now omits the start date on both platforms, matching the iOS vendor demo and Android SDK cursor command; initial mode 0 still requests the selected day. The safety limit is now 64 pages rather than 12, since the Android decoder exposes 15 HR samples per record and one full day at five-second intervals can require 1,152 records (24 pages at one record/callback). Neither change establishes the specific cause of the phone's failure without its read diagnostics. Incomplete downloads still block upload.


Follow-up checks: the full Jest suite passes, including the long continuous-HR transfer regression; TypeScript has no errors, targeted ESLint has no errors (existing screen inline-style warnings remain), and Android `:app:compileDebugKotlin` succeeds. The complete iOS Debug build succeeds and the updated app was installed on the connected iPhone. The installed bundle contains the new read binding and detailed failure messages. A complete iPhone/band read is still required to verify the reported failure on hardware.


A separate, already-running app capture contains older (9/11 September) iOS HR notifications with seven decoded records per 168-byte notification and 15 samples per record. This does not capture the 12 September screenshot attempt. Both bundled vendor sample apps trigger continuation at 50 callbacks, so the reader retains callback-based paging; record and sample counts are diagnostics, not substituted page counters. A batched-notification regression protects this distinction. The protocol's inconsistent “packets”/“entries” terminology is not sufficient to override both examples without a current device trace.

The SDK header documents `startDate` as an exact timestamp cursor matching a stored record, not a calendar-date filter. A requested midnight that does not match a stored record may be ignored, so older history can arrive; the client still selects the requested day after parsing. The date argument must not be described as guaranteeing a today-only transfer. Launching the updated app for a fresh device read was blocked because the iPhone was locked; the user must unlock/open it and retry to obtain the exact failure reason.

### Android cancellation message (12 September follow-up)

The later Android screenshot shows a read cancelled during continuous HR; the remaining categories were never requested, not independently failed. Cancellation now preserves its first cause, marks the active category `cancelled` and later categories `notRead`, and emits one concise upload-blocking message. Connection changes, disconnection/connection errors, manager teardown and clearing saved data each supply a distinct cause. Android connection callbacks forward the GATT status; nonzero status codes appear in the cancellation reason. The device screen uses the same reason. A screenshot alone cannot identify which cancellation event occurred in that attempt.

Regression tests cover cancellation during an Android HR read, skipped subsequent requests, no API upload, and repeated cancellation events preserving the first cause. No Android device was connected for a live reproduction or installation of this follow-up.


## Missing fields never stop the sync (12 September)

A metric that cannot be fetched or computed is reported as null; it does not abort the fetch or the upload.

- `V8HistoryReader.readAll` resolves with the final read status instead of throwing when a category fails. Every requested category is attempted, and its outcome (`downloaded`, `empty`, `failed`, `unavailable`) is recorded independently. The read is reported `partial` when any category failed, `complete` otherwise.
- Only an explicit cancellation still aborts: disconnect, Bluetooth error, band or senior change, manager teardown, or cleared saved data. Those readings cannot be attributed to a verified band, so they are not uploaded.
- Unparsable records fail their own records, not the category. A category is marked `failed` only when no sample survived parsing; a mixed packet keeps its valid samples and records the parse note in the category error.
- `aggregateVitals` computes each metric independently. A metric whose computation throws becomes null and does not affect the other metrics; buckets without an entries array are skipped rather than aborting the day.
- A single malformed notification is logged and dropped instead of propagating out of the `V8Data` listener and stalling the categories queued behind it.
- Upload accepts a `complete` or `partial` read. The band/senior/day/connection-generation ownership checks are unchanged. `syncTodayVitalsToBackend` returns `{ days, partial, missingTypes }`; the device screen names the categories that were sent as null. An entirely empty day is still not uploaded.
- Regression tests cover: a failed category that lets later categories finish and upload, a partial download uploading with null metrics, all-rejected versus partially rejected parsing, page-limit and timeout failures reported per category, a metric that throws during aggregation, and a malformed bucket.
