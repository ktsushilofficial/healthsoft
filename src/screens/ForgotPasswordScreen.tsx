// src/screens/ForgotPasswordScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';

interface ForgotPasswordScreenProps {
  navigation: any;
}

const ForgotPasswordScreen: React.FC<ForgotPasswordScreenProps> = ({ navigation }) => {
  const [email, setEmail] = useState('');

  const { forgotPassword } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const getErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }
    return fallback;
  };

  const handleSendResetLink = async () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email address');
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
      await forgotPassword(email);
      Alert.alert(
        'Success',
        'If an account exists with this email, you will receive a password reset link shortly.',
        [
          {
            text: 'Back to Login',
            onPress: () => navigation.goBack(),
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', getErrorMessage(error, 'Failed to send reset link.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToLogin = () => {
    navigation.goBack();
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
            <Icon name="medical" size={60} color="#FF9500" />
            <Text style={styles.title}>Healthsoft</Text>
            <Text style={styles.subtitle}>
              Care for your loved ones, anytime, anywhere
            </Text>
          </View>

          {/* Forgot Password Form */}
          <View style={styles.formContainer}>
            <Text style={styles.titleText}>Forgot Password?</Text>
            <Text style={styles.subtitleText}>
              Don't worry, we'll help you get back into your account
            </Text>

            {/* Instructions */}
            <View style={styles.instructionContainer}>
              <Text style={styles.instructionText}>
                Enter your email address to receive a password reset link.
              </Text>

            </View>

            {/* Email Input (for reference) */}
            <View style={styles.inputContainer}>
              <Icon
                name="mail-outline"
                size={20}
                color="#8E8E93"
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Your email address (for reference)"
                placeholderTextColor="#8E8E93"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Support Contact Info */}
            <View style={styles.supportContainer}>
              <Text style={styles.supportTitle}>Contact Support:</Text>
              <View style={styles.supportItem}>
                <Icon name="mail-outline" size={18} color="#FF9500" />
                <Text style={styles.supportText}>support@healthsoftcare.in</Text>
              </View>
              <View style={styles.supportItem}>
                <Icon name="call-outline" size={18} color="#FF9500" />
                <Text style={styles.supportText}>+91-XXX-XXX-XXXX</Text>
              </View>
            </View>

            {/* Action Buttons */}
            <TouchableOpacity
              style={[styles.resetButton, isLoading && styles.buttonDisabled]}
              onPress={handleSendResetLink}
              disabled={isLoading}>
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.resetButtonText}>Send Reset Link</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backButton}
              onPress={handleBackToLogin}>
              <Text style={styles.backButtonText}>Back to Login</Text>
            </TouchableOpacity>

            {/* Additional Help */}
            <View style={styles.helpContainer}>
              <Text style={styles.helpText}>
                For security reasons, password reset requires identity verification.
              </Text>
              <Text style={styles.helpText}>
                Our support team is available 24/7 to assist you.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    backgroundColor: '#F8F8F8',
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
  titleText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 8,
  },
  subtitleText: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 24,
  },
  instructionContainer: {
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#FFB74D',
  },
  instructionText: {
    fontSize: 14,
    color: '#E65100',
    lineHeight: 20,
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#E5E5E5',
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
  supportContainer: {
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  supportTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 12,
  },
  supportItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  supportText: {
    fontSize: 14,
    color: '#FF9500',
    marginLeft: 12,
    fontWeight: '600',
  },
  resetButton: {
    backgroundColor: '#FF9500',
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
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
  resetButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    backgroundColor: '#FFFFFF',
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginBottom: 24,
  },
  backButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
  },
  helpContainer: {
    backgroundColor: '#F0F0F0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 32,
  },
  helpText: {
    fontSize: 12,
    color: '#666666',
    lineHeight: 18,
    textAlign: 'center',
  },
});

export default ForgotPasswordScreen;