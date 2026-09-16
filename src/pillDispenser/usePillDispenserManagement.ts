import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { parsePillDispenserCode } from './deviceSn';
import { PILL_DISPENSER_VENDOR_CONFIG } from './vendorConfig';
import { PillDispenserVendorError, pillDispenserVendorApi } from './vendorApi';
import { findPillDispenserSettingsMismatches } from './settingsVerification';
import {
  buildPillDispenserSettingsUpdates,
  type PillDispenserSettingsUpdateKey,
} from './settingsUpdates';
import { rebootPillDispenser, type PillDispenserRebootState } from './reboot';
import {
  clearPillDispenserBinding,
  loadPillDispenserRecord,
  savePillDispenserRecord,
} from './vendorStorage';
import type {
  PillDispenserAlarm,
  PillDispenserAlarmInput,
  PillDispenserDeviceInformation,
  PillDispenserLocalRecord,
  PillDispenserOwnerProfile,
  PillDispenserPlan,
  PillDispenserPlanInput,
  PillDispenserSettingsInput,
} from './vendorTypes';

export type PillDispenserAction =
  | 'takeMedicine'
  | 'muteAlarm'
  | 'reboot'
  | 'resetMedicinePlate';

function readableError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The pill dispenser request failed.';
}

function validateTime(value: string, label: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`${label} must use 24-hour HH:MM format.`);
  }
}

function validateDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }
}

