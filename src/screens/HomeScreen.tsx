// src/screens/HomeScreen.tsx
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Image,
  ImageBackground,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

const HomeScreen = () => {
  const heroImage = {
    uri: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
  };
  const weatherImage = {
    uri: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=600&q=80',
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Icon name="fitness" size={24} color="#FF9500" />
            <Text style={styles.logoText}>Healthsoft</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.dots}>
              <View style={styles.dot} />
              <View style={[styles.dot, styles.dotActive]} />
              <View style={styles.dot} />
              <View style={styles.dot} />
            </View>
            <Image
              source={{
                uri: 'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=200&q=80',
              }}
              style={styles.avatar}
            />
          </View>
        </View>

        {/* Greeting Card */}
        <ImageBackground
          source={heroImage}
          style={styles.greetingCard}
          imageStyle={styles.greetingImage}
        >
          <View style={styles.greetingOverlay}>
            <Text style={styles.greetingTitle}>Good Morning</Text>
            <Text style={styles.greetingName}>Mrs. Rao!</Text>
            <Text style={styles.greetingSubtitle}>
              Have a wonderful Thursday!
            </Text>
            <Text style={styles.greetingMessage}>
              Make today a great one and remember,{'\n'}you&apos;re loved and
              cherished.
            </Text>
          </View>
          <View style={styles.sunIcon}>
            <Icon name="sunny" size={42} color="#F4C24D" />
          </View>
        </ImageBackground>

        {/* Weather Card */}
        <View style={styles.weatherCard}>
          <View style={styles.weatherLeft}>
            <View style={styles.weatherHeader}>
              <Icon name="sunny" size={18} color="#FF9500" />
              <Text style={styles.weatherLocation}>Today in Chennai</Text>
            </View>
            <View style={styles.weatherContent}>
              <Text style={styles.temperature}>31°</Text>
              <Text style={styles.weatherDesc}>Mostly Sunny</Text>
            </View>
            <Text style={styles.weatherRange}>High: 34° | Low: 26°</Text>
          </View>
          <Image source={weatherImage} style={styles.weatherImage} />
        </View>

        {/* Rahukalam + Yamagandam */}
        <View style={styles.badgesRow}>
          <View style={[styles.badgeCard, styles.badgeWarm]}>
            <View style={styles.badgeHeader}>
              <Icon name="warning" size={16} color="#D18B2E" />
              <Text style={styles.badgeTitle}>Rahukalam</Text>
            </View>
            <Text style={styles.badgeTime}>Today, 1:30 PM - 3:00 PM</Text>
          </View>
          <View style={[styles.badgeCard, styles.badgeCool]}>
            <View style={styles.badgeHeader}>
              <Icon name="remove-circle" size={16} color="#D7643C" />
              <Text style={styles.badgeTitle}>Yamagandam</Text>
            </View>
            <Text style={styles.badgeTime}>Today, 6:00 AM - 7:30 AM</Text>
          </View>
        </View>

        {/* Best Times */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Best Times for the Day</Text>
          <View style={styles.timeCard}>
            <View style={styles.timeHeaderRow}>
              <View>
                <Text style={styles.timeTitle}>Thursday, Apr 18 2024</Text>
                <Text style={styles.timeSubtitle}>
                  Chaitra 10, Jaya Samvatsara
                </Text>
              </View>
              <Icon name="chevron-forward" size={18} color="#C7C1BA" />
            </View>

            <View style={styles.timeRow}>
              <View style={[styles.timeSlot, styles.timeSlotGreen]}>
                <Text style={styles.timeSlotTitle}>Abhijit Muhurta</Text>
                <Text style={styles.timeSlotValue}>
                  Today, 11:55 AM - 12:45 PM
                </Text>
              </View>
              <View style={[styles.timeSlot, styles.timeSlotPeach]}>
                <Text style={styles.timeSlotTitle}>Amrit Kalam</Text>
                <Text style={styles.timeSlotValue}>
                  Today, 9:46 PM - 11:28 PM
                </Text>
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
    backgroundColor: '#F6F2EE',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    marginRight: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DCD6CF',
    marginHorizontal: 3,
  },
  dotActive: {
    backgroundColor: '#C9B9A7',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
    marginHorizontal: 16,
    marginBottom: 16,
    minHeight: 220,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 18,
    overflow: 'hidden',
  },
  greetingImage: {
    borderRadius: 16,
  },
  greetingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(255, 250, 242, 0.85)',
    padding: 16,
    borderRadius: 14,
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
    marginLeft: 12,
  },
  weatherCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weatherLeft: {
    flex: 1,
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
  weatherImage: {
    width: 90,
    height: 60,
    borderRadius: 12,
    marginLeft: 12,
  },
  badgesRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
  },
  badgeCard: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    marginHorizontal: 4,
  },
  badgeWarm: {
    backgroundColor: '#F8EEDB',
  },
  badgeCool: {
    backgroundColor: '#F6E6DE',
  },
  badgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  badgeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7D5A2E',
    marginLeft: 6,
  },
  badgeTime: {
    fontSize: 12,
    color: '#7A6B60',
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
  timeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  timeSlot: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    marginHorizontal: 4,
  },
  timeSlotGreen: {
    backgroundColor: '#E9F3E5',
  },
  timeSlotPeach: {
    backgroundColor: '#F9EEE1',
  },
  timeSlotTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4E4A44',
    marginBottom: 6,
  },
  timeSlotValue: {
    fontSize: 12,
    color: '#6E655D',
  },
});

export default HomeScreen;
