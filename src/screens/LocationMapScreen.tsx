import React from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

type LocationMapParams = {
  latitude: number;
  longitude: number;
  title?: string;
};

const LocationMapScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const {
    latitude,
    longitude,
    title = 'Last position',
  } = route.params as LocationMapParams;
  const coordinate = { latitude, longitude };
  const providerName = Platform.OS === 'ios' ? 'Apple Maps' : 'Google Maps';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => navigation.goBack()}
          style={styles.headerButton}
        >
          <Icon name="arrow-back" size={22} color="#3F3933" />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {title}
          </Text>
          <Text style={styles.headerSubtitle}>{providerName}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.mapWrap}>
        <MapView
          style={styles.map}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          initialRegion={{
            ...coordinate,
            latitudeDelta: 0.012,
            longitudeDelta: 0.012,
          }}
          loadingEnabled
          showsCompass
          showsScale
          toolbarEnabled={false}
        >
          <Marker coordinate={coordinate} title={title} pinColor="#F28C28" />
        </MapView>

        <View style={styles.coordinateCard}>
          <View style={styles.pinWrap}>
            <Icon name="location" size={20} color="#FFFFFF" />
          </View>
          <View style={styles.coordinateCopy}>
            <Text style={styles.coordinateTitle}>Location coordinates</Text>
            <Text selectable style={styles.coordinateValue}>
              {latitude.toFixed(6)}, {longitude.toFixed(6)}
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

export default LocationMapScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E3DD',
    backgroundColor: '#FFFFFF',
    zIndex: 1,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#3F3933',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    marginTop: 2,
    color: '#8A8178',
    fontSize: 11,
    fontWeight: '600',
  },
  headerSpacer: {
    width: 40,
  },
  mapWrap: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  coordinateCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 6,
  },
  pinWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#F28C28',
  },
  coordinateCopy: {
    flex: 1,
    marginLeft: 12,
  },
  coordinateTitle: {
    color: '#6F675F',
    fontSize: 12,
    fontWeight: '600',
  },
  coordinateValue: {
    marginTop: 3,
    color: '#2F2B27',
    fontSize: 14,
    fontWeight: '700',
  },
});
