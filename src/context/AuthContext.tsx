// src/context/AuthContext.tsx
import React, {createContext, useState, useContext, ReactNode} from 'react';

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
  is_new_user: boolean;
  email_verified: boolean;
  last_login_at: string | null;
  country_code: string;
  phone_number: string;
}

interface AuthContextType {
  user: UserData | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<UserData>;
  loginWithGoogle: () => Promise<UserData>;
  signup: (data: SignupData) => Promise<UserData>;
  logout: () => void;
}

interface SignupData {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  country_code: string;
  phone_number: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{children: ReactNode}> = ({children}) => {
  const [user, setUser] = useState<UserData | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const login = async (email: string, password: string): Promise<UserData> => {
    // Simulate API call delay
    await new Promise<void>(resolve => setTimeout(resolve, 1000));

    // Mock successful login response
    const mockUser: UserData = {
      email: email,
      role: 'CARE_TAKER',
      status: 'ACTIVE',
      user_id: `${Date.now()}-user-id`,
      access_token: 'mock_access_token_' + Date.now(),
      refresh_token: 'mock_refresh_token_' + Date.now(),
      token_type: 'Bearer',
      expires_in: 2592000000,
      first_name: 'John',
      last_name: 'Doe',
      is_new_user: false,
      email_verified: true,
      last_login_at: new Date().toISOString(),
      country_code: '+91',
      phone_number: '9999999999',
    };

    setUser(mockUser);
    setIsAuthenticated(true);
    return mockUser;
  };

  const loginWithGoogle = async (): Promise<UserData> => {
    // Simulate API call delay
    await new Promise<void>(resolve => setTimeout(resolve, 1500));

    // Mock Google login response
    const mockUser: UserData = {
      email: 'googleuser@gmail.com',
      role: 'CARE_TAKER',
      status: 'ACTIVE',
      user_id: `${Date.now()}-google-user-id`,
      access_token: 'mock_google_access_token_' + Date.now(),
      refresh_token: 'mock_google_refresh_token_' + Date.now(),
      token_type: 'Bearer',
      expires_in: 2592000000,
      first_name: 'Google',
      last_name: 'User',
      is_new_user: true,
      email_verified: true,
      last_login_at: new Date().toISOString(),
      country_code: '+91',
      phone_number: '8888888888',
    };

    setUser(mockUser);
    setIsAuthenticated(true);
    return mockUser;
  };

  const signup = async (data: SignupData): Promise<UserData> => {
    // Simulate API call delay
    await new Promise<void>(resolve => setTimeout(resolve, 1200));

    // Mock successful signup response
    const mockUser: UserData = {
      email: data.email,
      role: 'CARE_TAKER',
      status: 'ACTIVE',
      user_id: `${Date.now()}-new-user-id`,
      access_token: 'mock_access_token_' + Date.now(),
      refresh_token: 'mock_refresh_token_' + Date.now(),
      token_type: 'Bearer',
      expires_in: 2592000000,
      first_name: data.first_name,
      last_name: data.last_name,
      is_new_user: true,
      email_verified: false,
      last_login_at: null,
      country_code: data.country_code,
      phone_number: data.phone_number,
    };

    setUser(mockUser);
    setIsAuthenticated(true);
    return mockUser;
  };

  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider
      value={{user, isAuthenticated, login, loginWithGoogle, signup, logout}}>
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