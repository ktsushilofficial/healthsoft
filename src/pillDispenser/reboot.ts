import { PillDispenserVendorError, pillDispenserVendorApi } from './vendorApi';

export type PillDispenserRebootState = {
  phase:
    | 'checking'
    | 'sending'
    | 'waiting'
    | 'offline'
    | 'reconnected'
    | 'unconfirmed'
    | 'failed';
  message: string;
};

const STATUS_INTERVAL_MS = 3000;
const OBSERVATION_TIMEOUT_MS = 90000;

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) {
    const error = new Error('Reboot monitoring cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    checkCancelled(signal);
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      const error = new Error('Reboot monitoring cancelled.');
      error.name = 'AbortError';
      reject(error);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal.addEventListener('abort', cancel);
  });
}

function errorDetail(error: unknown): string {
  if (error instanceof PillDispenserVendorError) {
    return `${error.vendorMessage || error.message} (vendor code ${
      error.code
    })`;
  }
  return error instanceof Error
    ? error.message
    : 'The vendor service could not be reached.';
}

// The API has no reboot-completed event. Report the observed connection cycle,
// never infer a successful restart from the command acknowledgement alone.
export async function rebootPillDispenser({
  userId,
  deviceSn,
  signal,
  onProgress,
  onOnlineChange,
}: {
  userId: string;
  deviceSn: string;
  signal: AbortSignal;
  onProgress: (state: PillDispenserRebootState) => void;
  onOnlineChange: (online: boolean) => void;
}): Promise<void> {
  checkCancelled(signal);
  onProgress({
    phase: 'checking',
    message: 'Checking dispenser before reboot…',
  });
  try {
    const online = await pillDispenserVendorApi.getStatus(userId, deviceSn, {
      signal,
    });
    checkCancelled(signal);
    onOnlineChange(online);
    if (!online) throw new PillDispenserVendorError(611);
  } catch (error) {
    checkCancelled(signal);
    if (error instanceof PillDispenserVendorError && error.code === 611) {
      onOnlineChange(false);
    }
    onProgress({
      phase: 'failed',
      message: `Reboot was not sent. ${errorDetail(error)}`,
    });
    return;
  }

  onProgress({ phase: 'sending', message: 'Sending reboot request…' });
  let acknowledged = false;
  let acknowledgementError: string | null = null;
  try {
    await pillDispenserVendorApi.reboot(userId, deviceSn, { signal });
    checkCancelled(signal);
    acknowledged = true;
  } catch (error) {
    checkCancelled(signal);
    if (error instanceof PillDispenserVendorError) {
      if (error.code === 611) onOnlineChange(false);
      onProgress({
        phase: 'failed',
        message: `Reboot request failed. ${errorDetail(error)}`,
      });
      return;
    }
    // A transport failure can happen after the device receives the command.
    // Observe status without automatically sending another reboot.
    acknowledgementError = errorDetail(error);
  }

  onProgress({
    phase: 'waiting',
    message: acknowledged
      ? 'Reboot request accepted. Watching for the dispenser to disconnect and reconnect…'
      : `No acknowledgement received: ${acknowledgementError} The request may have reached the dispenser. Checking its status without sending another reboot…`,
  });
  const deadline = Date.now() + OBSERVATION_TIMEOUT_MS;
  let sawOffline = false;
  let lastStatusError: string | null = null;
  while (Date.now() < deadline) {
    await delay(Math.min(STATUS_INTERVAL_MS, deadline - Date.now()), signal);
    checkCancelled(signal);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    let online: boolean;
    try {
      online = await pillDispenserVendorApi.getStatus(userId, deviceSn, {
        signal,
        timeout: Math.min(10000, remaining),
      });
      checkCancelled(signal);
      lastStatusError = null;
    } catch (error) {
      checkCancelled(signal);
      if (error instanceof PillDispenserVendorError && error.code === 611) {
        online = false;
        lastStatusError = null;
      } else {
        lastStatusError = errorDetail(error);
        onProgress({
          phase: 'waiting',
          message: `Status check failed; retrying. ${lastStatusError}`,
        });
        continue;
      }
    }
    onOnlineChange(online);
    if (!online) {
      sawOffline = true;
      onProgress({
        phase: 'offline',
        message: 'The dispenser is offline. Waiting for it to reconnect…',
      });
    } else if (sawOffline) {
      onProgress({
        phase: 'reconnected',
        message:
          'The dispenser went offline and is now back online after the reboot request.',
      });
      return;
    }
  }
  checkCancelled(signal);
  const observation = lastStatusError
    ? `Status checks could not be completed: ${lastStatusError}`
    : sawOffline
    ? 'The dispenser went offline but has not reconnected. Check its power and Wi-Fi, then refresh status.'
    : 'The dispenser remained online; the API did not show a restart. Check the device before trying again.';
  onProgress({
    phase: 'unconfirmed',
    message: `Restart could not be confirmed within 90 seconds. ${observation}`,
  });
}
