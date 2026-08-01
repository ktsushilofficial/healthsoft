import axios from 'axios';
import { PILL_DISPENSER_VENDOR_CONFIG } from './vendorConfig';
import type {
  PillDispenserAlarm,
  PillDispenserAlarmInput,
  PillDispenserDeviceInformation,
  PillDispenserDrug,
  PillDispenserOwnerProfile,
  PillDispenserPlan,
  PillDispenserPlanInput,
  VendorApiEnvelope,
  VendorRegisteredUser,
  VendorTokenData,
} from './vendorTypes';

const apiClient = axios.create({
  timeout: 20000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

const SECRET_FINGERPRINT_LOG_FIELDS = new Set([
  'token',
  'company_secret',
]);

const COMPLETELY_REDACTED_LOG_FIELDS = new Set([
  'patient_name',
  'patient_birthday',
  'birthday',
  'drug_name',
]);

const MASKED_LOG_FIELDS = new Set([
  'company_code',
  'device_sn',
  'mobile',
  'patient_mobile',
  'username',
]);

let requestSequence = 0;

function maskLogValue(value: unknown): string {
  const text = String(value ?? '');
  return text.length <= 4 ? '[REDACTED]' : `***${text.slice(-4)}`;
}

function fingerprintSecretForLog(value: unknown): string {
  const text = String(value ?? '');
  const ending = text.slice(-4) || 'empty';
  return `[REDACTED length=${text.length} ending=${ending}]`;
}

function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeForLog);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      const normalizedKey = key.toLowerCase();
      if (SECRET_FINGERPRINT_LOG_FIELDS.has(normalizedKey)) {
        return [key, fingerprintSecretForLog(entry)];
      }
      if (COMPLETELY_REDACTED_LOG_FIELDS.has(normalizedKey)) {
        return [key, '[REDACTED]'];
      }
      if (MASKED_LOG_FIELDS.has(normalizedKey)) {
        return [key, maskLogValue(entry)];
      }
      return [key, sanitizeForLog(entry)];
    }),
  );
}

function logVendorApi(
  label: 'request' | 'response' | 'error',
  details: Record<string, unknown>,
) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const prefix = `[Pill Dispenser API] ${label.toUpperCase()}`;
  if (label === 'error') {
    console.warn(prefix, sanitizeForLog(details));
    return;
  }
  console.log(prefix, sanitizeForLog(details));
}

const ERROR_MESSAGES: Record<number, string> = {
  602: 'Do-not-disturb start and end times cannot be the same.',
  604: 'The dispenser does not exist.',
  606: 'The selected time is invalid.',
  608: 'This dispenser is not bound to the selected user.',
  609: 'The dispenser could not be bound.',
  610: 'This user has already bound the dispenser.',
  611: 'The dispenser is offline.',
  612: 'The dispenser rejected the setting.',
  701: 'The vendor session expired.',
  702: 'The vendor company code is invalid.',
  703: 'The vendor company credentials are invalid.',
  705: 'The vendor user could not be registered.',
  706: 'This vendor user already exists.',
  707: 'A required value is missing.',
  708: 'The vendor user does not exist.',
  710: 'The dispenser could not be unbound.',
  711: 'One or more values are invalid.',
  713: 'The vendor session needs a new token.',
  804: 'The dispenser does not have a medication plan yet.',
  901: 'The alarm does not exist.',
  902: 'Two alarms cannot use the same time.',
};

export class PillDispenserVendorError extends Error {
  readonly code: number;

  constructor(code: number, message?: string) {
    super(
      ERROR_MESSAGES[code] || message || `Vendor request failed (${code}).`,
    );
    this.name = 'PillDispenserVendorError';
    this.code = code;
  }
}

let cachedToken: {
  host: string;
  value: string;
  expiresAt: number;
} | null = null;
let tokenRequest: {
  host: string;
  value: Promise<string>;
} | null = null;

