// src/context/AuthContext.tsx
import React, { createContext, useCallback, useEffect, useMemo, useRef, useState, useContext } from 'react';
import { Platform } from 'react-native';
import axios, { Method } from 'axios';
import * as Keychain from 'react-native-keychain';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import {
  extractSeniorAssignedDevices,
  isMacAddressLike,
  normalizeMacAddress,
  type SeniorAssignedDevice,
} from '../utils/deviceAssignments';
import { clearAllCachedAssignedDeviceMatches } from '../utils/assignedDeviceMatchCache';
import type { SeniorDashboardApiResponse } from '../types/seniorDashboard';
import type { GuardianDashboardApiResponse } from '../types/guardianDashboard';
import { API_BASE_URL } from '../config/api';
import type { V8DailyVitalsSyncPayload, V8WebVitalsSyncPayload } from '../v8/models';

const TOKEN_STORAGE_SERVICE = 'healthsoft.auth.tokens';
const TOKEN_STORAGE_USERNAME = 'healthsoft-auth';
const SELECTED_SENIOR_STORAGE_SERVICE = 'healthsoft.prefs.selectedSenior';
// Profile storage removed as per requirement
const CARETAKER_ROLE = 'CARE_TAKER';
const GUARDIAN_ROLE = 'GUARDIAN';
const SENIOR_ROLE = 'SENIOR';
const WEB_CLIENT_ID = '388740977041-rvg9j86k6ie0etecc24qq9ovfp23lfj3.apps.googleusercontent.com';

export interface Senior {
  userId: string;
  firstName: string;
  lastName: string;
  profileImageUrl?: string;
  gender?: string;
  dateOfBirth?: number;
  height?: number;
  weight?: number;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

interface UserData {
  email: string;
  role: string;
  status: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  first_name: string;
  last_name: string;
  profile_image_url?: string | null;
  is_new_user: boolean;
  email_verified: boolean;
  last_login_at: number | string | null;
  country_code: string;
  phone_number: string;
  primaryEmail?: string;
}

interface AuthContextType {
  user: UserData | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  isCaretaker: boolean;
  authMethod: AuthMethod;
  login: (email: string, password: string) => Promise<UserData>;
  loginWithPhone: (phoneNumber: string, countryCode: string, password: string) => Promise<UserData>;
  loginMobileSendOtp: (phoneNumber: string) => Promise<void>;
  loginMobileVerifyOtp: (phoneNumber: string, otp: string) => Promise<UserData>;
  loginWithGoogle: () => Promise<UserData>;
  signup: (data: SignupData) => Promise<UserData>;
  verifyEmail: (userId?: string) => Promise<UserData>;
  refreshUserProfile: () => Promise<UserData>;
  updateProfile: (data: UpdateProfileData) => Promise<UserData>;
  logout: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  refreshToken: () => Promise<UserData>;
  googleAuth: (idToken: string) => Promise<UserData>;
  initiateGoogleLogin: () => Promise<void>;
  forgotPassword: (email: string) => Promise<string>;
  resetPassword: (otp: string, newPassword: string, confirmPassword: string, shortLivedToken: string) => Promise<void>;
  seniors: Senior[];
  selectedSenior: Senior | null;
  selectedSeniorHandBandMacs: string[];
  getMySeniors: () => Promise<Senior[]>;
  selectSenior: (seniorId: string) => Promise<void>;
  getAssignedDevicesForSenior: (seniorId: string) => Promise<SeniorAssignedDevice[]>;
  getSeniorDashboard: (seniorId: string) => Promise<SeniorDashboardApiResponse>;
  getGuardianDashboard: (guardianUserId: string) => Promise<GuardianDashboardApiResponse>;
  syncV8DailyVitals: (seniorId: string, payload: V8DailyVitalsSyncPayload) => Promise<void>;
  syncV8VitalsByDevice: (payload: V8WebVitalsSyncPayload) => Promise<void>;
  getV8VitalsSummary: (deviceUUID: string, days: number) => Promise<unknown>;
}

interface SignupData {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  country_code: string;
  phone_number: string;
  role: string;
}

interface UpdateProfileData {
  first_name: string;
  last_name: string;
  country_code: string;
  phone_number: string;
}

type AuthMethod = 'email' | 'phone' | 'otp' | 'google' | 'unknown';

interface ApiErrorResponse {
  message?: string;
  errors?: string[];
}

interface ForgotPasswordResponse {
  success: boolean;
  message: string;
  shortLivedToken: string;
  expiresInMinutes?: number;
  platform?: string;
  remainingAttempts?: number;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const missingProviderError = () =>
  new Error('Auth context is unavailable. Please restart the app and sign in again.');

const fallbackAuthContext: AuthContextType = {
  user: null,
  isAuthenticated: false,
  isInitializing: false,
  isCaretaker: false,
  authMethod: 'unknown',
  login: async () => {
    throw missingProviderError();
  },
  loginWithPhone: async () => {
    throw missingProviderError();
  },
  loginMobileSendOtp: async () => {
    throw missingProviderError();
  },
  loginMobileVerifyOtp: async () => {
    throw missingProviderError();
  },
  loginWithGoogle: async () => {
    throw missingProviderError();
  },
  signup: async () => {
    throw missingProviderError();
  },
  verifyEmail: async () => {
    throw missingProviderError();
  },
  refreshUserProfile: async () => {
    throw missingProviderError();
  },
  updateProfile: async () => {
    throw missingProviderError();
  },
  logout: async () => {
    throw missingProviderError();
  },
  changePassword: async () => {
    throw missingProviderError();
  },
  refreshToken: async () => {
    throw missingProviderError();
  },
  googleAuth: async () => {
    throw missingProviderError();
  },
  initiateGoogleLogin: async () => {
    throw missingProviderError();
  },
  forgotPassword: async () => {
    throw missingProviderError();
  },
  resetPassword: async () => {
    throw missingProviderError();
  },
  seniors: [],
  selectedSenior: null,
  selectedSeniorHandBandMacs: [],
  getMySeniors: async () => {
    throw missingProviderError();
  },
  selectSenior: async () => {
    throw missingProviderError();
  },
  getAssignedDevicesForSenior: async () => {
    throw missingProviderError();
  },
  getSeniorDashboard: async () => {
    throw missingProviderError();
  },
  getGuardianDashboard: async () => {
    throw missingProviderError();
  },
  syncV8DailyVitals: async () => {
    throw missingProviderError();
  },
  syncV8VitalsByDevice: async () => {
    throw missingProviderError();
  },
  getV8VitalsSummary: async () => {
    throw missingProviderError();
  },
};

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    Accept: 'application/json',
  },
});

