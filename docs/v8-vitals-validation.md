# V8 vitals correction and validation

The client now preserves measurement dates and missing values, uses separate Android/iOS callback maps, recognizes Android `detailMinterStep`, and spaces dynamic HR samples five seconds apart. Android SDK distances/calories are already scaled; the app no longer guesses distance units from magnitude.

The device screen and upload use the same daily aggregation. Valid daily activity totals take precedence; otherwise unique detail intervals are summed. Latest vitals use measurement time. Blood pressure requires a paired reading. Duplicate identity includes every metric, including SpO2 and stress.

Live readings are separate from history responses and keep per-metric timestamps. Upload fallback requires a same-day value measured within five minutes; this is an application freshness policy. Missing physiological values remain null, while valid zero activity remains zero. An entirely empty day is not uploaded. Older zero-filled backend rows are not rewritten by this change.

History is read one category at a time. After 50 callbacks the reader sends continuation mode 2; only a matching history `dataEnd` completes that category. A live callback cannot complete a history read. Five seconds without a matching response or the 12-page cap marks the read incomplete. Incomplete downloads remain visible for review but cannot be uploaded as successful syncs. Categories without a native request method are not requested; a timeout is not silently interpreted as an unsupported sensor.

Ingestion uses incremental duplicate indexes and buffers; visible history/debug updates are batched at 100 ms. Connecting a band resets in-memory vitals. A versioned local cache prevents records parsed with the old timestamp rules from being restored into the corrected pipeline.

## Automated verification

Tests cover SDK-shaped Android/iOS callbacks through provider upload, exact-day selection, null serialization, stale/future live fallback, midnight HR series, reversed history order, duplicate/revised activity intervals, distinct SpO2/stress records, page continuation, timeouts, disconnects, and blocked uploads after partial downloads. The app smoke test now unmounts its renderer so the full suite exits normally.

## Checks requiring hardware or server access

- Verify `/api/v1/vitals/sync` accepts null fields and handles partial metric sets as intended. The client payload types allow null and the request layer passes it through; the server implementation is not in this repository. No production upload was performed during this work.
- Record the exact band model/firmware and compare the same stored records against the vendor app on Android and iOS, including zero-activity days and missing vitals.
- Exercise downloads exceeding 50 callbacks, a mid-download disconnect, and repeated syncs. Confirm totals remain stable and the UI clearly indicates incomplete reads.
- Confirm monitoring schedules, enabled sensors, BP/stress semantics, temperature units, and retention with the supplier. This change does not choose or overwrite unknown device monitoring settings.
- The existing one-day automatic upload policy remains. Historical backfill and ECG calibration/routing require their own confirmed requirements and hardware evidence.