function endpointUrl(endpoint: string): string {
  return `${PILL_DISPENSER_VENDOR_CONFIG.host}/index.php?s=/Company/CommonApi/${endpoint}`;
}

function responseCode(response: VendorApiEnvelope<unknown>): number {
  const code = Number(response.code);
  return Number.isFinite(code) ? code : -1;
}

async function rawPost<T>(
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<VendorApiEnvelope<T>> {
  const requestId = ++requestSequence;
  const url = endpointUrl(endpoint);
  const startedAt = Date.now();
  logVendorApi('request', {
    requestId,
    endpoint,
    url,
    payload,
  });

  try {
    const response = await apiClient.post<VendorApiEnvelope<T>>(
      url,
      payload,
    );
    logVendorApi('response', {
      requestId,
      endpoint,
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      body: response.data,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logVendorApi('error', {
        requestId,
        endpoint,
        httpStatus: error.response?.status ?? null,
        durationMs: Date.now() - startedAt,
        message: error.message,
        body: error.response?.data ?? null,
      });
      const message =
        typeof error.response?.data === 'object' &&
        error.response?.data &&
        'message' in error.response.data
          ? String(error.response.data.message)
          : error.message;
      throw new Error(message || 'Unable to reach the pill dispenser service.');
    }
    logVendorApi('error', {
      requestId,
      endpoint,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function getVendorToken(forceRefresh = false): Promise<string> {
  const currentHost = PILL_DISPENSER_VENDOR_CONFIG.host;
  if (tokenRequest && tokenRequest.host === currentHost) {
    return tokenRequest.value;
  }
  if (
    !forceRefresh &&
    cachedToken &&
    cachedToken.host === currentHost &&
    cachedToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedToken.value;
  }
  const request = (async () => {
    const response = await rawPost<VendorTokenData>('get_token', {
      company_code: PILL_DISPENSER_VENDOR_CONFIG.companyCode,
      company_secret: PILL_DISPENSER_VENDOR_CONFIG.companySecret,
    });
    const code = responseCode(response);
    if (code !== 200 || !response.data?.token) {
      throw new PillDispenserVendorError(code, response.message);
    }

    const lifetimeSeconds = Number(response.data.expire) || 7200;
    cachedToken = {
      host: currentHost,
      value: response.data.token,
      expiresAt: Date.now() + lifetimeSeconds * 1000,
    };
    return response.data.token;
  })();
  const requestEntry = { host: currentHost, value: request };
  tokenRequest = requestEntry;

  try {
    return await request;
  } finally {
    if (tokenRequest === requestEntry) {
      tokenRequest = null;
    }
  }
}

async function authorizedPostWithCodes<T>(
  endpoint: string,
  payload: Record<string, unknown>,
  acceptedCodes: readonly number[],
  retryExpiredToken = true,
): Promise<T> {
  const token = await getVendorToken();
  const response = await rawPost<T>(endpoint, { token, ...payload });
  const code = responseCode(response);
  if ((code === 701 || code === 713) && retryExpiredToken) {
    cachedToken = null;
    await getVendorToken(true);
    return authorizedPostWithCodes(endpoint, payload, acceptedCodes, false);
  }
  if (!acceptedCodes.includes(code)) {
    throw new PillDispenserVendorError(code, response.message);
  }
  return response.data;
}

async function authorizedPost<T>(
  endpoint: string,
  payload: Record<string, unknown>,
  retryExpiredToken = true,
): Promise<T> {
  return authorizedPostWithCodes(endpoint, payload, [200], retryExpiredToken);
}

function numberValue(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseDrugs(value: unknown): PillDispenserDrug[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const drug = objectValue(item);
    return {
      drugName: stringValue(drug.drug_name),
      drugAmount: stringValue(drug.drug_amount),
    };
  });
}

function parseAlarm(value: unknown): PillDispenserAlarm {
  const alarm = objectValue(value);
  const status = numberValue(alarm.status, 2);
  return {
    alarmId: stringValue(alarm.alarm_id),
    alarmTime: stringValue(alarm.alarm_time, '00:00'),
    status: status === 0 || status === 1 ? status : 2,
    drugs: parseDrugs(alarm.drugs),
  };
}

function baseDevicePayload(userId: string, deviceSn: string) {
  return {
    user_id: userId,
    device_sn: deviceSn,
  };
}

export const pillDispenserVendorApi = {
  async registerUser(
    profile: PillDispenserOwnerProfile,
  ): Promise<VendorRegisteredUser> {
    return authorizedPostWithCodes<VendorRegisteredUser>(
      'user_register',
      {
        username: profile.username,
        mobile: profile.mobile,
      },
      [200, 706],
    );
  },

  async bindDevice(
    userId: string,
    deviceSn: string,
    profile: PillDispenserOwnerProfile,
  ): Promise<void> {
    await authorizedPost('bind_device', {
      ...baseDevicePayload(userId, deviceSn),
      patient_name: profile.patientName,
      ...(profile.patientSex ? { patient_sex: profile.patientSex } : {}),
      ...(profile.patientBirthday
        ? { patient_birthday: profile.patientBirthday }
        : {}),
      ...(profile.mobile ? { patient_mobile: profile.mobile } : {}),
    });
  },

  async unbindDevice(userId: string, deviceSn: string): Promise<void> {
    await authorizedPost('unbind_device', baseDevicePayload(userId, deviceSn));
  },

  async getStatus(userId: string, deviceSn: string): Promise<boolean> {
    const data = await authorizedPost<Record<string, unknown>>(
      'get_status',
      baseDevicePayload(userId, deviceSn),
    );
    return numberValue(data?.status) === 1;
  },

  async getInformation(
    userId: string,
    deviceSn: string,
  ): Promise<PillDispenserDeviceInformation> {
    const data = objectValue(
      await authorizedPost<unknown>(
        'get_information',
        baseDevicePayload(userId, deviceSn),
      ),
    );
    const language = numberValue(data.language, 2);
    const dateFormat = numberValue(data.date_format);
    const timeFormat = numberValue(data.time_format);
    const volume = numberValue(data.volume, 2);
    const unfazedSwitch = numberValue(data.unfazed_switch, 1);
    return {
      language: language === 1 ? 1 : 2,
      timeZoneDistrict: stringValue(data.time_zone_district, '+0000'),
      dateFormat: dateFormat === 1 || dateFormat === 2 ? dateFormat : 0,
      timeFormat: timeFormat === 1 ? 1 : 0,
      timeOut: numberValue(data.time_out, 60),
      omitting: numberValue(data.omitting, 120),
      volume: volume === 1 || volume === 3 || volume === 4 ? volume : 2,
      unfazedSwitch: unfazedSwitch === 2 ? 2 : 1,
      unfazedStart: stringValue(data.unfazed_start, '23:00'),
      unfazedEnd: stringValue(data.unfazed_end, '06:30'),
      battery: numberValue(data.battery),
      batteryVolume: numberValue(data.battery_volume),
      rotate: numberValue(data.rotate),
      uncap: numberValue(data.uncap),
      wifi: numberValue(data.wifi),
      gsm: numberValue(data.gsm),
      currentCeilId: stringValue(data.current_ceil_id),
      ceilRemaining: numberValue(data.ceil_remaining),
      firmwareVersion: stringValue(data.firmware_version),
    };
  },

  async getPlan(userId: string, deviceSn: string): Promise<PillDispenserPlan> {
    const raw = await authorizedPost<unknown>(
      'get_plan',
      baseDevicePayload(userId, deviceSn),
    );
    const data = objectValue(Array.isArray(raw) ? raw[0] : raw);
    return {
      ceilUsed: numberValue(data.ceil_used),
      deviceCeilAmount: numberValue(data.device_ceil_amount),
      planId: stringValue(data.plan_id),
      alwaysUse: numberValue(data.always_use, 1) === 0 ? 0 : 1,
      startDate: stringValue(data.start_date),
      endDate: stringValue(data.end_date),
      alarms: Array.isArray(data.alarms) ? data.alarms.map(parseAlarm) : [],
    };
  },

  async setPlan(
    userId: string,
    deviceSn: string,
    plan: PillDispenserPlanInput,
  ): Promise<void> {
    await authorizedPost('set_plan', {
      ...baseDevicePayload(userId, deviceSn),
      plan_id: plan.planId,
      ceil_used: plan.ceilUsed,
      always_use: plan.alwaysUse,
      ...(plan.alwaysUse === 0
        ? { start_date: plan.startDate, end_date: plan.endDate }
        : {}),
    });
  },

  async setAlarm(
    userId: string,
    deviceSn: string,
    alarm: PillDispenserAlarmInput,
  ): Promise<void> {
    await authorizedPost('set_alarm', {
      ...baseDevicePayload(userId, deviceSn),
      alarm_id: alarm.alarmId,
      alarm_time: alarm.alarmTime,
      status: alarm.status === 1 ? 1 : 2,
      drugs: alarm.drugs.map(drug => ({
        drug_name: drug.drugName,
        drug_amount: drug.drugAmount,
      })),
    });
  },

  setTimeFormat: (userId: string, deviceSn: string, value: 0 | 1) =>
    authorizedPost('set_time_format', {
      ...baseDevicePayload(userId, deviceSn),
      time_format: value,
    }),

  setDateFormat: (userId: string, deviceSn: string, value: 0 | 1 | 2) =>
    authorizedPost('set_date_format', {
      ...baseDevicePayload(userId, deviceSn),
      date_format: value,
    }),

  setVolume: (userId: string, deviceSn: string, value: 1 | 2 | 3 | 4) =>
    authorizedPost('set_voice', {
      ...baseDevicePayload(userId, deviceSn),
      volume: value,
    }),

  setDisturb: (
    userId: string,
    deviceSn: string,
    enabled: 1 | 2,
    start: string,
    end: string,
  ) =>
    authorizedPost('unfazed', {
      ...baseDevicePayload(userId, deviceSn),
      unfazed_switch: enabled,
      unfazed_start: start,
      unfazed_end: end,
    }),

  setMissDoseReminder: (userId: string, deviceSn: string, minutes: number) =>
    authorizedPost('set_omitting', {
      ...baseDevicePayload(userId, deviceSn),
      omitting: minutes,
    }),

  setOvertimeReminder: (userId: string, deviceSn: string, minutes: number) =>
    authorizedPost('set_time_out', {
      ...baseDevicePayload(userId, deviceSn),
      time_out: minutes,
    }),

  setLanguage: (userId: string, deviceSn: string, language: 1 | 2) =>
    authorizedPost('set_language', {
      ...baseDevicePayload(userId, deviceSn),
      language,
    }),

  setTimezone: (userId: string, deviceSn: string, timezone: string) =>
    authorizedPost('set_timezone', {
      ...baseDevicePayload(userId, deviceSn),
      time_zone_district: timezone,
    }),

  takeMedicine: (userId: string, deviceSn: string) =>
    authorizedPost('take_drug', baseDevicePayload(userId, deviceSn)),

  muteAlarm: (userId: string, deviceSn: string) =>
    authorizedPost('mute_alarm', baseDevicePayload(userId, deviceSn)),

  reboot: (userId: string, deviceSn: string) =>
    authorizedPost('reboot', baseDevicePayload(userId, deviceSn)),

  resetMedicinePlate: (userId: string, deviceSn: string) =>
    authorizedPost('reset', baseDevicePayload(userId, deviceSn)),
};
