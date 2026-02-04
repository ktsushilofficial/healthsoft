// ============================================
// src/screens/ActivityScreen.tsx
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

const ActivityScreen = () => {
  const navigation = useNavigation();
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Icon name="fitness" size={20} color="#F28C28" />
            <Text style={styles.brandText}>Healthsoft</Text>
          </View>
          <TouchableOpacity
            style={styles.bellWrap}
            onPress={() => navigation.navigate('Notifications' as never)}
          >
            <Icon name="notifications-outline" size={22} color="#4C4A48" />
            <View style={styles.badge}>
              <Text style={styles.badgeText}>1</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Health Activity</Text>

          <View style={[styles.metricCard, styles.metricSteps]}>
            <View style={styles.metricIconWrap}>
              <Icon name="footsteps" size={26} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <Text style={styles.metricValue}>8,512</Text>
              <Text style={styles.metricLabel}>Steps Walked</Text>
              <View style={styles.progressTrack}>
                <View style={styles.progressFill} />
                <View style={styles.goalChip}>
                  <Text style={styles.goalText}>Goal: 10,000</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="heart" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>118/78</Text>
                <Text style={styles.metricUnit}>mmHg</Text>
              </View>
              <Text style={styles.metricLabel}>Blood Pressure</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="water" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <Text style={styles.metricValue}>98%</Text>
              <Text style={styles.metricLabel}>Blood Oxygen</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="pulse" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>75</Text>
                <Text style={styles.metricUnit}>BPM</Text>
              </View>
              <Text style={styles.metricLabel}>Heart Rate</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="scale" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>168</Text>
                <Text style={styles.metricUnit}>lb</Text>
              </View>
              <Text style={styles.metricLabel}>Weight</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ActivityScreen;

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
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandText: {
    marginLeft: 8,
    fontSize: 18,
    fontWeight: '700',
    color: '#2E2A27',
  },
  bellWrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F28C28',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
    elevation: 2,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2E2A27',
    marginBottom: 12,
  },
  metricCard: {
    backgroundColor: '#FAF8F5',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0E7DD',
  },
  metricSteps: {
    paddingBottom: 16,
  },
  metricIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFF2E5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  metricInfo: {
    flex: 1,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2E2A27',
  },
  metricUnit: {
    fontSize: 14,
    color: '#7A726A',
    marginLeft: 6,
    marginTop: 4,
  },
  metricLabel: {
    fontSize: 14,
    color: '#7A726A',
    marginTop: 4,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  progressTrack: {
    marginTop: 10,
    height: 12,
    backgroundColor: '#F1E7DB',
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressFill: {
    height: 12,
    width: '70%',
    backgroundColor: '#F28C28',
    borderRadius: 10,
  },
  goalChip: {
    position: 'absolute',
    right: 8,
    backgroundColor: '#E27D1A',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  goalText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
