import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import Icon from 'react-native-vector-icons/Ionicons';
import MapView, {
  Circle,
  Marker,
  Polygon,
  PROVIDER_GOOGLE,
  type LatLng,
  type MapPressEvent,
  type MarkerDragStartEndEvent,
} from 'react-native-maps';
import { orderQuadrilateralPoints } from '../utils/geofencePolygon';

export type GeofenceMapSelection =
  | { type: 'circle'; center: LatLng; radiusMeters: number }
  | { type: 'polygon'; points: LatLng[] };

type Props = {
  visible: boolean;
  type: 'circle' | 'polygon';
  initialCenter?: LatLng | null;
  initialRadiusMeters?: number;
  initialPoints?: LatLng[];
  onCancel: () => void;
  onApply: (selection: GeofenceMapSelection) => void;
};

const INDIA_CENTER: LatLng = { latitude: 20.5937, longitude: 78.9629 };
const DEFAULT_RADIUS_METERS = 100;
const MIN_RADIUS_METERS = 100;
const MAX_RADIUS_METERS = 65535;
const MAX_POLYGON_POINTS = 4;
const RADIUS_PRESETS = [100, 250, 500, 1000, 5000];

const clampRadius = (value: number) =>
  Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, Math.round(value)));

const GeofenceMapModal = ({
  visible,
  type,
  initialCenter,
  initialRadiusMeters = DEFAULT_RADIUS_METERS,
  initialPoints = [],
  onCancel,
  onApply,
}: Props) => {
  const mapRef = useRef<MapView | null>(null);
  const [center, setCenter] = useState<LatLng>(initialCenter ?? initialPoints[0] ?? INDIA_CENTER);
  const [radiusMeters, setRadiusMeters] = useState(clampRadius(initialRadiusMeters));
  const [points, setPoints] = useState<LatLng[]>(initialPoints.slice(0, MAX_POLYGON_POINTS));
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(
    Platform.OS === 'ios',
  );

  const fetchCurrentLocation = useCallback(async (showError = true) => {
    setLocating(true);
    if (Platform.OS === 'android') {
      try {
        const alreadyGranted = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        const result = alreadyGranted
          ? PermissionsAndroid.RESULTS.GRANTED
          : await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
              {
                title: 'Location access',
                message: 'Location access is used to center the geofence map on your position.',
                buttonPositive: 'Allow',
                buttonNegative: 'Not now',
              },
            );
        const granted = result === PermissionsAndroid.RESULTS.GRANTED;
        setLocationPermissionGranted(granted);
        if (!granted) {
          setLocating(false);
          if (showError) {
            Alert.alert(
              'Location permission needed',
              result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
                ? 'Allow location access for Guardians in Android settings, then try again.'
                : 'Allow location access to center the map on your position. You can still place geofence points manually.',
            );
          }
          return;
        }
      } catch {
        setLocationPermissionGranted(false);
        setLocating(false);
        if (showError) {
          Alert.alert(
            'Location unavailable',
            'Location permission could not be requested. You can still place geofence points manually.',
          );
        }
        return;
      }
    }

    Geolocation.setRNConfiguration({
      skipPermissionRequests: false,
      authorizationLevel: 'whenInUse',
      locationProvider: 'auto',
    });
    Geolocation.getCurrentPosition(
      position => {
        setLocationPermissionGranted(true);
        const coordinate = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        if (type === 'circle') {
          setCenter(coordinate);
        }
        mapRef.current?.animateToRegion({
          ...coordinate,
          latitudeDelta: 0.012,
          longitudeDelta: 0.012,
        }, 350);
        setLocating(false);
      },
      error => {
        if (error.code === 1) {
          setLocationPermissionGranted(false);
        }
        setLocating(false);
        if (showError) {
          Alert.alert(
            'Location unavailable',
            error.code === 1
              ? 'Allow location access in phone settings, then try again.'
              : 'Your current location could not be determined. Please try again.',
          );
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }, [type]);

  useEffect(() => {
    if (!visible) return;
    setCenter(initialCenter ?? initialPoints[0] ?? INDIA_CENTER);
    setRadiusMeters(clampRadius(initialRadiusMeters));
    setPoints(initialPoints.slice(0, MAX_POLYGON_POINTS));
    setSelectedPointIndex(null);
    fetchCurrentLocation(false).catch(() => {});
  }, [fetchCurrentLocation, initialCenter, initialPoints, initialRadiusMeters, visible]);

  const initialRegion = useMemo(() => {
    const focus = initialCenter ?? initialPoints[0] ?? INDIA_CENTER;
    return {
      ...focus,
      latitudeDelta: initialCenter || initialPoints.length ? 0.012 : 18,
      longitudeDelta: initialCenter || initialPoints.length ? 0.012 : 18,
    };
  }, [initialCenter, initialPoints]);

  const orderedPolygonPoints = useMemo(
    () => orderQuadrilateralPoints(points),
    [points],
  );

  const handleMapPress = (event: MapPressEvent) => {
    const coordinate = event.nativeEvent.coordinate;
    if (type === 'circle') {
      setCenter(coordinate);
      return;
    }
    setSelectedPointIndex(null);
    setPoints(current =>
      current.length >= MAX_POLYGON_POINTS ? current : [...current, coordinate],
    );
  };

  const updatePolygonPoint = (index: number, event: MarkerDragStartEndEvent) => {
    const coordinate = event.nativeEvent.coordinate;
    setPoints(current => current.map((point, pointIndex) =>
      pointIndex === index ? coordinate : point,
    ));
  };

  const removePolygonPoint = (index: number) => {
    setPoints(current => current.filter((_, pointIndex) => pointIndex !== index));
    setSelectedPointIndex(null);
  };

  const canApply = type === 'circle' || orderedPolygonPoints !== null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={onCancel}>
            <Icon name="close" size={24} color="#3F3933" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Set Geofence on Map</Text>
            <Text style={styles.subtitle}>
              {type === 'circle'
                ? 'Tap the map or drag the pin to choose the center.'
                : 'Tap to add exactly 4 corner points. Drag points to adjust.'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.applyButton, !canApply && styles.disabledButton]}
            disabled={!canApply}
            onPress={() => {
              if (type === 'circle') {
                onApply({ type, center, radiusMeters });
              } else if (orderedPolygonPoints) {
                onApply({ type, points: orderedPolygonPoints });
              }
            }}
          >
            <Text style={styles.applyButtonText}>Save</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.mapWrap}>
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={initialRegion}
            onPress={handleMapPress}
            showsCompass
            showsScale
            showsUserLocation={locationPermissionGranted}
            showsMyLocationButton={locationPermissionGranted}
            toolbarEnabled={false}
          >
            {type === 'circle' ? (
              <>
                <Marker
                  coordinate={center}
                  draggable
                  title="Geofence center"
                  pinColor="#F28C28"
                  onDragEnd={event => setCenter(event.nativeEvent.coordinate)}
                />
                <Circle
                  center={center}
                  radius={radiusMeters}
                  strokeColor="#E97812"
                  strokeWidth={2}
                  fillColor="rgba(242, 140, 40, 0.22)"
                />
              </>
            ) : (
              <>
                {orderedPolygonPoints ? (
                  <Polygon
                    coordinates={orderedPolygonPoints}
                    strokeColor="#E97812"
                    strokeWidth={2}
                    fillColor="rgba(242, 140, 40, 0.22)"
                  />
                ) : null}
                {points.map((point, index) => (
                  <Marker
                    key={`${index}-${point.latitude}-${point.longitude}`}
                    coordinate={point}
                    draggable
                    stopPropagation
                    title={`Boundary point ${index + 1} — select and remove below`}
                    pinColor={selectedPointIndex === index ? '#C84E20' : '#F28C28'}
                    onPress={() => setSelectedPointIndex(index)}
                    onDragStart={() => setSelectedPointIndex(index)}
                    onDragEnd={event => updatePolygonPoint(index, event)}
                  />
                ))}
              </>
            )}
          </MapView>

          <View style={styles.mapActions}>
            <TouchableOpacity
              style={[styles.floatingButton, locating && styles.disabledButton]}
              disabled={locating}
              onPress={() => fetchCurrentLocation(true)}
            >
              <Icon name="locate" size={20} color="#F28C28" />
              <Text style={styles.floatingButtonText}>{locating ? 'Locating…' : 'My location'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {type === 'circle' ? (
          <View style={styles.controls}>
            <View style={styles.controlHeadingRow}>
              <View>
                <Text style={styles.controlTitle}>Fence radius</Text>
                <Text style={styles.radiusValue}>{radiusMeters.toLocaleString()} meters</Text>
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepButton}
                  onPress={() => setRadiusMeters(value => clampRadius(value - 50))}
                >
                  <Icon name="remove" size={20} color="#6B4B2F" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stepButton}
                  onPress={() => setRadiusMeters(value => clampRadius(value + 50))}
                >
                  <Icon name="add" size={20} color="#6B4B2F" />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.presetRow}>
              {RADIUS_PRESETS.map(radius => (
                <TouchableOpacity
                  key={radius}
                  style={[styles.presetChip, radiusMeters === radius && styles.presetChipActive]}
                  onPress={() => setRadiusMeters(radius)}
                >
                  <Text style={[styles.presetText, radiusMeters === radius && styles.presetTextActive]}>
                    {radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.controls}>
            <View style={styles.controlHeadingRow}>
              <View>
                <Text style={styles.controlTitle}>Boundary points</Text>
                <Text style={styles.radiusValue}>{points.length}/{MAX_POLYGON_POINTS} selected</Text>
              </View>
              <View style={styles.polygonActions}>
                <TouchableOpacity
                  style={[styles.textAction, selectedPointIndex === null && styles.disabledButton]}
                  disabled={selectedPointIndex === null}
                  onPress={() => {
                    if (selectedPointIndex !== null) {
                      removePolygonPoint(selectedPointIndex);
                    }
                  }}
                >
                  <Text style={styles.textActionText}>Remove</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.textAction, points.length === 0 && styles.disabledButton]}
                  disabled={points.length === 0}
                  onPress={() => {
                    setPoints(current => current.slice(0, -1));
                    setSelectedPointIndex(null);
                  }}
                >
                  <Text style={styles.textActionText}>Undo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.textAction, points.length === 0 && styles.disabledButton]}
                  disabled={points.length === 0}
                  onPress={() => {
                    setPoints([]);
                    setSelectedPointIndex(null);
                  }}
                >
                  <Text style={styles.textActionText}>Clear</Text>
                </TouchableOpacity>
              </View>
            </View>
            {selectedPointIndex !== null ? (
              <Text style={styles.hint}>Point {selectedPointIndex + 1} selected. Tap Remove to replace it.</Text>
            ) : points.length < MAX_POLYGON_POINTS ? (
              <Text style={styles.hint}>Add {MAX_POLYGON_POINTS - points.length} more point(s) to draw the four-sided fence.</Text>
            ) : !orderedPolygonPoints ? (
              <Text style={styles.hint}>Move the markers so all four are separate outside corners.</Text>
            ) : (
              <Text style={styles.hint}>Four-sided boundary ready. Drag, undo, or clear to adjust.</Text>
            )}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF9F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5D8C8',
  },
  headerButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  title: { fontSize: 17, fontWeight: '700', color: '#3F3933' },
  subtitle: { marginTop: 2, fontSize: 11, lineHeight: 15, color: '#7A726A' },
  applyButton: {
    backgroundColor: '#F28C28',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  applyButtonText: { color: '#FFF', fontWeight: '700' },
  disabledButton: { opacity: 0.4 },
  mapWrap: { flex: 1, position: 'relative' },
  map: { ...StyleSheet.absoluteFillObject },
  mapActions: { position: 'absolute', top: 12, right: 12 },
  floatingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  floatingButtonText: { fontSize: 12, fontWeight: '700', color: '#5A4A3D' },
  controls: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5D8C8',
    backgroundColor: '#FFF',
  },
  controlHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  controlTitle: { fontSize: 13, fontWeight: '600', color: '#7A726A' },
  radiusValue: { marginTop: 2, fontSize: 19, fontWeight: '700', color: '#3F3933' },
  stepper: { flexDirection: 'row', gap: 8 },
  stepButton: {
    width: 42,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF1E1',
  },
  presetRow: { flexDirection: 'row', gap: 7, marginTop: 14 },
  presetChip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 9,
    paddingVertical: 9,
    backgroundColor: '#F5F1EC',
  },
  presetChipActive: { backgroundColor: '#F28C28' },
  presetText: { fontSize: 11, fontWeight: '600', color: '#6B625A' },
  presetTextActive: { color: '#FFF' },
  polygonActions: { flexDirection: 'row', gap: 8 },
  textAction: { borderRadius: 9, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#FFF1E1' },
  textActionText: { color: '#B96516', fontWeight: '700' },
  hint: { marginTop: 10, fontSize: 12, color: '#A15C1B' },
});

export default GeofenceMapModal;
