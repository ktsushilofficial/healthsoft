// src/context/AuthContext.tsx
import React, {createContext, useEffect, useRef, useState, useContext} from 'react';
import axios, {Method} from 'axios';
import * as Keychain from 'react-native-keychain';

const API_BASE_URL = 'http://seniorcare.healthsoftcare.in';
const TOKEN_STORAGE_SERVICE = 'healthsoft.auth.tokens';
const TOKEN_STORAGE_USERNAME = 'healthsoft-auth';
const CARETAKER_ROLE = 'CARE_TAKER';

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
}

interface AuthContextType {
  user: UserData | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  login: (email: string, password: string) => Promise<UserData>;
  loginWithPhone: (phoneNumber: string, countryCode: string, password: string) => Promise<UserData>;
  loginWithGoogle: () => Promise<UserData>;
  signup: (data: SignupData) => Promise<UserData>;
  verifyEmail: (userId?: string) => Promise<UserData>;
  refreshUserProfile: () => Promise<UserData>;
  updateProfile: (data: UpdateProfileData) => Promise<UserData>;
  logout: () => Promise<void>;
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
  raw: Partial<UserData>,
  fallbackTokens?: AuthTokens | null,
): UserData => {
  const tokens = extractTokens(raw, fallbackTokens);

  return {
    email: raw.email ?? '',
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
  await Keychain.resetGenericPassword({service: TOKEN_STORAGE_SERVICE});
};

export const AuthProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [user, setUser] = useState<UserData | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [_tokens, setTokens] = useState<AuthTokens | null>(null);

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
  ): Promise<T> => {
    const authTokens = overrideTokens ?? tokensRef.current;
    const headers =
      authTokens?.accessToken && authTokens?.tokenType
        ? {Authorization: `${authTokens.tokenType} ${authTokens.accessToken}`}
        : undefined;

    const response = await apiClient.request<T>({
      url: path,
      method,
      data,
      headers,
    });

    return response.data;
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
          data: {refreshToken: currentTokens.refreshToken},
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
  ): Promise<T> => {
    if (!tokensRef.current?.accessToken) {
      throw new Error('Session expired. Please sign in again.');
    }

    try {
      return await performRequest<T>(path, method, data);
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
        return await performRequest<T>(path, method, data, refreshedTokens);
      } catch (retryError) {
        throw new Error(getErrorMessage(retryError));
      }
    }
  };

  const refreshUserProfile = async (): Promise<UserData> => {
    const profile = await authorizedRequest<Partial<UserData>>(
      '/api/v1/auth/me',
      'GET',
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

    // Use the correct API endpoint and payload structure
    const payload: {
      userId: string;
      firstName: string;
      lastName: string;
      countryCode?: string;
      phoneNumber?: number;
    } = {
      userId: currentUser.user_id,
      firstName,
      lastName,
    };

    if (normalizedCountryCode) {
      payload.countryCode = normalizedCountryCode;
    }

    if (normalizedPhoneNumber) {
      payload.phoneNumber = Number(normalizedPhoneNumber);
    }

    // First update the profile on the server
    await authorizedRequest<Partial<UserData>>('/api/v1/users/update-profile', 'POST', payload);

    // Update local state with the new profile data
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

    // Fetch the updated profile from server to ensure consistency
    try {
      const profile = await authorizedRequest<Partial<UserData>>('/api/v1/auth/me', 'GET');
      const normalized = normalizeUser(
        withProfileOverride(profile),
        tokensRef.current,
      );
      setUser(normalized);
      return normalized;
    } catch {
      // If server fetch fails, return the locally patched user
      return localPatchedUser;
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

        const profile = await authorizedRequest<Partial<UserData>>(
          '/api/v1/auth/me',
          'GET',
        );
        const normalized = normalizeUser(
          withProfileOverride(profile),
          tokensRef.current,
        );
        setUser(normalized);
        setIsAuthenticated(true);
      } catch {
        await clearSession();
      } finally {
        setIsInitializing(false);
      }
    };

    bootstrapSession().catch(() => {
      setIsInitializing(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string, password: string): Promise<UserData> => {
    try {
      const authResponse = await performRequest<UserData>(
        '/api/v1/auth/signin/email',
        'POST',
        {email: email.trim().toLowerCase(), password},
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
          password
        },
        null,
      );

      return await applySession(authResponse);
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  };

  const loginWithGoogle = async (): Promise<UserData> => {
    throw new Error('Google sign-in is temporarily disabled.');
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
      role: CARETAKER_ROLE,
    };

    if (data.country_code?.trim()) {
      signupPayload.countryCode = data.country_code.trim();
    }

    if (data.phone_number?.trim()) {
      signupPayload.phoneNumber = Number(data.phone_number.trim());
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
          // Best-effort remote logout after local session is already cleared.
        });
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isInitializing,
        login,
        loginWithPhone,
        loginWithGoogle,
        signup,
        verifyEmail,
        refreshUserProfile,
        updateProfile,
        logout,
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
