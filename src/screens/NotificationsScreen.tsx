// ============================================
// src/screens/NotificationsScreen.tsx
// ============================================
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';

const notifications = [
  {
    id: '1',
    title: 'Medication Reminder',
    message: 'Lipitor 20 mg is due at 8:00 AM. Please confirm intake.',
    time: 'Just now',
    type: 'pill',
    unread: true,
  },
  {
    id: '2',
    title: 'Device Alert',
    message: 'Fall Detection Pendant battery is at 15%.',
    time: '15 min ago',
    type: 'device',
    unread: true,
  },
  {
    id: '3',
    title: 'Vital Check',
    message: 'Blood pressure reading is slightly high today (132/84).',
    time: 'Today, 9:10 AM',
    type: 'heart',
    unread: false,
  },
  {
    id: '4',
    title: 'Caregiver Note',
    message: 'Dr. Rao recommended a light walk after lunch.',
    time: 'Yesterday',
    type: 'note',
    unread: false,
  },
];

const NotificationsScreen = () => {
  const navigation = useNavigation();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Icon name="arrow-back" size={22} color="#4C4A48" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notifications</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.summaryCard}>
          <View>
            <Text style={styles.summaryTitle}>Today’s Highlights</Text>
            <Text style={styles.summarySubtitle}>2 new alerts • 4 total</Text>
          </View>
          <TouchableOpacity style={styles.clearButton}>
            <Text style={styles.clearText}>Clear All</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionLabel}>
          <Text style={styles.sectionText}>New</Text>
        </View>

        {notifications
          .filter(item => item.unread)
          .map(item => (
            <View key={item.id} style={styles.notificationCard}>
              <View style={styles.iconWrap}>
                <Icon
                  name={
                    item.type === 'pill'
                      ? 'medkit'
                      : item.type === 'device'
                      ? 'bluetooth'
                      : item.type === 'heart'
                      ? 'heart'
                      : 'chatbox-ellipses'
                  }
                  size={20}
                  color="#F28C28"
                />
              </View>
              <View style={styles.notificationInfo}>
                <View style={styles.notificationHeader}>
                  <Text style={styles.notificationTitle}>{item.title}</Text>
                  <View style={styles.unreadDot} />
                </View>
                <Text style={styles.notificationMessage}>{item.message}</Text>
                <Text style={styles.notificationTime}>{item.time}</Text>
              </View>
            </View>
          ))}

        <View style={styles.sectionLabel}>
          <Text style={styles.sectionText}>Earlier</Text>
        </View>

        {notifications
          .filter(item => !item.unread)
          .map(item => (
            <View key={item.id} style={styles.notificationCardMuted}>
              <View style={styles.iconWrapMuted}>
                <Icon
                  name={
                    item.type === 'pill'
                      ? 'medkit'
                      : item.type === 'device'
                      ? 'bluetooth'
                      : item.type === 'heart'
                      ? 'heart'
                      : 'chatbox-ellipses'
                  }
                  size={20}
                  color="#C18A5B"
                />
              </View>
              <View style={styles.notificationInfo}>
                <Text style={styles.notificationTitle}>{item.title}</Text>
                <Text style={styles.notificationMessage}>{item.message}</Text>
                <Text style={styles.notificationTime}>{item.time}</Text>
              </View>
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
};

export default NotificationsScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F2EE',
  },
  content: {
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2E2A27',
  },
  headerSpacer: {
    width: 22,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
    elevation: 2,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2E2A27',
  },
  summarySubtitle: {
    fontSize: 12,
    color: '#7A726A',
    marginTop: 4,
  },
  clearButton: {
    backgroundColor: '#F28C28',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  clearText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionLabel: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sectionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7A726A',
  },
  notificationCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#F1E8DE',
  },
  notificationCardMuted: {
    backgroundColor: '#FAF7F2',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#EFE4D7',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFF1E3',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconWrapMuted: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F3E6D8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  notificationInfo: {
    flex: 1,
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2E2A27',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F28C28',
  },
  notificationMessage: {
    fontSize: 12,
    color: '#6E655D',
    marginTop: 4,
    lineHeight: 16,
  },
  notificationTime: {
    fontSize: 11,
    color: '#A09A94',
    marginTop: 6,
  },
});
