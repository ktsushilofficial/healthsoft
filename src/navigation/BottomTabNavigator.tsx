// src/navigation/BottomTabNavigator.tsx
import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';

// Import screens (we'll create these next)
import HomeScreen from '../screens/HomeScreen';
import ActivityScreen from '../screens/ActivityScreen';
import ExploreScreen from '../screens/ExploreScreen';
import DeviceScreen from '../screens/DeviceScreen';
import AccountScreen from '../screens/AccountScreen';

const Tab = createBottomTabNavigator();

const BottomTabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={({route}) => ({
        tabBarIcon: ({focused, color, size}) => {
          let iconName: string = '';

          if (route.name === 'Home') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Activity') {
            iconName = focused ? 'flame' : 'flame-outline';
          } else if (route.name === 'Explore') {
            iconName = focused ? 'grid' : 'grid-outline';
          } else if (route.name === 'Device') {
            iconName = focused ? 'watch' : 'watch-outline';
          } else if (route.name === 'Account') {
            iconName = focused ? 'person' : 'person-outline';
          }

          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#FF9500',
        tabBarInactiveTintColor: '#8E8E93',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#E5E5E5',
          height: 88,
          paddingBottom: 34,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
        },
        headerShown: false,
      })}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Explore" component={ExploreScreen} />
      <Tab.Screen name="Device" component={DeviceScreen} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
};

export default BottomTabNavigator;