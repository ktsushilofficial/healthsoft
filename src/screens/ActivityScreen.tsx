// ============================================
// src/screens/ActivityScreen.tsx
// ============================================
import React from 'react';
import {View, Text, StyleSheet, ScrollView, SafeAreaView} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

const ActivityScreen = () => {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <View style={styles.header}>
          <Icon name="arrow-back" size={24} color="#333" />
          <Text style={styles.headerTitle}>Health Activity</Text>
          <Icon name="notifications-outline" size={24} color="#333" />
        </View>

        <View style={styles.statCard}>
          <Icon name="footsteps" size={40} color="#FF9500" />
          <Text style={styles.statValue}>8,512</Text>
          <Text style={styles.statLabel}>Steps Walked</Text>
          <View style={styles.goalBadge}>
            <Text style={styles.goalText}>Goal: 10,000</Text>
          </View>
        </View>

        <View style={styles.statCard}>
          <Icon name="heart" size={40} color="#FF9500" />
          <Text style={styles.statValue}>118/78</Text>
          <Text style={styles.statUnit}>mmHg</Text>
          <Text style={styles.statLabel}>Blood Pressure</Text>
        </View>

        <View style={styles.statCard}>
          <Icon name="water" size={40} color="#FF9500" />
          <Text style={styles.statValue}>98%</Text>
          <Text style={styles.statLabel}>Blood Oxygen</Text>
        </View>

        <View style={styles.statCard}>
          <Icon name="pulse" size={40} color="#FF9500" />
          <Text style={styles.statValue}>75</Text>
          <Text style={styles.statUnit}>BPM</Text>
          <Text style={styles.statLabel}>Heart Rate</Text>
        </View>

        <View style={styles.statCard}>
          <Icon name="scale" size={40} color="#FF9500" />
          <Text style={styles.statValue}>168</Text>
          <Text style={styles.statUnit}>lb</Text>
          <Text style={styles.statLabel}>Weight</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
export default ActivityScreen;

// ============================================
// SHARED STYLES
// ============================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  unlinkButton: {
    color: '#FF9500',
    fontSize: 16,
    fontWeight: '600',
  },
  statCard: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 12,
  },
  statUnit: {
    fontSize: 16,
    color: '#666',
  },
  statLabel: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
  },
  goalBadge: {
    backgroundColor: '#FF9500',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 12,
  },
  goalText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  exploreCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  exploreContent: {
    flex: 1,
    marginLeft: 16,
  },
  exploreTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  exploreSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  deviceCard: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  deviceImage: {
    width: 100,
    height: 100,
    backgroundColor: '#FFF0E0',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  deviceName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
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
  },
  buttonContainer: {
    padding: 16,
  },
  button: {
    backgroundColor: '#FF9500',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
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
  editButton: {
    backgroundColor: '#FF9500',
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
  },
});