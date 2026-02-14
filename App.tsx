// // App.tsx
// import React from 'react';
// import {NavigationContainer} from '@react-navigation/native';
// import BottomTabNavigator from './src/navigation/BottomTabNavigator';

// function App(): React.JSX.Element {
//   return (
//     <NavigationContainer>
//       <BottomTabNavigator />
//     </NavigationContainer>
//   );
// }

// export default App;

// App.tsx
import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {ActivityIndicator, View, StyleSheet} from 'react-native';
import {AuthProvider, useAuth} from './src/context/AuthContext';
import BottomTabNavigator from './src/navigation/BottomTabNavigator';
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import WebViewScreen from './src/screens/WebViewScreen';

const Stack = createNativeStackNavigator();

const AppNavigator = () => {
  const {isAuthenticated, isInitializing} = useAuth();

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
      screenOptions={{headerShown: false}}>
      {!isAuthenticated ? (
        // Auth Stack
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Signup" component={SignupScreen} />
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
  return (
    <AuthProvider>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
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