export function usePillDispenserManagement(
  profile: PillDispenserOwnerProfile | null,
) {
  const recordRef = useRef<PillDispenserLocalRecord | null>(null);
  const informationRef = useRef<PillDispenserDeviceInformation | null>(null);
  const mountedRef = useRef(true);
  const refreshRequestRef = useRef(0);
  const actionControllerRef = useRef<AbortController | null>(null);
  const [rebootState, setRebootState] = useState<PillDispenserRebootState | null>(null);
  const [record, setRecord] = useState<PillDispenserLocalRecord | null>(null);
  const [information, setInformation] =
    useState<PillDispenserDeviceInformation | null>(null);
  const [informationUpdatedAt, setInformationUpdatedAt] = useState<number | null>(
    null,
  );
  const [plan, setPlan] = useState<PillDispenserPlan | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const applyRecord = useCallback((next: PillDispenserLocalRecord | null) => {
    recordRef.current = next;
    setRecord(next);
  }, []);

  // Keeps the reported settings available for diffing saves, and records when
  // the app last read them so the UI never implies a live measurement.
  const applyInformation = useCallback(
    (next: PillDispenserDeviceInformation | null) => {
      informationRef.current = next;
      setInformation(next);
      setInformationUpdatedAt(next ? Date.now() : null);
    },
    [],
  );

  const refreshForRecord = useCallback(
    async (target: PillDispenserLocalRecord, showBusy = true) => {
      if (!target.deviceSn) return;
      const requestId = ++refreshRequestRef.current;
      const isCurrent = () =>
        mountedRef.current && requestId === refreshRequestRef.current &&
        recordRef.current?.ownerKey === target.ownerKey &&
        recordRef.current?.deviceSn === target.deviceSn;
      if (showBusy) setWorking('refresh');
      setError(null);
      setOnline(null);

      try {
        const isOnline = await pillDispenserVendorApi.getStatus(
          target.vendorUserId,
          target.deviceSn,
        );
        if (!isCurrent()) return;
        setOnline(isOnline);

        if (!isOnline) {
          applyInformation(null);
          setMessage('The dispenser is bound but currently offline.');
          return;
        }

        const [informationResult, planResult] = await Promise.allSettled([
          pillDispenserVendorApi.getInformation(
            target.vendorUserId,
            target.deviceSn,
          ),
          pillDispenserVendorApi.getPlan(target.vendorUserId, target.deviceSn),
        ]);
        if (!isCurrent()) return;

        if (informationResult.status === 'fulfilled') {
          applyInformation(informationResult.value);
        } else {
          throw informationResult.reason;
        }

        if (planResult.status === 'fulfilled') {
          setPlan(planResult.value);
        } else if (
          planResult.reason instanceof PillDispenserVendorError &&
          planResult.reason.code === 804
        ) {
          setPlan(null);
        } else {
          throw planResult.reason;
        }
        setMessage('Device status and settings are up to date.');
      } catch (requestError) {
        if (!isCurrent()) return;
        if (
          requestError instanceof PillDispenserVendorError &&
          requestError.code === 611
        ) {
          setOnline(false);
          applyInformation(null);
          setMessage('The dispenser is bound but currently offline.');
        } else {
          setError(readableError(requestError));
        }
      } finally {
        if (isCurrent() && showBusy) setWorking(null);
      }
    },
    [applyInformation],
  );

  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true;
      let cancelled = false;

      const initialize = async () => {
        setLoading(true);
        applyInformation(null);
        setPlan(null);
        setOnline(null);
        setError(null);
        setMessage(null);
        setRebootState(null);
        setWorking(null);
        applyRecord(null);

        if (!profile?.ownerKey) {
          applyRecord(null);
          setLoading(false);
          return;
        }

        try {
          const saved = await loadPillDispenserRecord(profile.ownerKey);
          if (cancelled) return;
          applyRecord(saved);
          setLoading(false);
          if (saved?.deviceSn) {
            await refreshForRecord(saved, false);
          }
        } catch (storageError) {
          if (cancelled) return;
          setLoading(false);
          setError(readableError(storageError));
        }
      };

      initialize();
      return () => {
        cancelled = true;
        mountedRef.current = false;
        refreshRequestRef.current += 1;
        actionControllerRef.current?.abort();
        actionControllerRef.current = null;
      };
    }, [applyInformation, applyRecord, profile?.ownerKey, refreshForRecord]),
  );

  const bind = useCallback(
    async (codeOrUrl: string) => {
      if (!profile) {
        setError('Select a senior profile before binding a dispenser.');
        return;
      }
      if (!profile.mobile.trim()) {
        setError('A phone number is required to register the dispenser owner.');
        return;
      }

      setWorking('bind');
      setError(null);
      setMessage(null);
      try {
        const parsed = parsePillDispenserCode(codeOrUrl);
        const registerVendorUser = async (): Promise<PillDispenserLocalRecord> => {
          try {
            const registered =
              await pillDispenserVendorApi.registerUser(profile);
            const registeredUserId = String(
              registered?.user_id || '',
            ).trim();
            if (!registeredUserId) {
              throw new Error(
                'Zoomcare registered the vendor user without returning a user ID.',
              );
            }
            const registeredRecord: PillDispenserLocalRecord = {
              ownerKey: profile.ownerKey,
              vendorHost: PILL_DISPENSER_VENDOR_CONFIG.host,
              vendorUserId: registeredUserId,
              deviceSn: null,
              model: null,
              updatedAt: Date.now(),
            };
            await savePillDispenserRecord(registeredRecord);
            if (mountedRef.current) {
              applyRecord(registeredRecord);
            }
            return registeredRecord;
          } catch (registrationError) {
            if (
              registrationError instanceof PillDispenserVendorError &&
              registrationError.code === 706
            ) {
              throw new Error(
                'The Zoomcare user already exists, but the API did not return its user ID. ' +
                  'Ask Zoomcare to provide the user ID for this senior before connecting the dispenser.',
              );
            }
            throw registrationError;
          }
        };

        let current =
          recordRef.current ??
          (await loadPillDispenserRecord(profile.ownerKey));

        if (!current?.vendorUserId) {
          current = await registerVendorUser();
        }

        let existingBinding = false;
        let knownOffline = false;

        try {
          const isOnline = await pillDispenserVendorApi.getStatus(
            current.vendorUserId,
            parsed.deviceSn,
          );
          existingBinding = true;
          knownOffline = !isOnline;
        } catch (statusError) {
          if (statusError instanceof PillDispenserVendorError) {
            if (statusError.code === 604 || statusError.code === 608) {
              // Some vendor environments report an unbound DN as either
              // "device does not exist" or "unbound relationship". Let the
              // bind endpoint make the authoritative decision.
              existingBinding = false;
            } else if (statusError.code === 611) {
              // An offline response still confirms the existing relationship.
              existingBinding = true;
              knownOffline = true;
            } else if (statusError.code === 708) {
              // The locally cached vendor user was deleted or reset remotely.
              // Register again to obtain a valid ID before attempting to bind.
              current = await registerVendorUser();
              existingBinding = false;
              knownOffline = false;
            } else {
              throw statusError;
            }
          } else {
            throw statusError;
          }
        }

        if (!existingBinding) {
          try {
            await pillDispenserVendorApi.bindDevice(
              current.vendorUserId,
              parsed.deviceSn,
              profile,
            );
          } catch (bindError) {
            if (
              !(bindError instanceof PillDispenserVendorError) ||
              bindError.code !== 610
            ) {
              throw bindError;
            }
            // The vendor confirms this user already owns the dispenser.
            existingBinding = true;
          }
        }

        const boundRecord: PillDispenserLocalRecord = {
          ...current,
          deviceSn: parsed.deviceSn,
          model: parsed.model,
          updatedAt: Date.now(),
        };
        await savePillDispenserRecord(boundRecord);
        if (!mountedRef.current) return;
        applyRecord(boundRecord);
        setOnline(knownOffline ? false : null);
        setMessage(
          existingBinding
            ? knownOffline
              ? 'The existing dispenser binding was restored. The device is currently offline.'
              : 'The existing dispenser binding was restored.'
            : 'The pill dispenser was bound to this senior.',
        );
        await refreshForRecord(boundRecord, false);
      } catch (bindError) {
        if (mountedRef.current) setError(readableError(bindError));
      } finally {
        if (mountedRef.current) setWorking(null);
      }
    },
    [applyRecord, profile, refreshForRecord],
  );

  const unbind = useCallback(async () => {
    const current = recordRef.current;
    if (!current?.deviceSn) return;

    setWorking('unbind');
    setError(null);
    setMessage(null);
    try {
      await pillDispenserVendorApi.unbindDevice(
        current.vendorUserId,
        current.deviceSn,
      );
      const updated = await clearPillDispenserBinding(current.ownerKey);
      if (!mountedRef.current) return;
      applyRecord(updated);
      applyInformation(null);
      setPlan(null);
      setOnline(null);
      setRebootState(null);
      setMessage('The pill dispenser was unbound successfully.');
    } catch (unbindError) {
      if (mountedRef.current) setError(readableError(unbindError));
    } finally {
      if (mountedRef.current) setWorking(null);
    }
  }, [applyInformation, applyRecord]);

  const refresh = useCallback(async () => {
    const current = recordRef.current;
    if (current?.deviceSn) await refreshForRecord(current);
  }, [refreshForRecord]);

  const saveSettings = useCallback(
    async (settings: PillDispenserSettingsInput) => {
      const current = recordRef.current;
      if (!current?.deviceSn) return;

      setWorking('settings');
      setError(null);
      setMessage(null);
      try {
        // Validate per command, not up front: an unreported or invalid value in
        // a setting this save is not sending must not block or alter the rest.
        const validators: Partial<
          Record<PillDispenserSettingsUpdateKey, () => void>
        > = {
          timezone: () => {
            if (!/^[+-]\d{4}$/.test(settings.timeZoneDistrict)) {
              throw new Error('Timezone must look like +0530 or -0600.');
            }
          },
          disturb: () => {
            validateTime(settings.unfazedStart, 'Do-not-disturb start');
            validateTime(settings.unfazedEnd, 'Do-not-disturb end');
          },
          omitting: () => {
            if (
              settings.omitting < 10 ||
              settings.omitting > 240 ||
              settings.omitting % 10 !== 0
            ) {
              throw new Error(
                'Missed-dose reminder must be 10–240 minutes in steps of 10.',
              );
            }
          },
          timeOut: () => {
            if (
              settings.timeOut < 5 ||
              settings.timeOut > 120 ||
              settings.timeOut % 5 !== 0
            ) {
              throw new Error(
                'Overtime reminder must be 5–120 minutes in steps of 5.',
              );
            }
          },
        };

        const args = [current.vendorUserId, current.deviceSn] as const;
        const senders: Record<
          PillDispenserSettingsUpdateKey,
          () => Promise<unknown>
        > = {
          timezone: () =>
            pillDispenserVendorApi.setTimezone(
              ...args,
              settings.timeZoneDistrict,
            ),
          timeFormat: () =>
            pillDispenserVendorApi.setTimeFormat(...args, settings.timeFormat),
          dateFormat: () =>
            pillDispenserVendorApi.setDateFormat(...args, settings.dateFormat),
          volume: () => pillDispenserVendorApi.setVolume(...args, settings.volume),
          disturb: () =>
            pillDispenserVendorApi.setDisturb(
              ...args,
              settings.unfazedSwitch,
              settings.unfazedStart,
              settings.unfazedEnd,
            ),
          omitting: () =>
            pillDispenserVendorApi.setMissDoseReminder(
              ...args,
              settings.omitting,
            ),
          timeOut: () =>
            pillDispenserVendorApi.setOvertimeReminder(...args, settings.timeOut),
        };

        // The dispenser speaks a confirmation for every setting command it
        // accepts, so only the settings that actually changed are sent.
        const updates = buildPillDispenserSettingsUpdates(
          settings,
          informationRef.current,
        );
        if (updates.length === 0) {
          setMessage('Every setting already matches the dispenser. Nothing was sent.');
          return;
        }

        for (const update of updates) validators[update.key]?.();

        const applied: string[] = [];
        const failed: string[] = [];
        for (const update of updates) {
          try {
            await senders[update.key]();
            applied.push(update.label);
          } catch (updateError) {
            failed.push(`${update.label} (${readableError(updateError)})`);
          }
        }

        const changedCount = applied.length;
        const changedSummary = `${changedCount} setting${
          changedCount === 1 ? '' : 's'
        } updated: ${applied.join(', ')}.`;

        // Read the device back separately: a failed read must not hide the
        // commands the dispenser already accepted.
        let mismatches: string[] | null = null;
        let verificationError: string | null = null;
        try {
          const verifiedInformation =
            await pillDispenserVendorApi.getInformation(...args);
          if (!mountedRef.current) return;
          applyInformation(verifiedInformation);
          mismatches = findPillDispenserSettingsMismatches(
            settings,
            verifiedInformation,
          );
        } catch (verifyError) {
          if (!mountedRef.current) return;
          verificationError = readableError(verifyError);
        }

        if (failed.length > 0) {
          setError(
            `${
              changedCount > 0 ? `${changedSummary} ` : ''
            }These were not accepted: ${failed.join('; ')}.`,
          );
        } else if (verificationError) {
          setError(
            `${changedSummary} The saved values could not be read back to confirm them: ${verificationError}`,
          );
        } else if (mismatches && mismatches.length > 0) {
          setError(
            `Zoomcare accepted the save, but the dispenser did not confirm: ${mismatches.join(', ')}.`,
          );
        } else {
          setMessage(`${changedSummary} The dispenser confirmed the new values.`);
        }
      } catch (settingsError) {
        if (mountedRef.current) setError(readableError(settingsError));
      } finally {
        if (mountedRef.current) setWorking(null);
      }
    },
    [applyInformation],
  );

  const savePlan = useCallback(
    async (nextPlan: PillDispenserPlanInput) => {
      const current = recordRef.current;
      if (!current?.deviceSn) return;

      setWorking('plan');
      setError(null);
      setMessage(null);
      try {
        if (!nextPlan.planId) {
          throw new Error(
            'This dispenser has no plan ID. Ask the vendor to create its initial plan.',
          );
        }
        if (nextPlan.ceilUsed < 0) {
          throw new Error('Filled compartment count cannot be negative.');
        }
        if (nextPlan.alwaysUse === 0) {
          validateDate(nextPlan.startDate, 'Plan start date');
          validateDate(nextPlan.endDate, 'Plan end date');
        }
        await pillDispenserVendorApi.setPlan(
          current.vendorUserId,
          current.deviceSn,
          nextPlan,
        );
        if (!mountedRef.current) return;
        setMessage('Medication plan settings were saved.');
        await refreshForRecord(current, false);
      } catch (planError) {
        if (mountedRef.current) setError(readableError(planError));
      } finally {
        if (mountedRef.current) setWorking(null);
      }
    },
    [refreshForRecord],
  );

  const saveAlarm = useCallback(
    async (alarm: PillDispenserAlarmInput) => {
      const current = recordRef.current;
      if (!current?.deviceSn) return;

      setWorking(`alarm:${alarm.alarmId}`);
      setError(null);
      setMessage(null);
      try {
        if (!alarm.alarmId) throw new Error('Select an existing alarm slot.');
        validateTime(alarm.alarmTime, 'Alarm time');
        await pillDispenserVendorApi.setAlarm(
          current.vendorUserId,
          current.deviceSn,
          alarm,
        );
        if (!mountedRef.current) return;
        setMessage('Alarm was saved.');
        await refreshForRecord(current, false);
      } catch (alarmError) {
        if (mountedRef.current) setError(readableError(alarmError));
      } finally {
        if (mountedRef.current) setWorking(null);
      }
    },
    [refreshForRecord],
  );

  const runAction = useCallback(async (action: PillDispenserAction) => {
    const current = recordRef.current;
    if (!current?.deviceSn || actionControllerRef.current) return;

    const controller = new AbortController();
    actionControllerRef.current = controller;
    refreshRequestRef.current += 1;
    const isCurrent = () => mountedRef.current &&
      actionControllerRef.current === controller && !controller.signal.aborted &&
      recordRef.current?.ownerKey === current.ownerKey &&
      recordRef.current?.deviceSn === current.deviceSn;

    setWorking(action);
    setError(null);
    setMessage(null);
    setRebootState(null);
    try {
      if (action === 'reboot') {
        await rebootPillDispenser({
          userId: current.vendorUserId,
          deviceSn: current.deviceSn,
          signal: controller.signal,
          onProgress: state => { if (isCurrent()) setRebootState(state); },
          onOnlineChange: value => {
            if (!isCurrent()) return;
            setOnline(value);
            if (!value) applyInformation(null);
          },
        });
        return;
      }
      await pillDispenserVendorApi[action](
        current.vendorUserId,
        current.deviceSn,
      );
      if (!isCurrent()) return;
      const messages = {
        takeMedicine: 'The dispenser was asked to present medicine now.',
        muteAlarm: 'The current alarm was muted.',
        resetMedicinePlate: 'The medicine plate was reset.',
      };
      setMessage(messages[action]);
    } catch (actionError) {
      if (isCurrent()) setError(readableError(actionError));
    } finally {
      if (isCurrent()) setWorking(null);
      if (actionControllerRef.current === controller) actionControllerRef.current = null;
    }
  }, [applyInformation]);

  // The reboot watch runs for up to 90 seconds. Let the user end it instead of
  // waiting out the timeout with every other action disabled.
  const cancelAction = useCallback(() => {
    const controller = actionControllerRef.current;
    if (!controller) return;
    controller.abort();
    actionControllerRef.current = null;
    setWorking(null);
    setRebootState(previous =>
      previous
        ? {
            phase: 'unconfirmed',
            message:
              'Restart checking was stopped. The reboot request was not cancelled; ' +
              'refresh the status to see the dispenser connection.',
          }
        : previous,
    );
  }, []);

  const selectAlarm = useCallback(
    (alarmId: string): PillDispenserAlarm | null =>
      plan?.alarms.find(alarm => alarm.alarmId === alarmId) ?? null,
    [plan?.alarms],
  );

  return {
    record,
    information,
    informationUpdatedAt,
    plan,
    online,
    loading,
    working,
    error,
    message,
    rebootState,
    bind,
    unbind,
    refresh,
    saveSettings,
    savePlan,
    saveAlarm,
    runAction,
    cancelAction,
    selectAlarm,
  };
}
