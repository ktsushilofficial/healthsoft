// src/context/AuthContext.tsx
import React, {
  createContext,
  useState,
  useContext,
  ReactNode,
} from 'react';
import axios, {Method} from 'axios';

const API_BASE_URL = 'http://seniorcare.healthsoftcare.in';

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
  login: (email: string, password: string) => Promise<UserData>;
  loginWithGoogle: () => Promise<UserData>;
  signup: (data: SignupData) => Promise<UserData>;
  verifyEmail: (userId?: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface SignupData {
  email: string;
  password: string;
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

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected request error.';
};

const request = async <T,>(
  path: string,
  method: Method,
  data?: unknown,
  accessToken?: string,
): Promise<T> => {
  try {
    const response = await apiClient.request<T>({
      url: path,
      method,
      data,
      headers: accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
          }
        : undefined,
    });

    return response.data;
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
};

const normalizeUser = (raw: Partial<UserData>): UserData => ({
  email: raw.email ?? '',
  role: raw.role ?? '',
  status: raw.status ?? '',
  user_id: raw.user_id ?? '',
  access_token: raw.access_token ?? '',
  refresh_token: raw.refresh_token ?? '',
  token_type: raw.token_type ?? 'Bearer',
  expires_in: raw.expires_in ?? 0,
  first_name: raw.first_name ?? '',
  last_name: raw.last_name ?? '',
  profile_image_url: raw.profile_image_url ?? null,
  is_new_user: raw.is_new_user ?? false,
  email_verified: raw.email_verified ?? false,
  last_login_at: raw.last_login_at ?? null,
  country_code: raw.country_code ?? '',
  phone_number: raw.phone_number ?? '',
});

export const AuthProvider: React.FC<{children: ReactNode}> = ({children}) => {
  const [user, setUser] = useState<UserData | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const login = async (email: string, password: string): Promise<UserData> => {
    const authResponse = await request<UserData>(
      '/api/v1/auth/signin/email',
      'POST',
      {email: email.trim().toLowerCase(), password},
    );

    const normalizedUser = normalizeUser(authResponse);
    setUser(normalizedUser);
    setIsAuthenticated(true);
    return normalizedUser;
  };

  const loginWithGoogle = async (): Promise<UserData> => {
    throw new Error('Google sign-in is temporarily disabled.');
  };

  const verifyEmail = async (userId?: string): Promise<void> => {
    const currentUser = user;
    const targetUserId = userId || currentUser?.user_id;

    if (!currentUser?.access_token || !targetUserId) {
      throw new Error('Missing auth data required for email verification.');
    }

    await request<void>(
      `/api/v1/auth/verify-email/${targetUserId}`,
      'POST',
      undefined,
      currentUser.access_token,
    );

    const profile = await request<Partial<UserData>>(
      '/api/v1/auth/me',
      'GET',
      undefined,
      currentUser.access_token,
    );

    setUser(normalizeUser({...currentUser, ...profile, email_verified: true}));
  };

  const signup = async (data: SignupData): Promise<UserData> => {
    const signupPayload: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      countryCode?: string;
      phoneNumber?: number;
    } = {
      email: data.email.trim().toLowerCase(),
      password: data.password,
      firstName: data.first_name.trim(),
      lastName: data.last_name.trim(),
    };

    if (data.country_code?.trim()) {
      signupPayload.countryCode = data.country_code.trim();
    }

    if (data.phone_number?.trim()) {
      signupPayload.phoneNumber = Number(data.phone_number.trim());
    }

    const authResponse = await request<UserData>(
      '/api/v1/auth/signup/email',
      'POST',
      signupPayload,
    );

    await request<void>(
      `/api/v1/auth/verify-email/${authResponse.user_id}`,
      'POST',
      undefined,
      authResponse.access_token,
    );

    const profile = await request<Partial<UserData>>(
      '/api/v1/auth/me',
      'GET',
      undefined,
      authResponse.access_token,
    );

    const normalizedUser = normalizeUser({
      ...authResponse,
      ...profile,
      email_verified: true,
    });
    setUser(normalizedUser);
    setIsAuthenticated(true);
    return normalizedUser;
  };

  const logout = async (): Promise<void> => {
    if (user?.access_token) {
      try {
        await request<void>(
          '/api/v1/auth/logout',
          'POST',
          undefined,
          user.access_token,
        );
      } catch {
        // Logout should always clear local session even if remote call fails.
      }
    }

    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        login,
        loginWithGoogle,
        signup,
        verifyEmail,
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
