// src/utils/authTestUtils.ts
// Utility functions for testing authentication flows

export const testAuthFlows = {
  // Test data for different scenarios
  validUsers: {
    emailLogin: {
      email: 'test@example.com',
      password: 'TestPassword123!',
    },
    phoneLogin: {
      phoneNumber: '9876543210',
      countryCode: '+91',
      password: 'TestPassword123!',
    },
    seniorSignup: {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      password: 'TestPassword123!',
      countryCode: '+91',
      phoneNumber: '9876543210',
      role: 'SENIOR',
    },
    caretakerSignup: {
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane.smith@example.com',
      password: 'TestPassword123!',
      countryCode: '+91',
      phoneNumber: '9876543210',
      role: 'CARE_TAKER',
    },
  },

  // Validation test cases
  validationTests: {
    invalidEmails: [
      'invalid-email',
      '@example.com',
      'test@',
      'test..test@example.com',
      '',
    ],
    invalidPasswords: [
      '123', // Too short
      'password', // No uppercase or special chars
      'PASSWORD', // No lowercase or special chars
      'Password', // No special chars
      '', // Empty
    ],
    invalidPhoneNumbers: [
      '123', // Too short
      '1234567890123456', // Too long
      'abc123', // Contains letters
      '', // Empty
      '123-456-7890', // Contains special chars (should be cleaned)
    ],
    validPhoneNumbers: [
      '1234567', // 7 digits
      '1234567890', // 10 digits
      '123456789012345', // 15 digits
      '+1234567890', // With country code
    ],
  },

  // API endpoint verification
  apiEndpoints: {
    signup: '/api/v1/auth/signup/email',
    loginEmail: '/api/v1/auth/signin/email',
    loginPhone: '/api/v1/auth/signin/phone',
    refresh: '/api/v1/auth/refresh',
    logout: '/api/v1/auth/logout',
    verifyEmail: '/api/v1/auth/verify-email',
    me: '/api/v1/auth/me',
    updateProfile: '/api/v1/users/update-profile',
  },

  // Expected API response structures
  expectedResponses: {
    authResponse: {
      email: 'string',
      role: 'string',
      status: 'string',
      user_id: 'string',
      access_token: 'string',
      refresh_token: 'string',
      token_type: 'string',
      expires_in: 'number',
      first_name: 'string',
      last_name: 'string',
      email_verified: 'boolean',
      last_login_at: 'number',
      country_code: 'string',
      phone_number: 'string',
    },
    profileResponse: {
      email: 'string',
      role: 'string',
      status: 'string',
      user_id: 'string',
      first_name: 'string',
      last_name: 'string',
      email_verified: 'boolean',
      last_login_at: 'number',
      country_code: 'string',
      phone_number: 'string',
    },
  },

  // Test scenarios
  scenarios: {
    completeSignupFlow: async (authService: any) => {
      try {
        // 1. Test signup
        const signupResult = await authService.signup(testAuthFlows.validUsers.seniorSignup);
        
        // 2. Test email verification
        const verificationResult = await authService.verifyEmail(signupResult.user_id);
        
        // 3. Test login
        const loginResult = await authService.login(
          testAuthFlows.validUsers.seniorSignup.email,
          testAuthFlows.validUsers.seniorSignup.password
        );
        
        // 4. Test profile retrieval
        const profileResult = await authService.refreshUserProfile();
        
        return {
          success: true,
          signup: signupResult,
          verification: verificationResult,
          login: loginResult,
          profile: profileResult,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: errorMessage,
        };
      }
    },

    phoneLoginFlow: async (authService: any) => {
      try {
        // Test phone login
        const loginResult = await authService.loginWithPhone(
          testAuthFlows.validUsers.phoneLogin.phoneNumber,
          testAuthFlows.validUsers.phoneLogin.countryCode,
          testAuthFlows.validUsers.phoneLogin.password
        );
        
        // Test profile retrieval
        const profileResult = await authService.refreshUserProfile();
        
        return {
          success: true,
          login: loginResult,
          profile: profileResult,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: errorMessage,
        };
      }
    },

    profileUpdateFlow: async (authService: any) => {
      try {
        // Test profile update
        const updateResult = await authService.updateProfile({
          first_name: 'UpdatedName',
          last_name: 'UpdatedLastName',
          country_code: '+1',
          phone_number: '1234567890',
        });
        
        // Verify update
        const profileResult = await authService.refreshUserProfile();
        
        return {
          success: true,
          update: updateResult,
          profile: profileResult,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
  },

  // Validation helpers
  validateEmail: (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  validatePassword: (password: string): boolean => {
    return password.length >= 8;
  },

  validatePhoneNumber: (phoneNumber: string): boolean => {
    const phoneRegex = /^\d{7,15}$/;
    return phoneRegex.test(phoneNumber.replace(/[^\d]/g, ''));
  },

  validateRole: (role: string): boolean => {
    return ['SENIOR', 'CARE_TAKER'].includes(role);
  },

  // Error message helpers
  getValidationMessage: (field: string, value: string): string => {
    switch (field) {
      case 'email':
        return testAuthFlows.validateEmail(value) 
          ? 'Valid email' 
          : 'Please enter a valid email address';
      
      case 'password':
        return testAuthFlows.validatePassword(value)
          ? 'Valid password'
          : 'Password must be at least 8 characters long';
      
      case 'phoneNumber':
        return testAuthFlows.validatePhoneNumber(value)
          ? 'Valid phone number'
          : 'Please enter a valid phone number (7-15 digits)';
      
      case 'role':
        return testAuthFlows.validateRole(value)
          ? 'Valid role'
          : 'Please select a valid role';
      
      default:
        return 'Field validation';
    }
  },
};

export default testAuthFlows;