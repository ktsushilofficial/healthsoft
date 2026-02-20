#!/usr/bin/env node

/**
 * Authentication Flow Test Script
 * This script tests the key authentication flows to ensure they work correctly
 */

const axios = require('axios');

const API_BASE_URL = 'http://seniorcare.healthsoftcare.in';

// Test configuration
const testConfig = {
  validUser: {
    firstName: 'Test',
    lastName: 'User',
    email: 'test.user@example.com',
    password: 'TestPassword123!',
    countryCode: '+91',
    phoneNumber: '9876543210',
    role: 'CARE_TAKER'
  },
  phoneLogin: {
    phoneNumber: '9876543210',
    countryCode: '+91',
    password: 'TestPassword123!'
  }
};

// API endpoints
const endpoints = {
  signup: '/api/v1/auth/signup/email',
  loginEmail: '/api/v1/auth/signin/email',
  loginPhone: '/api/v1/auth/signin/phone',
  refresh: '/api/v1/auth/refresh',
  me: '/profile',
  updateProfile: '/api/v1/users/update-profile',
  verifyEmail: (userId) => `/api/v1/auth/verify-email/${userId}`,
  logout: '/api/v1/auth/logout'
};

// Test functions
async function testSignup() {
  console.log('🧪 Testing User Registration...');

  try {
    const response = await axios.post(
      API_BASE_URL + endpoints.signup,
      {
        firstName: testConfig.validUser.firstName,
        lastName: testConfig.validUser.lastName,
        email: testConfig.validUser.email,
        password: testConfig.validUser.password,
        countryCode: testConfig.validUser.countryCode,
        phoneNumber: testConfig.validUser.phoneNumber,
        role: testConfig.validUser.role
      }
    );

    console.log('✅ Registration successful!');
    console.log('User ID:', response.data.user_id);
    console.log('Email:', response.data.email);
    console.log('Role:', response.data.role);
    console.log('Phone:', response.data.phone_number);

    return response.data;
  } catch (error) {
    console.log('❌ Registration failed:', error.response?.data || error.message);
    return null;
  }
}

async function testEmailLogin(user) {
  console.log('\n📧 Testing Email Login...');

  try {
    const response = await axios.post(
      API_BASE_URL + endpoints.loginEmail,
      {
        email: user.email,
        password: testConfig.validUser.password
      }
    );

    console.log('✅ Email login successful!');
    console.log('User ID:', response.data.user_id);
    console.log('Email:', response.data.email);
    console.log('Role:', response.data.role);

    return response.data;
  } catch (error) {
    console.log('❌ Email login failed:', error.response?.data || error.message);
    return null;
  }
}

async function testPhoneLogin() {
  console.log('\n📱 Testing Phone Number Login...');

  try {
    const response = await axios.post(
      API_BASE_URL + endpoints.loginPhone,
      {
        phoneNumber: testConfig.phoneLogin.phoneNumber,
        countryCode: testConfig.phoneLogin.countryCode,
        password: testConfig.phoneLogin.password
      }
    );

    console.log('✅ Phone login successful!');
    console.log('User ID:', response.data.user_id);
    console.log('Email:', response.data.email);
    console.log('Role:', response.data.role);

    return response.data;
  } catch (error) {
    console.log('❌ Phone login failed:', error.response?.data || error.message);
    return null;
  }
}

async function testProfileRetrieval(accessToken) {
  console.log('\n👤 Testing Profile Retrieval...');

  try {
    const response = await axios.get(API_BASE_URL + endpoints.me, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    console.log('✅ Profile retrieval successful!');
    console.log('Name:', response.data.first_name, response.data.last_name);
    console.log('Email:', response.data.email);
    console.log('Phone:', response.data.phone_number);
    console.log('Role:', response.data.role);

    return response.data;
  } catch (error) {
    console.log('❌ Profile retrieval failed:', error.response?.data || error.message);
    return null;
  }
}

async function testProfileUpdate(accessToken, userId) {
  console.log('\n✏️ Testing Profile Update...');

  try {
    const response = await axios.post(
      API_BASE_URL + endpoints.updateProfile,
      {
        userId: userId,
        firstName: 'UpdatedName',
        lastName: 'UpdatedLastName',
        countryCode: '+1',
        phoneNumber: '1234567890'
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    console.log('✅ Profile update successful!');
    console.log('Response:', response.data);

    return true;
  } catch (error) {
    console.log('❌ Profile update failed:', error.response?.data || error.message);
    return false;
  }
}

async function testEmailVerification(userId) {
  console.log('\n✅ Testing Email Verification...');

  try {
    const response = await axios.post(API_BASE_URL + endpoints.verifyEmail(userId));

    console.log('✅ Email verification successful!');
    console.log('Status:', response.status);

    return true;
  } catch (error) {
    console.log('❌ Email verification failed:', error.response?.data || error.message);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting SeniorCare Authentication Tests\n');
  console.log('==========================================');

  // Test 1: User Registration
  const user = await testSignup();
  if (!user) {
    console.log('\n❌ Cannot proceed - registration failed');
    return;
  }

  // Test 2: Email Login
  const emailLoginResult = await testEmailLogin(user);
  if (!emailLoginResult) {
    console.log('\n❌ Cannot proceed - email login failed');
    return;
  }

  // Test 3: Profile Retrieval
  const profile = await testProfileRetrieval(emailLoginResult.access_token);
  if (!profile) {
    console.log('\n❌ Cannot proceed - profile retrieval failed');
    return;
  }

  // Test 4: Profile Update
  const updateSuccess = await testProfileUpdate(emailLoginResult.access_token, user.user_id);
  if (!updateSuccess) {
    console.log('\n⚠️ Profile update failed but continuing...');
  }

  // Test 5: Email Verification
  const verificationSuccess = await testEmailVerification(user.user_id);
  if (!verificationSuccess) {
    console.log('\n⚠️ Email verification failed but continuing...');
  }

  // Test 6: Phone Login
  const phoneLoginResult = await testPhoneLogin();
  if (!phoneLoginResult) {
    console.log('\n⚠️ Phone login failed but continuing...');
  }

  console.log('\n==========================================');
  console.log('🎉 Authentication Tests Completed!');
  console.log('\nSummary:');
  console.log('✅ User Registration');
  console.log('✅ Email Login');
  console.log('✅ Profile Retrieval');
  console.log(updateSuccess ? '✅ Profile Update' : '⚠️ Profile Update Failed');
  console.log(verificationSuccess ? '✅ Email Verification' : '⚠️ Email Verification Failed');
  console.log(phoneLoginResult ? '✅ Phone Login' : '⚠️ Phone Login Failed');

  console.log('\n✨ All core authentication features are working!');
}

// Run tests if this script is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests, testConfig, endpoints };