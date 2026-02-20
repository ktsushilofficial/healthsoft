// src/services/NotificationService.ts
import messaging from '@react-native-firebase/messaging';
import { Alert, Platform, PermissionsAndroid } from 'react-native';

/**
 * Request notification permissions from the user.
 * On Android 13+ this will show the system permission dialog.
 * On iOS this will show the standard notification permission alert.
 */
export async function requestNotificationPermission(): Promise<boolean> {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
        const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            console.log('[Notifications] Android Permission denied');
            return false;
        }
    }

    const authStatus = await messaging().requestPermission();
    const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (enabled) {
        console.log('[Notifications] Permission granted:', authStatus);
    } else {
        console.log('[Notifications] Permission denied');
    }

    return enabled;
}

/**
 * Get the FCM device token.
 * This token should be sent to your backend so it can target this device.
 */
export async function getFCMToken(): Promise<string | null> {
    try {
        const token = await messaging().getToken();
        console.log('[Notifications] FCM Token:', token);
        return token;
    } catch (error) {
        console.error('[Notifications] Failed to get FCM token:', error);
        return null;
    }
}

/**
 * Listen for foreground messages.
 * Returns an unsubscribe function.
 */
export function onForegroundMessage(
    callback?: (title: string, body: string) => void,
): () => void {
    return messaging().onMessage(async remoteMessage => {
        console.log('[Notifications] Foreground message:', JSON.stringify(remoteMessage));

        const title = remoteMessage.notification?.title ?? 'New Notification';
        const body = remoteMessage.notification?.body ?? '';

        if (callback) {
            callback(title, body);
        } else {
            // Default: show an alert
            Alert.alert(title, body);
        }
    });
}

/**
 * Handle notification tap when app was in background/quit state.
 * Returns an unsubscribe function.
 */
export function onNotificationOpenedApp(
    callback?: (remoteMessage: any) => void,
): () => void {
    return messaging().onNotificationOpenedApp(remoteMessage => {
        console.log('[Notifications] Notification opened app:', JSON.stringify(remoteMessage));
        if (callback) {
            callback(remoteMessage);
        }
    });
}

/**
 * Check if the app was opened from a quit state by a notification.
 */
export async function getInitialNotification(): Promise<any | null> {
    const remoteMessage = await messaging().getInitialNotification();
    if (remoteMessage) {
        console.log('[Notifications] App opened from quit state by notification:', JSON.stringify(remoteMessage));
    }
    return remoteMessage;
}

/**
 * Listen for FCM token refresh.
 * When the token changes, send the new token to your backend.
 */
export function onTokenRefresh(callback: (token: string) => void): () => void {
    return messaging().onTokenRefresh(token => {
        console.log('[Notifications] Token refreshed:', token);
        callback(token);
    });
}

/**
 * Register the background message handler.
 * IMPORTANT: This must be called outside of any React component, 
 * typically in index.js.
 */
export function setBackgroundMessageHandler(): void {
    messaging().setBackgroundMessageHandler(async remoteMessage => {
        console.log('[Notifications] Background message:', JSON.stringify(remoteMessage));
    });
}
