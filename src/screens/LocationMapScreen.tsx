import React, { useEffect, useRef, useState } from 'react';
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
import { useAuth } from '../context/AuthContext';
import { canAccessPendantTracking } from '../utils/devicePositionStream';

type LocationMapParams = {
  latitude: number;
  longitude: number;
  title?: string;
  deviceUuid?: string | null;
};

const LocationMapScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { user, subscribeToDevicePosition } = useAuth();
  const {
    latitude,
    longitude,
    title = 'Last position',
    deviceUuid,
  } = route.params as LocationMapParams;
  const mapRef = useRef<MapView>(null);
  const [coordinate, setCoordinate] = useState({ latitude, longitude });
  const [streamState, setStreamState] = useState<
    'static' | 'connecting' | 'live' | 'reconnecting'
  >('static');
  const [streamMessage, setStreamMessage] = useState<string | null>(null);
  const providerName = Platform.OS === 'ios' ? 'Apple Maps' : 'Google Maps';
  const canTrack = canAccessPendantTracking(user?.role);

  useEffect(() => {
    setCoordinate({ latitude, longitude });
  }, [latitude, longitude]);

  useEffect(() => {
    const normalizedUuid =
      typeof deviceUuid === 'string' ? deviceUuid.trim() : '';
    if (!canTrack || !normalizedUuid) {
      setStreamState('static');
      setStreamMessage(null);
      return;
    }

    setStreamState('connecting');
    setStreamMessage('Connecting to live pendant location…');
    return subscribeToDevicePosition(
      normalizedUuid,
      position => {
        const nextCoordinate = {
          latitude: position.latitude,
          longitude: position.longitude,
        };
        setCoordinate(nextCoordinate);
        setStreamState('live');
        setStreamMessage('Live pendant position');
        mapRef.current?.animateToRegion(
          {
            ...nextCoordinate,
            latitudeDelta: 0.012,
            longitudeDelta: 0.012,
          },
          500,
        );
      },
      message => {
        setStreamState('reconnecting');
        setStreamMessage(message);
      },
    );
  }, [canTrack, deviceUuid, subscribeToDevicePosition]);

  const headerStatus =
    streamState === 'live'
      ? `Live · ${providerName}`
      : streamState === 'connecting'
        ? `Connecting · ${providerName}`
        : streamState === 'reconnecting'
          ? `Reconnecting · ${providerName}`
          : providerName;

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
          <Text style={styles.headerSubtitle}>{headerStatus}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
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
            <View style={styles.coordinateTitleRow}>
              <View
                style={[
                  styles.streamDot,
                  streamState === 'live'
                    ? styles.streamDotLive
                    : streamState === 'connecting' ||
                        streamState === 'reconnecting'
                      ? styles.streamDotConnecting
                      : null,
                ]}
              />
              <Text style={styles.coordinateTitle}>
                {streamState === 'live'
                  ? 'Live location coordinates'
                  : 'Location coordinates'}
              </Text>
            </View>
            <Text selectable style={styles.coordinateValue}>
              {coordinate.latitude.toFixed(6)},{' '}
              {coordinate.longitude.toFixed(6)}
            </Text>
            {streamMessage ? (
              <Text numberOfLines={2} style={styles.streamMessage}>
                {streamMessage}
              </Text>
            ) : null}
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
  coordinateTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  streamDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
    backgroundColor: '#A8A29E',
  },
  streamDotLive: {
    backgroundColor: '#16A34A',
  },
  streamDotConnecting: {
    backgroundColor: '#F59E0B',
  },
  coordinateValue: {
    marginTop: 3,
    color: '#2F2B27',
    fontSize: 14,
    fontWeight: '700',
  },
  streamMessage: {
    marginTop: 3,
    color: '#8A8178',
    fontSize: 10,
    lineHeight: 13,
  },
});
