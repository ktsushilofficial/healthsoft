import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import PillDispenserDeviceTab from '../components/PillDispenserDeviceTab';

const PillDispenserScreen = () => {
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => navigation.goBack()}
          hitSlop={12}
        >
          <Icon name="arrow-back" size={22} color="#F28C28" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Pill Dispenser
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Keeps the focused field above the keyboard: iOS adjusts the scroll
          insets, Android relies on adjustResize from the manifest. Persisting
          taps lets Save respond on the first tap while the keyboard is open. */}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        <PillDispenserDeviceTab />
      </ScrollView>
    </SafeAreaView>
  );
};

export default PillDispenserScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F2EE',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E3DAD2',
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    flex: 1,
    marginHorizontal: 8,
    color: '#2E2A27',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 22,
  },
  content: {
    paddingTop: 16,
    paddingBottom: 48,
  },
});
