// App.tsx
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import BottomTabNavigator from './src/navigation/BottomTabNavigator';
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import WebViewScreen from './src/screens/WebViewScreen';
import {
  requestNotificationPermission,
  getFCMToken,
  onForegroundMessage,
  onNotificationOpenedApp,
  getInitialNotification,
  onTokenRefresh,
} from './src/services/NotificationService';

const Stack = createNativeStackNavigator();

const AppNavigator = () => {
  const { isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#FF9500" />
      </View>
    );
  }

  return (
    <Stack.Navigator
      key={isAuthenticated ? 'app-stack' : 'auth-stack'}
      screenOptions={{ headerShown: false }}>
      {!isAuthenticated ? (
        // Auth Stack
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Signup" component={SignupScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        </>
      ) : (
        // Main App Stack
        <>
          <Stack.Screen name="Main" component={BottomTabNavigator} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="WebView" component={WebViewScreen} />
        </>
      )}
    </Stack.Navigator>
  );
};

function App(): React.JSX.Element {
  useEffect(() => {
    async function initNotifications() {
      const permissionGranted = await requestNotificationPermission();
      if (permissionGranted) {
        const token = await getFCMToken();
        console.log('[App] FCM Token ready:', token);
      }

      // Check if app was opened from a notification (quit state)
      const initialNotification = await getInitialNotification();
      if (initialNotification) {
        console.log('[App] Opened from notification:', initialNotification);
      }
    }

    initNotifications();

    // Listen for foreground messages
    const unsubForeground = onForegroundMessage();

    // Listen for notification taps (background state)
    const unsubOpenedApp = onNotificationOpenedApp();

    // Listen for token refresh
    const unsubTokenRefresh = onTokenRefresh(newToken => {
      console.log('[App] Token refreshed, send to backend:', newToken);
    });

    return () => {
      unsubForeground();
      unsubOpenedApp();
      unsubTokenRefresh();
    };
  }, []);

  return (
    <AuthProvider>
      <SafeAreaProvider>
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </AuthProvider>
  );
}

export default App;

const styles = StyleSheet.create({
  loaderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
});
