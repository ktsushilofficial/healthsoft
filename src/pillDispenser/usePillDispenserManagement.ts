import { useCallback, useEffect, useRef, useState } from 'react';
import { parsePillDispenserCode } from './deviceSn';
import { PILL_DISPENSER_VENDOR_CONFIG } from './vendorConfig';
import { PillDispenserVendorError, pillDispenserVendorApi } from './vendorApi';
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
  const mountedRef = useRef(true);
  const [record, setRecord] = useState<PillDispenserLocalRecord | null>(null);
  const [information, setInformation] =
    useState<PillDispenserDeviceInformation | null>(null);
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

  const refreshForRecord = useCallback(
    async (target: PillDispenserLocalRecord, showBusy = true) => {
      if (!target.deviceSn) return;
      if (showBusy) setWorking('refresh');
      setError(null);

      try {
        const isOnline = await pillDispenserVendorApi.getStatus(
          target.vendorUserId,
          target.deviceSn,
        );
        if (!mountedRef.current) return;
        setOnline(isOnline);

        if (!isOnline) {
          setInformation(null);
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
        if (!mountedRef.current) return;

        if (informationResult.status === 'fulfilled') {
          setInformation(informationResult.value);
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
        if (!mountedRef.current) return;
        if (
          requestError instanceof PillDispenserVendorError &&
          requestError.code === 611
        ) {
          setOnline(false);
          setInformation(null);
          setMessage('The dispenser is bound but currently offline.');
        } else {
          setError(readableError(requestError));
        }
      } finally {
        if (mountedRef.current && showBusy) setWorking(null);
      }
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const initialize = async () => {
      setLoading(true);
      setInformation(null);
      setPlan(null);
      setOnline(null);
      setError(null);
      setMessage(null);

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
    };
  }, [applyRecord, profile?.ownerKey, refreshForRecord]);

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
      setInformation(null);
      setPlan(null);
      setOnline(null);
      setMessage('The pill dispenser was unbound successfully.');
    } catch (unbindError) {
      if (mountedRef.current) setError(readableError(unbindError));
    } finally {
      if (mountedRef.current) setWorking(null);
    }
  }, [applyRecord]);

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
        if (!/^[+-]\d{4}$/.test(settings.timeZoneDistrict)) {
          throw new Error('Timezone must look like +0530 or -0600.');
        }
        validateTime(settings.unfazedStart, 'Do-not-disturb start');
        validateTime(settings.unfazedEnd, 'Do-not-disturb end');
        if (
          settings.omitting < 10 ||
          settings.omitting > 240 ||
          settings.omitting % 10 !== 0
        ) {
          throw new Error(
            'Missed-dose reminder must be 10–240 minutes in steps of 10.',
          );
        }
        if (
          settings.timeOut < 5 ||
          settings.timeOut > 120 ||
          settings.timeOut % 5 !== 0
        ) {
          throw new Error(
            'Overtime reminder must be 5–120 minutes in steps of 5.',
          );
        }

        const args = [current.vendorUserId, current.deviceSn] as const;
        await pillDispenserVendorApi.setLanguage(...args, settings.language);
        await pillDispenserVendorApi.setTimezone(
          ...args,
          settings.timeZoneDistrict,
        );
        await pillDispenserVendorApi.setTimeFormat(
          ...args,
          settings.timeFormat,
        );
        await pillDispenserVendorApi.setDateFormat(
          ...args,
          settings.dateFormat,
        );
        await pillDispenserVendorApi.setVolume(...args, settings.volume);
        await pillDispenserVendorApi.setDisturb(
          ...args,
          settings.unfazedSwitch,
          settings.unfazedStart,
          settings.unfazedEnd,
        );
        await pillDispenserVendorApi.setMissDoseReminder(
          ...args,
          settings.omitting,
        );
        await pillDispenserVendorApi.setOvertimeReminder(
          ...args,
          settings.timeOut,
        );
        if (!mountedRef.current) return;
        setMessage('Device settings were saved.');
        await refreshForRecord(current, false);
      } catch (settingsError) {
        if (mountedRef.current) setError(readableError(settingsError));
      } finally {
        if (mountedRef.current) setWorking(null);
      }
    },
    [refreshForRecord],
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
    if (!current?.deviceSn) return;

    setWorking(action);
    setError(null);
    setMessage(null);
    try {
      await pillDispenserVendorApi[action](
        current.vendorUserId,
        current.deviceSn,
      );
      if (!mountedRef.current) return;
      const messages: Record<PillDispenserAction, string> = {
        takeMedicine: 'The dispenser was asked to present medicine now.',
        muteAlarm: 'The current alarm was muted.',
        reboot: 'The dispenser is rebooting.',
        resetMedicinePlate: 'The medicine plate was reset.',
      };
      setMessage(messages[action]);
    } catch (actionError) {
      if (mountedRef.current) setError(readableError(actionError));
    } finally {
      if (mountedRef.current) setWorking(null);
    }
  }, []);

  const selectAlarm = useCallback(
    (alarmId: string): PillDispenserAlarm | null =>
      plan?.alarms.find(alarm => alarm.alarmId === alarmId) ?? null,
    [plan?.alarms],
  );

  return {
    record,
    information,
    plan,
    online,
    loading,
    working,
    error,
    message,
    bind,
    unbind,
    refresh,
    saveSettings,
    savePlan,
    saveAlarm,
    runAction,
    selectAlarm,
  };
}
