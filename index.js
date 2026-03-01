/**
 * @format
 */

import { AppRegistry, Platform } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { setBackgroundMessageHandler, getFCMToken } from './src/services/NotificationService';

// Must be called outside of React component tree
setBackgroundMessageHandler();

if (Platform.OS === 'android') {
    getFCMToken().then(token => console.log('===> FCM TOKEN:', token)).catch(console.error);
}

AppRegistry.registerComponent(appName, () => App);
