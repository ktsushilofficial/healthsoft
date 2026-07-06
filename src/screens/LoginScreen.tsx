// src/screens/LoginScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import newLogo from '../assets/images/new_logo.png';
import Icon from 'react-native-vector-icons/Ionicons';
import CountryPicker, {
  type CountryCode,
} from 'react-native-country-picker-modal';
import { useAuth } from '../context/AuthContext';

interface LoginScreenProps {
  navigation: any;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  const { login, loginWithGoogle, loginMobileSendOtp, loginMobileVerifyOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginMethod, setLoginMethod] = useState<'email' | 'phone'>('email');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [selectedCountryCode, setSelectedCountryCode] = useState<CountryCode>('US');
  const [selectedCountryName, setSelectedCountryName] = useState('United States');
  const [selectedDialCode, setSelectedDialCode] = useState('+1');

  const getErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }
    return fallback;
  };

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    try {
      await login(email, password);
      // Navigation will be handled by App.tsx based on auth state
    } catch (error) {
      Alert.alert('Error', getErrorMessage(error, 'Login failed.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOtp = async () => {
    const normalizedPhoneNumber = phoneNumber.replace(/[^\d]/g, '').trim();

    if (!normalizedPhoneNumber) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return;
    }

    setIsLoading(true);
    try {
      await loginMobileSendOtp(normalizedPhoneNumber, selectedDialCode);
      setPhoneNumber(normalizedPhoneNumber);
      setOtpSent(true);
      Alert.alert('Success', 'OTP sent to your phone number');
    } catch (error) {
      Alert.alert('Error', getErrorMessage(error, 'Failed to send OTP.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const normalizedPhoneNumber = phoneNumber.replace(/[^\d]/g, '').trim();
    const normalizedOtp = otp.trim();

    if (!normalizedOtp) {
      Alert.alert('Error', 'Please enter the OTP');
      return;
    }

    setIsLoading(true);
    try {
      await loginMobileVerifyOtp(normalizedPhoneNumber, normalizedOtp, selectedDialCode);
    } catch (error) {
      Alert.alert('Error', getErrorMessage(error, 'Login failed.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      await loginWithGoogle();
    } catch (error) {
      Alert.alert('Error', getErrorMessage(error, 'Google sign-in failed.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.header}>
            <Image source={newLogo} style={styles.logoImage} />
            <Text style={styles.subtitle}>
              Care for your loved ones, anytime, anywhere
            </Text>
          </View>

          {/* Login Form */}
          <View style={styles.formContainer}>
            <Text style={styles.welcomeText}>Welcome Back</Text>
            <Text style={styles.loginSubtext}>
              Sign in to continue monitoring your loved ones
            </Text>

            {loginMethod === 'email' ? (
              <>
                {/* Email Input */}
                <View style={styles.inputContainer}>
                  <Icon
                    name="mail-outline"
                    size={20}
                    color="#8E8E93"
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Email"
                    placeholderTextColor="#8E8E93"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                {/* Password Input */}
                <View style={styles.inputContainer}>
                  <Icon
                    name="lock-closed-outline"
                    size={20}
                    color="#8E8E93"
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#8E8E93"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="oneTimeCode"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeIcon}>
                    <Icon
                      name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                      size={20}
                      color="#8E8E93"
                    />
                  </TouchableOpacity>
                </View>

                {/* Forgot Password */}
                <TouchableOpacity
                  style={styles.forgotPassword}
                  onPress={() => navigation.navigate('ForgotPassword')}>
                  <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
                </TouchableOpacity>

                {/* Login Button */}
                <TouchableOpacity
                  style={[styles.loginButton, isLoading && styles.buttonDisabled]}
                  onPress={handleLogin}
                  disabled={isLoading}>
                  {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.loginButtonText}>Sign In</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Phone Input */}
                <View style={styles.phoneContainer}>
                  <TouchableOpacity
                    style={styles.countryCodeButton}
                    onPress={() => setShowCountryPicker(true)}
                    activeOpacity={0.85}
                    disabled={isLoading}>
                    <Text style={styles.countryCodeLabel}>Country</Text>
                    <View style={styles.countryCodeValueRow}>
                      <Text style={styles.countryCodeValue}>
                        {selectedDialCode}
                      </Text>
                      <Text style={styles.countryCodeName} numberOfLines={1}>
                        {selectedCountryName}
                      </Text>
                      <Icon
                        name="chevron-down-outline"
                        size={18}
                        color="#8E8E93"
                      />
                    </View>
                  </TouchableOpacity>
                  <View style={[styles.inputContainer, styles.phoneInputContainer]}>
                    <Icon name="call-outline" size={20} color="#8E8E93" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Phone Number"
                      placeholderTextColor="#8E8E93"
                      value={phoneNumber}
                      onChangeText={value => setPhoneNumber(value.replace(/[^\d]/g, ''))}
                      keyboardType="phone-pad"
                      autoCapitalize="none"
                      editable={!otpSent && !isLoading}
                      maxLength={15}
                    />
                  </View>
                </View>

                {otpSent && (
                  <View style={styles.inputContainer}>
                    <Icon name="key-outline" size={20} color="#8E8E93" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Enter OTP"
                      placeholderTextColor="#8E8E93"
                      value={otp}
                      onChangeText={setOtp}
                      keyboardType="number-pad"
                      autoCapitalize="none"
                    />
                  </View>
                )}

                {!otpSent ? (
                  <TouchableOpacity
                    style={[styles.loginButton, isLoading && styles.buttonDisabled]}
                    onPress={handleSendOtp}
                    disabled={isLoading}>
                    {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.loginButtonText}>Send OTP</Text>}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.loginButton, isLoading && styles.buttonDisabled]}
                    onPress={handleVerifyOtp}
                    disabled={isLoading}>
                    {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.loginButtonText}>Verify & Sign In</Text>}
                  </TouchableOpacity>
                )}
              </>
            )}

            {/* Toggle Login Method */}
            <TouchableOpacity
              style={styles.methodToggle}
              onPress={() => {
                setLoginMethod(loginMethod === 'email' ? 'phone' : 'email');
                setOtpSent(false);
                setOtp('');
                setShowCountryPicker(false);
              }}>
              <Text style={styles.methodToggleText}>
                {loginMethod === 'email' ? 'Use Phone Number instead' : 'Use Email instead'}
              </Text>
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.googleButton}
              onPress={handleGoogleLogin}
              disabled={isLoading}>
              <Icon name="logo-google" size={20} color="#FF9500" />
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </TouchableOpacity>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {loginMethod === 'phone' && (
        <CountryPicker
          countryCode={selectedCountryCode}
        visible={showCountryPicker}
        translation="common"
        withAlphaFilter={false}
        withCallingCode
        withEmoji
        withFilter
        withCloseButton
        withModal
        renderFlagButton={() => null}
        onClose={() => setShowCountryPicker(false)}
        onSelect={country => {
            setSelectedCountryCode(country.cca2);
            setSelectedCountryName(
              typeof country.name === 'string' ? country.name : country.name.common,
            );
            setSelectedDialCode(
              country.callingCode?.length > 0
                ? `+${country.callingCode[0]}`
                : '+1',
            );
            setShowCountryPicker(false);
          }}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 40,
    backgroundColor: '#FFFFFF',
  },
  logoImage: {
    width: '90%',          // enlarged ~3x and spans most of the header
    maxWidth: 500,
    height: undefined,
    aspectRatio: 2.75,
    resizeMode: 'contain',
    marginTop: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#000000',
    marginTop: 16,
  },
  subtitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  formContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 8,
  },
  loginSubtext: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 32,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  phoneContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  countryCodeButton: {
    flex: 0.95,
    minHeight: 52,
    justifyContent: 'center',
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginRight: 12,
  },
  countryCodeLabel: {
    fontSize: 12,
    color: '#8E8E93',
    marginBottom: 2,
  },
  countryCodeValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countryCodeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginRight: 8,
  },
  countryCodeName: {
    flex: 1,
    fontSize: 14,
    color: '#1F1F1F',
    marginRight: 8,
  },
  phoneInputContainer: {
    flex: 1,
    marginBottom: 0,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    height: 52,
    fontSize: 16,
    color: '#000000',
  },
  eyeIcon: {
    padding: 8,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  forgotPasswordText: {
    color: '#FF9500',
    fontSize: 14,
    fontWeight: '600',
  },
  loginButton: {
    backgroundColor: '#FF9500',
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#FF9500',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E5E5',
  },
  dividerText: {
    color: '#8E8E93',
    paddingHorizontal: 16,
    fontSize: 14,
  },
  googleButton: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginBottom: 32,
  },
  googleButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 12,
  },
  methodToggle: {
    alignSelf: 'center',
    marginBottom: 24,
  },
  methodToggleText: {
    color: '#FF9500',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default LoginScreen;
