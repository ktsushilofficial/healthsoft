// src/screens/AccountScreen.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  PermissionsAndroid,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';

const safeValue = (value?: string | number | null): string => {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.toLowerCase() === 'null') {
    return '-';
  }
  return normalized;
};

const formatRole = (role?: string): string => {
  const value = safeValue(role);
  if (value === '-') {
    return value;
  }
  return value
    .toLowerCase()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const formatLastLogin = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const numeric =
    typeof value === 'number'
      ? value
      : Number.isNaN(Number(value))
        ? null
        : Number(value);

  const date = numeric !== null ? new Date(numeric) : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString();
};

const normalizeCountryCode = (value: string): string => {
  const digits = value.replace(/[^\d]/g, '').slice(0, 4);
  return digits ? `+${digits}` : '';
};

const normalizePhoneNumber = (value: string): string =>
  value.replace(/[^\d]/g, '').slice(0, 15);

type BluetoothPermissionState =
  | 'checking'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'unavailable';

const getBluetoothPermissions = () =>
  Number(Platform.Version) >= 31
    ? ([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ] as const)
    : ([PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] as const);

const resolveBluetoothPermissionLabel = (state: BluetoothPermissionState): string => {
  switch (state) {
    case 'granted':
      return 'Permission granted';
    case 'blocked':
      return 'Permission blocked';
    case 'denied':
      return 'Permission not granted';
    case 'checking':
      return 'Checking permission...';
    default:
      return 'Not required on this device';
  }
};

