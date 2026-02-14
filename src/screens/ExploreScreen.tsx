// ============================================
// src/screens/ExploreScreen.tsx
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
export const ExploreScreen = () => {
  const navigation = useNavigation<any>();

  const links = {
    community: 'https://www.reddit.com/r/eldercare/',
    marketplace: 'https://www.amazon.com/s?k=elderly+care+products',
    discussion: 'https://www.caring.com/caregivers-forum/',
    learning: 'https://www.nia.nih.gov/health',
    religious: 'https://www.faithandcommunityresources.org/',
  };
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.navigate('Home')}>
            <Icon name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Explore</Text>
          <View style={styles.headerSpacer} />
        </View>

        <TouchableOpacity
          style={styles.exploreCard}
          onPress={() =>
            navigation.navigate('WebView', {
              url: links.community,
              title: 'Community',
            })
          }
        >
          <Icon name="people" size={32} color="#FF9500" />
          <View style={styles.exploreContent}>
            <Text style={styles.exploreTitle}>Community</Text>
            <Text style={styles.exploreSubtitle}>
              Connect with others, get support & share your journey
            </Text>
          </View>
          <Icon name="chevron-forward" size={24} color="#999" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.exploreCard}
          onPress={() =>
            navigation.navigate('WebView', {
              url: links.marketplace,
              title: 'Marketplace',
            })
          }
        >
          <Icon name="cart" size={32} color="#FF9500" />
          <View style={styles.exploreContent}>
            <Text style={styles.exploreTitle}>Marketplace</Text>
            <Text style={styles.exploreSubtitle}>
              Discover and buy health-related products
            </Text>
          </View>
          <Icon name="chevron-forward" size={24} color="#999" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.exploreCard}
          onPress={() =>
            navigation.navigate('WebView', {
              url: links.discussion,
              title: 'Discussion Board',
            })
          }
        >
          <Icon name="chatbubbles" size={32} color="#FF9500" />
          <View style={styles.exploreContent}>
            <Text style={styles.exploreTitle}>Discussion Board</Text>
            <Text style={styles.exploreSubtitle}>
              Join conversations and ask questions
            </Text>
          </View>
          <Icon name="chevron-forward" size={24} color="#999" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.exploreCard}
          onPress={() =>
            navigation.navigate('WebView', {
              url: links.learning,
              title: 'Learning',
            })
          }
        >
          <Icon name="book" size={32} color="#FF9500" />
          <View style={styles.exploreContent}>
            <Text style={styles.exploreTitle}>Learning</Text>
            <Text style={styles.exploreSubtitle}>
              Access health tips & educational articles
            </Text>
          </View>
          <Icon name="chevron-forward" size={24} color="#999" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.exploreCard}
          onPress={() =>
            navigation.navigate('WebView', {
              url: links.religious,
              title: 'Religious',
            })
          }
        >
          <Icon name="add-circle" size={32} color="#FF9500" />
          <View style={styles.exploreContent}>
            <Text style={styles.exploreTitle}>Religious</Text>
            <Text style={styles.exploreSubtitle}>
              Explore faith-based support and resources
            </Text>
          </View>
          <Icon name="chevron-forward" size={24} color="#999" />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};
export default ExploreScreen;
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
  headerSpacer: {
    width: 24,
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
