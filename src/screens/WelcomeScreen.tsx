import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';
import { useNavigation } from '@react-navigation/native';

import { useAuth } from '../context/AuthContext';
import heroImage from '../assets/images/grandparents-hero.jpg';

const roleLabel = (role?: string): string => {
  switch (role) {
    case 'SENIOR':
      return 'Senior';
    case 'GUARDIAN':
      return 'Guardian';
    case 'CARE_TAKER':
      return 'Caretaker';
    default:
      return 'Member';
  }
};

const WelcomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { isAuthenticated, user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const currentRole = roleLabel(user?.role);
  const bodyCopy = isAuthenticated
    ? `Continue as ${currentRole.toLowerCase()} to check alerts, monitor health, and manage care from one place.`
    : 'Smart devices that watch over your parents at home - detecting falls, managing medication, and calling for help. So distance never means helplessness.';

  const handlePrimaryAction = () => {
    if (isAuthenticated) {
      navigation.replace('Main');
      return;
    }

    navigation.navigate('Login');
  };

  const handleSecondaryAction = async () => {
    if (!isAuthenticated) {
      navigation.navigate('Login');
      return;
    }

    setIsLoggingOut(true);
    try {
      await logout();
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : 'Unable to log out right now.';
      Alert.alert('Logout failed', message);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.shell}>
          <ImageBackground source={heroImage} style={styles.hero} imageStyle={styles.heroImage}>
            <LinearGradient
              colors={[
                'rgba(8, 14, 34, 0.06)',
                'rgba(8, 14, 34, 0.18)',
                'rgba(247, 240, 230, 0.55)',
                'rgba(247, 240, 230, 1)',
              ]}
              locations={[0, 0.6, 0.86, 1]}
              style={styles.heroOverlay}
            />
          </ImageBackground>

          <View style={styles.contentCard}>
            <Text style={styles.kicker}>COMPLETE ELDERLY CARE</Text>
            <Text style={styles.titleItalic}>They raised you.</Text>
            <Text style={styles.titleBold}>Now it's your turn.</Text>
            <Text style={styles.body}>{bodyCopy}</Text>

            <TouchableOpacity
              activeOpacity={0.9}
              style={[styles.primaryButton, isLoggingOut && styles.buttonDisabled]}
              onPress={handlePrimaryAction}
              disabled={isLoggingOut}>
              <Text style={styles.primaryButtonText}>
                {isAuthenticated ? `Continue as ${currentRole}` : 'Get Started'}
              </Text>
              <Icon name="arrow-forward" size={22} color="#FFFFFF" style={styles.primaryButtonIcon} />
            </TouchableOpacity>

            {isAuthenticated ? (
              <View style={styles.secondaryButtonWrap}>
                <Text style={styles.secondaryPrompt}>Continue as {currentRole}</Text>
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={[
                    styles.secondaryButton,
                    styles.secondaryButtonAuthenticated,
                    isLoggingOut && styles.buttonDisabled,
                  ]}
                  onPress={handleSecondaryAction}
                  disabled={isLoggingOut}>
                  {isLoggingOut ? (
                    <ActivityIndicator color="#101B36" />
                  ) : (
                    <Text style={styles.secondaryButtonText}>Logout</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.secondaryButton}
                onPress={handleSecondaryAction}
                disabled={isLoggingOut}>
                <Text style={styles.secondaryButtonText}>I already have an account</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#081022',
  },
  scrollContent: {
    flexGrow: 1,
    backgroundColor: '#F7F0E6',
  },
  shell: {
    flex: 1,
    backgroundColor: '#F7F0E6',
  },
  hero: {
    height: 455,
    overflow: 'hidden',
  },
  heroImage: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  kicker: {
    color: '#F2A32A',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 4.2,
    marginBottom: 14,
  },
  titleItalic: {
    color: '#D8860F',
    fontSize: 44,
    lineHeight: 48,
    marginBottom: 8,
    fontWeight: '700',
    fontStyle: 'italic',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }) ?? undefined,
  },
  titleBold: {
    color: '#101B36',
    fontSize: 40,
    lineHeight: 42,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  contentCard: {
    marginTop: -42,
    backgroundColor: '#F7F0E6',
    borderTopLeftRadius: 42,
    borderTopRightRadius: 42,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 36,
  },
  body: {
    color: '#6C7486',
    fontSize: 18,
    lineHeight: 28,
    marginBottom: 28,
    fontWeight: '500',
  },
  primaryButton: {
    minHeight: 62,
    borderRadius: 20,
    backgroundColor: '#F39B1D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F39B1D',
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  primaryButtonIcon: {
    marginLeft: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 58,
    borderRadius: 18,
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderWidth: 1,
    borderColor: '#E0D8CA',
  },
  secondaryButtonAuthenticated: {
    backgroundColor: '#FFF8EE',
    borderColor: '#D5C9B8',
  },
  secondaryButtonWrap: {
    marginTop: 2,
  },
  secondaryPrompt: {
    marginTop: 18,
    marginBottom: 4,
    textAlign: 'center',
    color: '#101B36',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButtonText: {
    color: '#101B36',
    fontSize: 16,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});

export default WelcomeScreen;
