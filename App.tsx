// App.tsx
import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import BottomTabNavigator from './src/navigation/BottomTabNavigator';

function App(): React.JSX.Element {
  return (
    <NavigationContainer>
      <BottomTabNavigator />
    </NavigationContainer>
  );
}

export default App;