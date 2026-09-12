# V8 vitals correction and validation

The client now preserves measurement dates and missing values, uses separate Android/iOS callback maps, recognizes Android `detailMinterStep`, and spaces dynamic HR samples five seconds apart. Android SDK distances/calories are already scaled; the app no longer guesses distance units from magnitude.

The device screen and upload use the same daily aggregation. Valid daily activity totals take precedence; otherwise unique detail intervals are summed. Latest vitals use measurement time. Blood pressure requires a paired reading. Duplicate identity includes every metric, including SpO2 and stress.

Live readings are separate from history responses and keep per-metric timestamps. Upload fallback requires a same-day value measured within five minutes; this is an application freshness policy. Missing physiological values remain null, while valid zero activity remains zero. An entirely empty day is not uploaded. Older zero-filled backend rows are not rewritten by this change.

History is read one category at a time. After 50 callbacks the reader sends continuation mode 2; only a matching history `dataEnd` completes that category. A live callback cannot complete a history read. Five seconds without a matching response or the 64-page cap fails that category. A failed, unsupported or unparsable category no longer stops the read: the reader continues to the next category, the day is aggregated from whatever arrived, and the metrics it could not collect are uploaded as null. Categories without a native request method are not requested; a timeout is not silently interpreted as an unsupported sensor.

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
