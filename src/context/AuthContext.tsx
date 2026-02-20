// src/context/AuthContext.tsx
import React, { createContext, useEffect, useRef, useState, useContext } from 'react';
import { Platform } from 'react-native';
import axios, { Method } from 'axios';
import * as Keychain from 'react-native-keychain';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

const API_BASE_URL = 'http://seniorcare.healthsoftcare.in';
const TOKEN_STORAGE_SERVICE = 'healthsoft.auth.tokens';
const TOKEN_STORAGE_USERNAME = 'healthsoft-auth';
const SELECTED_SENIOR_STORAGE_SERVICE = 'healthsoft.prefs.selectedSenior';
// Profile storage removed as per requirement
const CARETAKER_ROLE = 'CARE_TAKER';
const GUARDIAN_ROLE = 'GUARDIAN';
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
  login: (email: string, password: string) => Promise<UserData>;
  loginWithPhone: (phoneNumber: string, countryCode: string, password: string) => Promise<UserData>;
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
  forgotPassword: (email: string) => Promise<void>;
  seniors: Senior[];
  selectedSenior: Senior | null;
  getMySeniors: () => Promise<Senior[]>;
  selectSenior: (seniorId: string) => Promise<void>;
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

interface ApiErrorResponse {
  message?: string;
  errors?: string[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    Accept: 'application/json',
  },
});

const isUnauthorizedError = (error: unknown): boolean =>
  axios.isAxiosError(error) && error.response?.status === 401;

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

    console.log(`[API Request] ${method} ${API_BASE_URL}${path}`, data ? JSON.stringify(data, null, 2) : '');

    try {
      const response = await apiClient.request<T>({
        url: path,
        method,
        data,
        headers,
      });

      console.log(`[API Response] ${method} ${path}`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.log(`[API Error] ${method} ${path}`, error.response?.status, JSON.stringify(error.response?.data, null, 2));
      } else {
        console.log(`[API Error] ${method} ${path}`, error);
      }
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

  const applySession = async (sessionUser: UserData): Promise<UserData> => {
    const sessionTokens = extractTokens(sessionUser);

    if (!sessionTokens.accessToken || !sessionTokens.refreshToken) {
      throw new Error('Authentication tokens were not returned by the server.');
    }

    tokensRef.current = sessionTokens;
    setTokens(sessionTokens);
    await saveTokens(sessionTokens);

    // Profile persistence removed.
    // We strictly use the sessionUser provided by the login/signup response
    // or rely on fetching the profile from the API subsequently.

    const normalized = normalizeUser(sessionUser, sessionTokens);
    setUser(normalized);
    setIsAuthenticated(true);

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

      try {
        const refreshResponse = await apiClient.request<Partial<UserData>>({
          url: '/api/v1/auth/refresh',
          method: 'POST',
          data: { refreshToken: currentTokens.refreshToken },
          headers: {
            Authorization: `${currentTokens.tokenType} ${currentTokens.accessToken}`,
          },
        });

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
      } catch {
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

  const refreshUserProfile = async (): Promise<UserData> => {
    const profile = await authorizedRequest<Partial<UserData>>(
      '/profile',
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
  };

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

    await authorizedRequest<Partial<UserData>>('/api/v1/auth/me', 'PUT', payload);

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
      const profile = await authorizedRequest<Partial<UserData>>('/profile', 'GET', undefined, { Accept: '*/*' });
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

  const forgotPassword = async (email: string): Promise<void> => {
    try {
      await performRequest<void>(
        '/api/v1/auth/forgot-password',
        'POST',
        { email },
        null
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
            '/profile',
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

      return await applySession(authResponse);
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

      return await applySession(authResponse);
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

    if (snapshotTokens?.accessToken && snapshotTokens.tokenType) {
      apiClient
        .request<void>({
          url: '/api/v1/auth/logout',
          method: 'POST',
          headers: {
            Authorization: `${snapshotTokens.tokenType} ${snapshotTokens.accessToken}`,
          },
        })
        .catch(() => {
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
        `/api/v1/auth/change-password?userId=${userId}&oldPassword=${encodeURIComponent(oldPassword)}&newPassword=${encodeURIComponent(newPassword)}`,
        'POST',
      );
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  };

  const refreshToken = async (): Promise<UserData> => {
    const refreshedTokens = await refreshTokens();
    if (!refreshedTokens) {
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

  const getMySeniors = async (): Promise<Senior[]> => {
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
  };

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

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isInitializing,
        isCaretaker,
        login,
        loginWithPhone,
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
        seniors,
        selectedSenior,
        getMySeniors,
        selectSenior,
      }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