const AccountScreen = () => {
  const navigation = useNavigation<any>();
  const { user, refreshUserProfile, updateProfile, logout, authMethod } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isRequestingBluetoothPermission, setIsRequestingBluetoothPermission] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bluetoothPermissionState, setBluetoothPermissionState] =
    useState<BluetoothPermissionState>('checking');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    countryCode: '',
    phoneNumber: '',
  });
  useEffect(() => {
    if (isEditing) {
      return;
    }

    setForm({
      firstName: user?.first_name ?? '',
      lastName: user?.last_name ?? '',
      countryCode:
        safeValue(user?.country_code) === '-' ? '' : String(user?.country_code),
      phoneNumber:
        safeValue(user?.phone_number) === '-' ? '' : String(user?.phone_number),
    });
  }, [user, isEditing]);

  const loadProfile = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setLoadError(null);
    console.log('--- FETCHING PROFILE ---');
    console.log('Current Refresh Token:', user?.refresh_token);
    try {
      await refreshUserProfile();
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Unable to load user profile.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshBluetoothPermissionState = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setBluetoothPermissionState('unavailable');
      return;
    }

    try {
      const statuses = await Promise.all(
        getBluetoothPermissions().map(permission => PermissionsAndroid.check(permission)),
      );
      setBluetoothPermissionState(statuses.every(Boolean) ? 'granted' : 'denied');
    } catch {
      setBluetoothPermissionState('denied');
    }
  }, []);

  const handleBluetoothPermissionPress = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setBluetoothPermissionState('unavailable');
      return;
    }

    if (bluetoothPermissionState === 'blocked') {
      await Linking.openSettings();
      return;
    }

    setIsRequestingBluetoothPermission(true);
    try {
      const result = await PermissionsAndroid.requestMultiple(getBluetoothPermissions() as any);
      const values = Object.values(result);
      const allGranted = values.every(value => value === PermissionsAndroid.RESULTS.GRANTED);
      const blocked = values.some(value => value === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);

      if (allGranted) {
        setBluetoothPermissionState('granted');
        Alert.alert('Bluetooth Permission', 'Bluetooth permission granted.');
      } else if (blocked) {
        setBluetoothPermissionState('blocked');
        Alert.alert(
          'Bluetooth Permission',
          'Bluetooth permission is blocked. Please enable it from app settings.',
        );
      } else {
        setBluetoothPermissionState('denied');
        Alert.alert('Bluetooth Permission', 'Bluetooth permission was not granted.');
      }
    } catch {
      setBluetoothPermissionState('denied');
      Alert.alert('Bluetooth Permission', 'Unable to request Bluetooth permission right now.');
    } finally {
      setIsRequestingBluetoothPermission(false);
    }
  }, [bluetoothPermissionState]);


  const handleSaveProfile = useCallback(async () => {
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const countryCode = normalizeCountryCode(form.countryCode);
    const phoneNumber = normalizePhoneNumber(form.phoneNumber);

    if (!firstName || !lastName) {
      Alert.alert('Error', 'First name and last name are required.');
      return;
    }

    if (phoneNumber && (phoneNumber.length < 7 || phoneNumber.length > 15)) {
      Alert.alert('Error', 'Phone number must be between 7 and 15 digits.');
      return;
    }

    // Check if any changes were made
    const hasChanges =
      firstName !== (user?.first_name ?? '') ||
      lastName !== (user?.last_name ?? '') ||
      countryCode !== (user?.country_code ?? '') ||
      phoneNumber !== (user?.phone_number ?? '');

    if (!hasChanges) {
      Alert.alert('No Changes', 'No changes were made to your profile.');
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile({
        first_name: firstName,
        last_name: lastName,
        country_code: countryCode,
        phone_number: phoneNumber,
      });
      setForm(prev => ({
        ...prev,
        firstName,
        lastName,
        countryCode,
        phoneNumber,
      }));
      setIsEditing(false);
      Alert.alert('Success', 'Profile updated successfully.');
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to update profile.';
      Alert.alert('Error', message);
    } finally {
      setIsSaving(false);
    }
  }, [form, updateProfile, user]);

  const handleCancelEdit = useCallback(() => {
    setForm({
      firstName: user?.first_name ?? '',
      lastName: user?.last_name ?? '',
      countryCode:
        safeValue(user?.country_code) === '-' ? '' : String(user?.country_code),
      phoneNumber:
        safeValue(user?.phone_number) === '-' ? '' : String(user?.phone_number),
    });
    setIsEditing(false);
  }, [user]);

  // Load profile once on mount
  useEffect(() => {
    loadProfile().catch(() => {
      // Errors are already handled in loadProfile.
    });
    refreshBluetoothPermissionState().catch(() => {
      setBluetoothPermissionState('denied');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          setIsLoggingOut(true);
          try {
            await logout();
          } catch (error) {
            const message =
              error instanceof Error && error.message
                ? error.message
                : 'Logout failed.';
            Alert.alert('Error', message);
          } finally {
            setIsLoggingOut(false);
          }
        },
      },
    ]);
  }, [logout]);

  const nameParts = [safeValue(user?.first_name), safeValue(user?.last_name)].filter(
    part => part !== '-',
  );
  const fullName = nameParts.length > 0 ? nameParts.join(' ') : '-';
  const isSeniorUser = user?.role === 'SENIOR';
  const phoneNumberVal = safeValue(user?.phone_number);
  const countryCodeVal = safeValue(user?.country_code);
  let phone = '-';
  if (phoneNumberVal !== '-') {
    const displayCc = countryCodeVal !== '-' && countryCodeVal !== '' ? countryCodeVal : '+91';
    phone = `${displayCc} ${phoneNumberVal}`;
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.navigate('Home')}>
            <Icon name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <TouchableOpacity
            onPress={() => {
              loadProfile().catch(() => {
                // Errors are already handled in loadProfile.
              });
            }}
            disabled={isLoading || isEditing || isSaving}>
            <Icon
              name="refresh"
              size={20}
              color="#FF9500"
              style={isLoading ? { opacity: 0.4 } : undefined}
            />
          </TouchableOpacity>
        </View>

        {loadError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        ) : null}

        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            <Icon name="person" size={60} color="#FF9500" />
          </View>
          <Text style={styles.profileName}>{fullName === '-' ? 'User' : fullName}</Text>
          {!isSeniorUser ? <Text style={styles.profileEmail}>{safeValue(user?.email)}</Text> : null}
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>First Name</Text>
          {isEditing ? (
            <TextInput
              style={styles.infoInput}
              value={form.firstName}
              onChangeText={text => setForm(prev => ({ ...prev, firstName: text }))}
              autoCapitalize="words"
              placeholder="First Name"
              placeholderTextColor="#9A9A9A"
            />
          ) : (
            <Text style={styles.infoValue}>{safeValue(user?.first_name)}</Text>
          )}
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Last Name</Text>
          {isEditing ? (
            <TextInput
              style={styles.infoInput}
              value={form.lastName}
              onChangeText={text => setForm(prev => ({ ...prev, lastName: text }))}
              autoCapitalize="words"
              placeholder="Last Name"
              placeholderTextColor="#9A9A9A"
            />
          ) : (
            <Text style={styles.infoValue}>{safeValue(user?.last_name)}</Text>
          )}
        </View>

        {!isSeniorUser ? (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{safeValue(user?.email)}</Text>
          </View>
        ) : null}

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Phone</Text>
          {isEditing ? (
            <View style={styles.phoneEditContainer}>
              <TextInput
                style={styles.countryCodeInput}
                value={form.countryCode}
                onChangeText={text => {
                  const normalized = normalizeCountryCode(text);
                  setForm(prev => ({ ...prev, countryCode: normalized }));
                }}
                placeholder="+91"
                placeholderTextColor="#9A9A9A"
                autoCapitalize="none"
              />
              <TextInput
                style={styles.phoneInput}
                value={form.phoneNumber}
                onChangeText={text => {
                  const normalized = normalizePhoneNumber(text);
                  setForm(prev => ({ ...prev, phoneNumber: normalized }));
                }}
                placeholder="Phone"
                placeholderTextColor="#9A9A9A"
                keyboardType="phone-pad"
              />
            </View>
          ) : (
            <Text style={styles.infoValue}>{phone}</Text>
          )}
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Role</Text>
          <Text style={styles.infoValue}>{formatRole(user?.role)}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Status</Text>
          <Text style={styles.infoValue}>{safeValue(user?.status)}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Email Verified</Text>
          <Text style={styles.infoValue}>{user?.email_verified ? 'Yes' : 'No'}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Last Login</Text>
          <Text style={styles.infoValue}>{formatLastLogin(user?.last_login_at)}</Text>
        </View>

        <View style={styles.permissionCard}>
          <View style={styles.permissionHeader}>
            <View>
              <Text style={styles.permissionTitle}>Bluetooth Permission</Text>
              <Text
                style={[
                  styles.permissionStatus,
                  bluetoothPermissionState === 'granted'
                    ? styles.permissionGranted
                    : bluetoothPermissionState === 'blocked'
                      ? styles.permissionBlocked
                      : styles.permissionDenied,
                ]}>
                {resolveBluetoothPermissionLabel(bluetoothPermissionState)}
              </Text>
            </View>
            <Icon
              name={bluetoothPermissionState === 'granted' ? 'checkmark-circle' : 'bluetooth'}
              size={22}
              color={bluetoothPermissionState === 'granted' ? '#2E7D32' : '#FF9500'}
            />
          </View>
          <Text style={styles.permissionHelpText}>
            If Bluetooth access was denied earlier, you can retry it here before scanning devices.
          </Text>
          <TouchableOpacity
            style={[
              styles.permissionButton,
              bluetoothPermissionState === 'granted' && styles.permissionButtonGranted,
              isRequestingBluetoothPermission && styles.buttonDisabled,
            ]}
            onPress={handleBluetoothPermissionPress}
            disabled={isRequestingBluetoothPermission}>
            {isRequestingBluetoothPermission ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.permissionButtonText}>
                {bluetoothPermissionState === 'granted'
                  ? 'Permission Granted'
                  : bluetoothPermissionState === 'blocked'
                    ? 'Open Settings'
                    : 'Allow Bluetooth'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {isEditing ? (
          <View style={styles.editButtonsRow}>
            <TouchableOpacity
              style={[styles.cancelButton, isSaving && styles.buttonDisabled]}
              onPress={handleCancelEdit}
              disabled={isSaving}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButton, isSaving && styles.buttonDisabled]}
              onPress={handleSaveProfile}
              disabled={isSaving}>
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.saveButtonText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.editProfileButton}
            onPress={() => setIsEditing(true)}
            disabled={isLoading || isLoggingOut}>
            <Text style={styles.editProfileButtonText}>Edit Profile</Text>
          </TouchableOpacity>
        )}

        {!isEditing && authMethod === 'email' && (
          <TouchableOpacity
            style={styles.changePasswordButton}
            onPress={() => {
              console.log('Navigating to ChangePassword');
              navigation.navigate('ChangePassword');
            }}>
            <Text style={styles.changePasswordButtonText}>Change Password</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.logoutButton, isLoggingOut && styles.buttonDisabled]}
          onPress={handleLogout}
          disabled={isLoggingOut || isSaving}>
          {isLoggingOut ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.logoutButtonText}>Logout</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default AccountScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  content: {
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FFF4E5',
    borderWidth: 1,
    borderColor: '#FFC58B',
  },
  errorText: {
    color: '#D46B08',
    fontSize: 13,
    textAlign: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  profileSection: {
    alignItems: 'center',
    padding: 24,
  },
  avatar: {
    width: 120,
    height: 120,
    backgroundColor: '#FFF0E0',
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
  },
  profileEmail: {
    marginTop: 4,
    fontSize: 14,
    color: '#666',
  },
  permissionCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
  },
  permissionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  permissionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333333',
  },
  permissionStatus: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
  },
  permissionGranted: {
    color: '#2E7D32',
  },
  permissionDenied: {
    color: '#C77700',
  },
  permissionBlocked: {
    color: '#C62828',
  },
  permissionHelpText: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    color: '#666666',
  },
  permissionButton: {
    marginTop: 14,
    backgroundColor: '#FF9500',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  permissionButtonGranted: {
    backgroundColor: '#2E7D32',
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  infoRow: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 16,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    maxWidth: '60%',
    textAlign: 'right',
  },
  infoInput: {
    minWidth: 140,
    maxWidth: '60%',
    textAlign: 'right',
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    paddingVertical: 4,
  },
  phoneEditContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '70%',
  },
  countryCodeInput: {
    width: 54,
    textAlign: 'right',
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    paddingVertical: 4,
    marginRight: 8,
  },
  phoneInput: {
    minWidth: 110,
    textAlign: 'right',
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    paddingVertical: 4,
  },
  editButtonsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 20,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    marginRight: 8,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  cancelButtonText: {
    color: '#666666',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    marginLeft: 8,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#FF9500',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  editProfileButton: {
    backgroundColor: '#FF9500',
    marginHorizontal: 16,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  editProfileButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  changePasswordButton: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FF9500',
  },
  changePasswordButtonText: {
    color: '#FF9500',
    fontSize: 16,
    fontWeight: '700',
  },
  logoutButton: {
    backgroundColor: '#D9534F',
    marginHorizontal: 16,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
