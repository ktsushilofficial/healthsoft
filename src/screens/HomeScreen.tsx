// src/screens/HomeScreen.tsx
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

const HomeScreen = () => {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Icon name="fitness" size={24} color="#FF9500" />
            <Text style={styles.logoText}>Healthsoft</Text>
          </View>
          <Icon name="notifications-outline" size={24} color="#333" />
        </View>

        {/* Greeting Card */}
        <View style={styles.greetingCard}>
          <View style={styles.greetingContent}>
            <Text style={styles.greetingTitle}>Good Morning</Text>
            <Text style={styles.greetingName}>Mrs. Rao!</Text>
            <Text style={styles.greetingSubtitle}>
              Have a wonderful Thursday!
            </Text>
            <Text style={styles.greetingMessage}>
              Make today a great one and remember,{'\n'}you're loved and
              cherished.
            </Text>
          </View>
          <View style={styles.sunIcon}>
            <Icon name="sunny" size={40} color="#FFD700" />
          </View>
        </View>

        {/* Weather Card */}
        <View style={styles.weatherCard}>
          <View style={styles.weatherHeader}>
            <Icon name="sunny" size={20} color="#FF9500" />
            <Text style={styles.weatherLocation}>Today in Chennai</Text>
          </View>
          <View style={styles.weatherContent}>
            <Text style={styles.temperature}>31°</Text>
            <Text style={styles.weatherDesc}>Mostly Sunny</Text>
          </View>
          <Text style={styles.weatherRange}>High: 34° | Low: 26°</Text>
        </View>

        {/* Health Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Health Activity</Text>
          
          <View style={styles.statsGrid}>
            {/* Steps */}
            <View style={styles.statCard}>
              <Icon name="footsteps" size={32} color="#FF9500" />
              <Text style={styles.statValue}>8,512</Text>
              <Text style={styles.statLabel}>Steps Walked</Text>
              <View style={styles.goalBadge}>
                <Text style={styles.goalText}>Goal: 10,000</Text>
              </View>
            </View>

            {/* Blood Pressure */}
            <View style={styles.statCard}>
              <Icon name="heart" size={32} color="#FF9500" />
              <Text style={styles.statValue}>118/78</Text>
              <Text style={styles.statUnit}>mmHg</Text>
              <Text style={styles.statLabel}>Blood Pressure</Text>
            </View>

            {/* Blood Oxygen */}
            <View style={styles.statCard}>
              <Icon name="water" size={32} color="#FF9500" />
              <Text style={styles.statValue}>98%</Text>
              <Text style={styles.statLabel}>Blood Oxygen</Text>
            </View>

            {/* Heart Rate */}
            <View style={styles.statCard}>
              <Icon name="pulse" size={32} color="#FF9500" />
              <Text style={styles.statValue}>75</Text>
              <Text style={styles.statUnit}>BPM</Text>
              <Text style={styles.statLabel}>Heart Rate</Text>
            </View>
          </View>
        </View>

        {/* Best Times */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Best Times for the Day</Text>
          <View style={styles.timeCard}>
            <Text style={styles.timeTitle}>Thursday, Apr 18 2024</Text>
            <Text style={styles.timeSubtitle}>Chaitra 10, Jaya Samvatsara</Text>
            
            <View style={styles.timingRow}>
              <View style={styles.timing}>
                <Icon name="alert-circle" size={20} color="#FF9500" />
                <Text style={styles.timingLabel}>Rahukalam</Text>
                <Text style={styles.timingValue}>1:30 PM - 3:00 PM</Text>
              </View>
              
              <View style={styles.timing}>
                <Icon name="close-circle" size={20} color="#FF3B30" />
                <Text style={styles.timingLabel}>Yamagandam</Text>
                <Text style={styles.timingValue}>6:00 AM - 7:30 AM</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

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
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 8,
  },
  greetingCard: {
    backgroundColor: '#FFF8E7',
    margin: 16,
    padding: 20,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  greetingContent: {
    flex: 1,
  },
  greetingTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#8B4513',
  },
  greetingName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#8B4513',
    marginBottom: 8,
  },
  greetingSubtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  greetingMessage: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  sunIcon: {
    justifyContent: 'center',
  },
  weatherCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
  },
  weatherHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  weatherLocation: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
  },
  weatherContent: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  temperature: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#FF9500',
  },
  weatherDesc: {
    fontSize: 20,
    color: '#333',
    marginLeft: 12,
  },
  weatherRange: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  section: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginHorizontal: 16,
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
  },
  statCard: {
    backgroundColor: '#FFFFFF',
    width: '46%',
    margin: 8,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  statUnit: {
    fontSize: 14,
    color: '#666',
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  goalBadge: {
    backgroundColor: '#FF9500',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 8,
  },
  goalText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  timeCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  timeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  timeSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  timingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timing: {
    flex: 1,
    alignItems: 'center',
  },
  timingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 8,
  },
  timingValue: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
});

export default HomeScreen;