const isUnauthorizedError = (error: unknown): boolean =>
  axios.isAxiosError(error) &&
  (error.response?.status === 401 || error.response?.status === 403);

const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const payload = error.response?.data as ApiErrorResponse | string | undefined;

    if (payload && typeof payload === 'object') {
      if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        return payload.errors.join(', ');
      }
      if (payload.message) {
        return payload.message;
      }
      // @ts-ignore - Handle various error payload formats
      if (payload.errorMessage) {
        // @ts-ignore
        return payload.errorMessage;
      }
      // @ts-ignore
      if (payload.error) {
        // @ts-ignore
        return payload.error;
      }
    }

    if (typeof payload === 'string' && payload.trim().length > 0) {
      return payload;
    }

    if (status) {
      return `Request failed (${status})`;
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'Unexpected request error.';
};

const stringifyForLog = (value: unknown): string => {
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const logApiRequest = (
  method: Method,
  path: string,
  headers: Record<string, string>,
  data?: unknown,
) => {
  console.log(
    `[API Request] ${method} ${API_BASE_URL}${path}\nHeaders: ${stringifyForLog(headers)}\nBody: ${stringifyForLog(data)}`,
  );
};

const logApiResponse = (
  method: Method,
  path: string,
  status: number,
  headers: unknown,
  data: unknown,
) => {
  console.log(
    `[API Response] ${method} ${API_BASE_URL}${path}\nStatus: ${status}\nHeaders: ${stringifyForLog(headers)}\nBody: ${stringifyForLog(data)}`,
  );
};

const logApiError = (
  method: Method,
  path: string,
  headers: Record<string, string>,
  data: unknown,
  error: unknown,
) => {
  if (axios.isAxiosError(error)) {
    console.log(
      `[API Error] ${method} ${API_BASE_URL}${path}\nHeaders: ${stringifyForLog(headers)}\nBody: ${stringifyForLog(data)}\nStatus: ${error.response?.status ?? 'unknown'}\nResponse Headers: ${stringifyForLog(error.response?.headers)}\nResponse Body: ${stringifyForLog(error.response?.data)}`,
    );
    return;
  }

  console.log(
    `[API Error] ${method} ${API_BASE_URL}${path}\nHeaders: ${stringifyForLog(headers)}\nBody: ${stringifyForLog(data)}\nError: ${stringifyForLog(error)}`,
  );
};

const extractTokens = (
  raw: Partial<UserData>,
  fallback?: AuthTokens | null,
): AuthTokens => ({
  accessToken: raw.access_token ?? fallback?.accessToken ?? '',
  refreshToken: raw.refresh_token ?? fallback?.refreshToken ?? '',
  tokenType: raw.token_type ?? fallback?.tokenType ?? 'Bearer',
  expiresIn: raw.expires_in ?? fallback?.expiresIn ?? 0,
});

const normalizeUser = (
  raw: Partial<UserData> & { primaryEmail?: string },
  fallbackTokens?: AuthTokens | null,
): UserData => {
  const tokens = extractTokens(raw, fallbackTokens);

  return {
    email: raw.email || raw.primaryEmail || '',
    role: raw.role ?? '',
    status: raw.status ?? '',
    user_id: raw.user_id ?? '',
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: tokens.tokenType,
    expires_in: tokens.expiresIn,
    first_name: raw.first_name ?? '',
    last_name: raw.last_name ?? '',
    profile_image_url: raw.profile_image_url ?? null,
    is_new_user: raw.is_new_user ?? false,
    email_verified: raw.email_verified ?? false,
    last_login_at: raw.last_login_at ?? null,
    country_code: raw.country_code ?? '',
    phone_number: raw.phone_number ?? '',
    primaryEmail: raw.primaryEmail,
  };
};

const loadStoredTokens = async (): Promise<AuthTokens | null> => {
  const credentials = await Keychain.getGenericPassword({
    service: TOKEN_STORAGE_SERVICE,
  });

  if (!credentials) {
    return null;
  }

  try {
    const parsed = JSON.parse(credentials.password) as AuthTokens;
    if (!parsed.accessToken || !parsed.refreshToken) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const saveTokens = async (tokens: AuthTokens): Promise<void> => {
  await Keychain.setGenericPassword(
    TOKEN_STORAGE_USERNAME,
    JSON.stringify(tokens),
    {
      service: TOKEN_STORAGE_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
};

const clearStoredTokens = async (): Promise<void> => {
  await Keychain.resetGenericPassword({ service: TOKEN_STORAGE_SERVICE });
};

// Local profile storage functions removed


export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<UserData | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [_tokens, setTokens] = useState<AuthTokens | null>(null);
  const [seniors, setSeniors] = useState<Senior[]>([]);
  const [selectedSenior, setSelectedSenior] = useState<Senior | null>(null);
  const [selectedSeniorHandBandMacs, setSelectedSeniorHandBandMacs] = useState<string[]>([]);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('unknown');

  // Configure Google Sign-In
  useEffect(() => {
    GoogleSignin.configure({
      webClientId: WEB_CLIENT_ID,
      iosClientId: '388740977041-nrihpjmac4145t7iv2gmo1ga8p42ghil.apps.googleusercontent.com',
      offlineAccess: true,
    });
  }, []);

  const tokensRef = useRef<AuthTokens | null>(null);
  const refreshPromiseRef = useRef<Promise<AuthTokens | null> | null>(null);
  const profileOverrideRef = useRef<{
    first_name: string;
    last_name: string;
    country_code: string;
    phone_number: string;
  } | null>(null);

  const withProfileOverride = (profile: Partial<UserData>): Partial<UserData> => {
    const override = profileOverrideRef.current;
    if (!override) {
      return profile;
    }

    const backendMatchesOverride =
      (profile.first_name ?? '') === override.first_name &&
      (profile.last_name ?? '') === override.last_name &&
      (profile.country_code ?? '') === override.country_code &&
      (profile.phone_number ?? '') === override.phone_number;

    if (backendMatchesOverride) {
      profileOverrideRef.current = null;
      return profile;
    }

    return {
      ...profile,
      first_name: override.first_name,
      last_name: override.last_name,
      country_code: override.country_code,
      phone_number: override.phone_number,
    };
  };

  const performRequest = async <T,>(
    path: string,
    method: Method,
    data?: unknown,
    overrideTokens?: AuthTokens | null,
    extraHeaders?: Record<string, string>,
  ): Promise<T> => {
    const authTokens = overrideTokens ?? tokensRef.current;
    const headers: Record<string, string> = {
      ...(authTokens?.accessToken && authTokens?.tokenType
        ? { Authorization: `${authTokens.tokenType} ${authTokens.accessToken}` }
        : {}),
      ...extraHeaders,
    };

    logApiRequest(method, path, headers, data);

    try {
      const response = await apiClient.request<T>({
        url: path,
        method,
        data,
        headers,
      });

      logApiResponse(method, path, response.status, response.headers, response.data);
      return response.data;
    } catch (error) {
      logApiError(method, path, headers, data, error);
      throw error;
    }
  };

  const clearSession = async (): Promise<void> => {
    tokensRef.current = null;
    refreshPromiseRef.current = null;
    profileOverrideRef.current = null;
    setTokens(null);
    setUser(null);
    setIsAuthenticated(false);
    try {
      await clearStoredTokens();
    } catch {
      // Local state is already cleared; ignore secure storage cleanup failure.
    }
  };

  const applySession = async (
    sessionUser: UserData,
    method: AuthMethod = authMethod,
  ): Promise<UserData> => {
    const sessionTokens = extractTokens(sessionUser);

    if (!sessionTokens.accessToken || !sessionTokens.refreshToken) {
      throw new Error('Authentication tokens were not returned by the server.');
    }

    tokensRef.current = sessionTokens;
    setTokens(sessionTokens);
    await saveTokens(sessionTokens);

    const normalized = normalizeUser(sessionUser, sessionTokens);
    setUser(normalized);
    setIsAuthenticated(true);
    setAuthMethod(method ?? 'unknown');

    // Return the normalized user from the login/signup response directly.
    // A separate /profile fetch is NOT performed here — AccountScreen fetches
    // it once on mount via its own loadProfile() call, preventing an infinite
    // re-fetch loop that was triggered when applySession called refreshUserProfile()
    // which updated user state, causing consumers to re-render and re-request.
    return normalized;
  };

  const refreshTokens = async (): Promise<AuthTokens | null> => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    refreshPromiseRef.current = (async () => {
      const currentTokens = tokensRef.current;
      if (!currentTokens?.refreshToken) {
        return null;
      }

      const refreshPath = '/api/v1/auth/refresh';
      const refreshHeaders = {
        refreshToken: currentTokens.refreshToken,
      };

      try {
        logApiRequest('POST', refreshPath, refreshHeaders, undefined);
        const refreshResponse = await apiClient.request<Partial<UserData>>({
          url: refreshPath,
          method: 'POST',
          headers: refreshHeaders,
        });
        logApiResponse(
          'POST',
          refreshPath,
          refreshResponse.status,
          refreshResponse.headers,
          refreshResponse.data,
        );

        const nextTokens = extractTokens(refreshResponse.data, currentTokens);
        if (!nextTokens.accessToken || !nextTokens.refreshToken) {
          return null;
        }

        tokensRef.current = nextTokens;
        setTokens(nextTokens);
        await saveTokens(nextTokens);

        setUser(prev =>
          prev
            ? normalizeUser(
              {
                ...prev,
                access_token: nextTokens.accessToken,
                refresh_token: nextTokens.refreshToken,
                token_type: nextTokens.tokenType,
                expires_in: nextTokens.expiresIn,
              },
              nextTokens,
            )
            : prev,
        );

        return nextTokens;
      } catch (error) {
        logApiError('POST', refreshPath, refreshHeaders, undefined, error);
        return null;
      }
    })();

    try {
      return await refreshPromiseRef.current;
    } finally {
      refreshPromiseRef.current = null;
    }
  };

  const authorizedRequest = async <T,>(
    path: string,
    method: Method,
    data?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> => {
    if (!tokensRef.current?.accessToken) {
      throw new Error('Session expired. Please sign in again.');
    }

    try {
      return await performRequest<T>(path, method, data, undefined, extraHeaders);
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        throw new Error(getErrorMessage(error));
      }

      const refreshedTokens = await refreshTokens();
      if (!refreshedTokens) {
        await clearSession();
        throw new Error('Session expired. Please sign in again.');
      }

      try {
        return await performRequest<T>(path, method, data, refreshedTokens, extraHeaders);
      } catch (retryError) {
        throw new Error(getErrorMessage(retryError));
      }
    }
  };

  const refreshUserProfile = useCallback(async (): Promise<UserData> => {
    const profile = await authorizedRequest<Partial<UserData>>(
      '/api/v1/profile',
      'GET',
      undefined,
      { Accept: '*/*' },
    );
    const normalized = normalizeUser(
      withProfileOverride(profile),
      tokensRef.current,
    );
    setUser(normalized);
    setIsAuthenticated(true);
    return normalized;
    // authorizedRequest and withProfileOverride are stable (defined outside or via refs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateProfile = async (data: UpdateProfileData): Promise<UserData> => {
    const currentUser = user;
    if (!currentUser) {
      throw new Error('No active session found.');
    }

    const firstName = data.first_name.trim();
    const lastName = data.last_name.trim();
    const countryCode = data.country_code.replace(/[^\d]/g, '').trim();
    const normalizedCountryCode = countryCode ? `+${countryCode.slice(0, 4)}` : '';
    const normalizedPhoneNumber = data.phone_number.replace(/[^\d]/g, '').trim();

    if (!firstName || !lastName) {
      throw new Error('First name and last name are required.');
    }

    if (
      normalizedPhoneNumber &&
      (normalizedPhoneNumber.length < 7 || normalizedPhoneNumber.length > 15)
    ) {
      throw new Error('Phone number must be between 7 and 15 digits.');
    }

    const payload: {
      firstName: string;
      lastName: string;
      countryCode?: string;
      phoneNumber?: number;
    } = {
      firstName,
      lastName,
    };

    if (normalizedCountryCode) {
      payload.countryCode = normalizedCountryCode;
    }

    if (normalizedPhoneNumber) {
      payload.phoneNumber = Number(normalizedPhoneNumber);
    }

    await authorizedRequest<Partial<UserData>>('/api/v1/profile', 'PUT', payload);

    profileOverrideRef.current = {
      first_name: firstName,
      last_name: lastName,
      country_code: normalizedCountryCode,
      phone_number: normalizedPhoneNumber,
    };

    const localPatchedUser = normalizeUser(
      {
        ...currentUser,
        first_name: firstName,
        last_name: lastName,
        country_code: normalizedCountryCode,
        phone_number: normalizedPhoneNumber,
      },
      tokensRef.current,
    );
    setUser(localPatchedUser);

    try {
      const profile = await authorizedRequest<Partial<UserData>>('/api/v1/profile', 'GET', undefined, { Accept: '*/*' });
      const normalized = normalizeUser(
        withProfileOverride(profile),
        tokensRef.current,
      );
      setUser(normalized);

      return normalized;
    } catch {
      return localPatchedUser;
    }
  };

  const forgotPassword = async (email: string): Promise<string> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new Error('Email is required for password reset.');
    }
    try {
      const response = await performRequest<ForgotPasswordResponse>(
        '/api/v1/auth/forgot-password',
        'POST',
        { email: normalizedEmail, platform: Platform.OS },
        null
      );
      if (!response || !response.shortLivedToken) {
        throw new Error('No reset token received from server.');
      }
      return response.shortLivedToken;
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  };

  const resetPassword = async (otp: string, newPassword: string, confirmPassword: string, shortLivedToken: string): Promise<void> => {
    try {
      await performRequest<void>(
        '/api/v1/auth/reset-password',
        'POST',
        { otp, newPassword, confirmPassword },
        null,
        { Authorization: `Bearer ${shortLivedToken}` }
      );
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  };

  useEffect(() => {
    const bootstrapSession = async () => {
      try {
        const storedTokens = await loadStoredTokens();
        if (!storedTokens) {
          return;
        }

        tokensRef.current = storedTokens;
        setTokens(storedTokens);

        let profile: Partial<UserData> = {};
        try {
          profile = await authorizedRequest<Partial<UserData>>(
            '/api/v1/profile',
            'GET',
            undefined,
            { Accept: '*/*' },
          );
        } catch {
          // Proceed with empty profile if fetch fails
        }

        const normalized = normalizeUser(
          withProfileOverride(profile),
          tokensRef.current,
        );
        setUser(normalized);
        setIsAuthenticated(true);

        // Fetch seniors and load selected senior (only for caretakers/guardians)
        if (normalized.role === CARETAKER_ROLE || normalized.role === GUARDIAN_ROLE) {
          try {
            const seniorsList = await getMySeniors();
            await loadSelectedSenior(seniorsList);
          } catch {
            // Ignore failures in fetching seniors during bootstrap
          }
        } else {
          setSeniors([]);
          setSelectedSenior(null);
        }
      } catch {
        await clearSession();
      } finally {
        setIsInitializing(false);
      }
    };

    bootstrapSession().catch(() => {
      setIsInitializing(false);
    });
  }, []);

  const login = async (email: string, password: string): Promise<UserData> => {
    try {
      const authResponse = await performRequest<UserData>(
        '/api/v1/auth/signin',
        'POST',
        { email: email.trim().toLowerCase(), password, platform: Platform.OS },
        null,
      );

      return await applySession(authResponse, 'email');
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  };

  const loginWithPhone = async (phoneNumber: string, countryCode: string, password: string): Promise<UserData> => {
    try {
      const authResponse = await performRequest<UserData>(
        '/api/v1/auth/signin/phone',
        'POST',
        {
          phoneNumber: phoneNumber.replace(/[^\d]/g, ''),
          countryCode: countryCode.replace(/[^\d]/g, ''),
          password,
          platform: Platform.OS
        },
        null,
      );

      return await applySession(authResponse, 'phone');
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  };

  const loginMobileSendOtp = async (phoneNumber: string): Promise<void> => {
    try {
      await performRequest<void>(
        '/api/v1/auth/signin/mobile',
        'POST',
        { phoneNumber },
        null,
      );
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  };

  const loginMobileVerifyOtp = async (phoneNumber: string, otp: string): Promise<UserData> => {
    try {
      const authResponse = await performRequest<UserData>(
        '/api/v1/auth/signin/mobile/verify',
        'POST',
        { phoneNumber, otp, platform: Platform.OS },
        null,
      );

      return await applySession(authResponse, 'otp');
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  };

  const loginWithGoogle = async (): Promise<UserData> => {
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      const idToken = response.data?.idToken;

      if (!idToken) {
        throw new Error('Google sign-in failed: no ID token received.');
      }

      // Send idToken to our backend for authentication
      return await googleAuth(idToken);
    } catch (error: any) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        throw new Error('Google sign-in was cancelled.');
      } else if (error.code === statusCodes.IN_PROGRESS) {
        throw new Error('Google sign-in is already in progress.');
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error('Google Play Services not available.');
      }
      throw new Error(error.message || 'Google sign-in failed.');
    }
  };

  const verifyEmail = async (userId?: string): Promise<UserData> => {
    const targetUserId = userId || user?.user_id;
    if (!targetUserId) {
      throw new Error('Missing user ID required for email verification.');
    }

    await authorizedRequest<void>(
      `/api/v1/auth/verify-email/${targetUserId}`,
      'POST',
    );
    return await refreshUserProfile();
  };

  const signup = async (data: SignupData): Promise<UserData> => {
    const signupPayload: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      role: string;
      countryCode?: string;
      phoneNumber?: number;
    } = {
      email: data.email.trim().toLowerCase(),
      password: data.password,
      firstName: data.first_name.trim(),
      lastName: data.last_name.trim(),
      role: data.role,
    };

    if (data.country_code?.trim()) {
      const cleanedCountryCode = data.country_code.replace(/[^\d]/g, '').trim();
      signupPayload.countryCode = cleanedCountryCode ? `+${cleanedCountryCode.slice(0, 4)}` : '';
    }

    if (data.phone_number?.trim()) {
      const cleanedPhone = data.phone_number.replace(/[^\d]/g, '').trim();
      if (cleanedPhone) {
        signupPayload.phoneNumber = Number(cleanedPhone);
      }
    }

    try {
      const authResponse = await performRequest<UserData>(
        '/api/v1/auth/signup/email',
        'POST',
        signupPayload,
        null,
      );

      await applySession(authResponse);
      return await verifyEmail(authResponse.user_id);
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  };

  const logout = async (): Promise<void> => {
    const snapshotTokens = tokensRef.current;
    await clearSession();
    setSelectedSenior(null);
    setSeniors([]);
    try {
      await Keychain.resetGenericPassword({ service: SELECTED_SENIOR_STORAGE_SERVICE });
    } catch {
      // Ignore
    }
    try {
      await clearAllCachedAssignedDeviceMatches();
    } catch {
      // Ignore
    }

    if (snapshotTokens?.refreshToken && snapshotTokens.tokenType) {
      const logoutPath = '/api/v1/auth/logout';
      const logoutHeaders = {
        refreshToken: snapshotTokens.refreshToken,
      };
      console.log(
        `[API Auth Tokens] logout\nAccess Token: ${snapshotTokens.accessToken}\nRefresh Token: ${snapshotTokens.refreshToken}\nToken Type: ${snapshotTokens.tokenType}`,
      );
      logApiRequest('POST', logoutPath, logoutHeaders, undefined);
      apiClient
        .request<void>({
          url: logoutPath,
          method: 'POST',
          headers: logoutHeaders,
        })
        .then(response => {
          logApiResponse('POST', logoutPath, response.status, response.headers, response.data);
        })
        .catch(error => {
          logApiError('POST', logoutPath, logoutHeaders, undefined, error);
          // Best-effort remote logout
        });
    }
  };

  const changePassword = async (oldPassword: string, newPassword: string): Promise<void> => {
    const userId = user?.user_id;
    if (!userId) {
      throw new Error('No active session found.');
    }

    try {
      await authorizedRequest<void>(
        '/api/v1/auth/change-password',
        'POST',
        { userId, oldPassword, newPassword }
      );
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  };

  const refreshToken = async (): Promise<UserData> => {
    const refreshedTokens = await refreshTokens();
    if (!refreshedTokens) {
      await clearSession();
      throw new Error('Unable to refresh tokens. Please sign in again.');
    }

    return await refreshUserProfile();
  };

  const googleAuth = async (idToken: string): Promise<UserData> => {
    try {
      console.log('Google ID Token:', idToken);
      const authResponse = await performRequest<UserData>(
        '/api/v1/auth/google',
        'POST',
        { idToken, platform: Platform.OS },
        null,
      );

      return await applySession(authResponse);
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  };

  const initiateGoogleLogin = async (): Promise<void> => {
    try {
      await performRequest<void>(
        '/api/v1/auth/login/google',
        'GET',
        null,
        null,
      );
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  };

  const getMySeniors = useCallback(async (): Promise<Senior[]> => {
    try {
      const seniorsList = await authorizedRequest<Senior[]>(
        '/api/v1/seniors/my-seniors',
        'GET',
      );
      setSeniors(seniorsList);
      return seniorsList;
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
    // authorizedRequest is stable (reads from refs internally)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectSenior = async (seniorId: string): Promise<void> => {
    const senior = seniors.find(s => s.userId === seniorId);
    if (!senior) {
      throw new Error('Senior not found in your list.');
    }

    setSelectedSenior(senior);
    try {
      await Keychain.setGenericPassword(
        'selected_senior',
        seniorId,
        {
          service: SELECTED_SENIOR_STORAGE_SERVICE,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }
      );
    } catch (error) {
      console.warn('Failed to persist selected senior', error);
    }
  };

  const loadSelectedSenior = async (currentSeniors: Senior[]) => {
    try {
      const credentials = await Keychain.getGenericPassword({
        service: SELECTED_SENIOR_STORAGE_SERVICE,
      });

      if (credentials && credentials.password) {
        const savedSeniorId = credentials.password;
        const matchingSenior = currentSeniors.find(s => s.userId === savedSeniorId);
        if (matchingSenior) {
          setSelectedSenior(matchingSenior);
        }
      }
    } catch {
      // Ignore if loading fails
    }
  };

  const isCaretaker = user?.role === CARETAKER_ROLE || user?.role === GUARDIAN_ROLE;

  useEffect(() => {
    if (!isCaretaker || !selectedSenior) {
      return;
    }

    const nextMatch = seniors.find(s => s.userId === selectedSenior.userId);
    if (nextMatch) {
      if (nextMatch !== selectedSenior) {
        setSelectedSenior(nextMatch);
      }
      return;
    }

    setSelectedSenior(null);
    void Keychain.resetGenericPassword({ service: SELECTED_SENIOR_STORAGE_SERVICE }).catch(() => {
      // Ignore storage cleanup failures; UI state already recovered.
    });
  }, [isCaretaker, selectedSenior, seniors]);

  const getAssignedDevicesForSenior = useCallback(async (seniorId: string): Promise<SeniorAssignedDevice[]> => {
    const trimmedSeniorId = seniorId.trim();
    if (!trimmedSeniorId) {
      throw new Error('Senior ID is required to fetch devices.');
    }

    try {
      const payload = await authorizedRequest<unknown>(
        `/api/v1/devices/assignments/seniors/${trimmedSeniorId}/devices`,
        'GET',
        undefined,
        { Accept: '*/*' },
      );
      return extractSeniorAssignedDevices(payload);
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
    // authorizedRequest is stable (reads from refs internally)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSelectedSeniorHandBandMacs = async () => {
      const targetSeniorId = isCaretaker
        ? selectedSenior?.userId?.trim() ?? ''
        : user?.role === SENIOR_ROLE
          ? user.user_id.trim()
          : '';

      if (!targetSeniorId) {
        if (!cancelled) {
          setSelectedSeniorHandBandMacs([]);
        }
        return;
      }

      try {
        const assigned = await getAssignedDevicesForSenior(targetSeniorId);
        if (cancelled) {
          return;
        }

        const nextMacs = Array.from(
          new Set(
            assigned
              .filter(device => isMacAddressLike(device.deviceIdentifier))
              .map(device => normalizeMacAddress(device.deviceIdentifier))
              .filter((value): value is string => !!value),
          ),
        );

        setSelectedSeniorHandBandMacs(nextMacs);
      } catch {
        if (!cancelled) {
          setSelectedSeniorHandBandMacs([]);
        }
      }
    };

    void loadSelectedSeniorHandBandMacs();

    return () => {
      cancelled = true;
    };
  }, [getAssignedDevicesForSenior, isCaretaker, selectedSenior?.userId, user?.role, user?.user_id]);

  const getSeniorDashboard = useCallback(async (seniorId: string): Promise<SeniorDashboardApiResponse> => {
    const trimmed = seniorId.trim();
    if (!trimmed) {
      throw new Error('Senior ID is required for the dashboard.');
    }
    try {
      return await authorizedRequest<SeniorDashboardApiResponse>(
        `/api/v1/senior-dashboard/${encodeURIComponent(trimmed)}`,
        'GET',
        undefined,
        { Accept: '*/*' },
      );
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getGuardianDashboard = useCallback(async (guardianUserId: string): Promise<GuardianDashboardApiResponse> => {
    const trimmed = guardianUserId.trim();
    if (!trimmed) {
      throw new Error('Guardian user ID is required for the dashboard.');
    }
    try {
      return await authorizedRequest<GuardianDashboardApiResponse>(
        `/api/v1/guardian-dashboard/${encodeURIComponent(trimmed)}`,
        'GET',
        undefined,
        { Accept: '*/*' },
      );
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncV8DailyVitals = useCallback(async (seniorId: string, payload: V8DailyVitalsSyncPayload): Promise<void> => {
    const trimmed = seniorId.trim();
    if (!trimmed) {
      throw new Error('Senior ID is required for V8 daily vitals sync.');
    }
    await authorizedRequest<void>(
      `/api/v1/seniors/${encodeURIComponent(trimmed)}/v8/vitals/daily-sync`,
      'POST',
      payload,
      {
        Accept: '*/*',
        'Content-Type': 'application/json',
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncV8VitalsByDevice = useCallback(async (payload: V8WebVitalsSyncPayload): Promise<void> => {
    await authorizedRequest<void>(
      '/api/v1/vitals/sync',
      'POST',
      payload,
      {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getV8VitalsSummary = useCallback(async (deviceUUID: string, days: number): Promise<unknown> => {
    const uuid = deviceUUID.trim();
    if (!uuid) {
      throw new Error('Device UUID is required for vitals summary.');
    }
    const normalizedDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 1;
    return await authorizedRequest<unknown>(
      `/api/v1/vitals/summary?deviceUUID=${encodeURIComponent(uuid)}&days=${normalizedDays}`,
      'GET',
      undefined,
      { Accept: 'application/json, text/plain, */*' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear seniors cache when user is not a caretaker/guardian
  useEffect(() => {
    if (user && !(user.role === CARETAKER_ROLE || user.role === GUARDIAN_ROLE)) {
      setSeniors([]);
      setSelectedSenior(null);
    }
    if (!user) {
      setSelectedSeniorHandBandMacs([]);
    }
  }, [user?.role]);

  const contextValue = useMemo(
    () => ({
      user,
      isAuthenticated,
      isInitializing,
      isCaretaker,
      authMethod,
      login,
      loginWithPhone,
      loginMobileSendOtp,
      loginMobileVerifyOtp,
      loginWithGoogle,
      signup,
      verifyEmail,
      refreshUserProfile,
      updateProfile,
      logout,
      changePassword,
      refreshToken,
      googleAuth,
      initiateGoogleLogin,
      forgotPassword,
      resetPassword,
      seniors,
      selectedSenior,
      selectedSeniorHandBandMacs,
      getMySeniors,
      selectSenior,
      getAssignedDevicesForSenior,
      getSeniorDashboard,
      getGuardianDashboard,
      syncV8DailyVitals,
      syncV8VitalsByDevice,
      getV8VitalsSummary,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      user, isAuthenticated, isInitializing, isCaretaker, authMethod,
      seniors, selectedSenior, selectedSeniorHandBandMacs, refreshUserProfile, getMySeniors, getAssignedDevicesForSenior,
      getSeniorDashboard, getGuardianDashboard, syncV8DailyVitals, syncV8VitalsByDevice, getV8VitalsSummary,
    ],
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    console.error('useAuth called outside AuthProvider. Returning fallback auth context.');
    return fallbackAuthContext;
  }
  return context;
};
