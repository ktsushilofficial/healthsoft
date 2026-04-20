import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import LinearGradient from 'react-native-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const WINDOW_HEIGHT = Dimensions.get('window').height;
const TOP_SAFE_PADDING = Platform.OS === 'ios' ? 20 : 12;
const BOTTOM_SAFE_PADDING = Platform.OS === 'ios' ? 34 : 16;

interface GuardianWelcomeModalProps {
  visible: boolean;
  greetingTitle: string;
  guardianName: string;
  seniorsCount: number;
  devicesCount: number;
  onClose: () => void;
}

const GuardianWelcomeModal: React.FC<GuardianWelcomeModalProps> = ({
  visible,
  greetingTitle,
  guardianName,
  seniorsCount,
  devicesCount,
  onClose,
}) => {
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(28)).current;
  const cardScale = useRef(new Animated.Value(0.96)).current;
  const haloScale = useRef(new Animated.Value(1)).current;
  const orbDrift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      backdropOpacity.stopAnimation();
      cardOpacity.stopAnimation();
      cardTranslateY.stopAnimation();
      cardScale.stopAnimation();
      haloScale.stopAnimation();
      orbDrift.stopAnimation();
      backdropOpacity.setValue(0);
      cardOpacity.setValue(0);
      cardTranslateY.setValue(28);
      cardScale.setValue(0.96);
      haloScale.setValue(1);
      orbDrift.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 340,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(cardTranslateY, {
        toValue: 0,
        damping: 16,
        mass: 0.95,
        stiffness: 170,
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        toValue: 1,
        damping: 15,
        mass: 0.9,
        stiffness: 170,
        useNativeDriver: true,
      }),
    ]).start();

    const haloLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(haloScale, {
          toValue: 1.06,
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(haloScale, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(orbDrift, {
          toValue: 1,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(orbDrift, {
          toValue: 0,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    haloLoop.start();
    driftLoop.start();

    return () => {
      haloLoop.stop();
      driftLoop.stop();
    };
  }, [visible, backdropOpacity, cardOpacity, cardTranslateY, cardScale, haloScale, orbDrift]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 170,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 170,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslateY, {
        toValue: 18,
        duration: 170,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        toValue: 0.98,
        duration: 170,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        onClose();
      }
    });
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <Animated.View
        style={[
          styles.backdrop,
          {
            opacity: backdropOpacity,
            paddingTop: TOP_SAFE_PADDING,
            paddingBottom: BOTTOM_SAFE_PADDING,
          },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <Animated.View
          style={[
            styles.cardWrap,
            {
              maxHeight: WINDOW_HEIGHT - TOP_SAFE_PADDING - BOTTOM_SAFE_PADDING - 24,
              opacity: cardOpacity,
              transform: [{ translateY: cardTranslateY }, { scale: cardScale }],
            },
          ]}
        >
          <LinearGradient
            colors={['#F6FFF8', '#E7F8ED', '#D7F0DE']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.card,
              {
                maxHeight: WINDOW_HEIGHT - TOP_SAFE_PADDING - BOTTOM_SAFE_PADDING - 24,
              },
            ]}
          >
            <Animated.View style={[styles.heroHalo, { transform: [{ scale: haloScale }] }]} />
            <Animated.View
              style={[
                styles.heroOrbOne,
                {
                  transform: [
                    {
                      translateY: orbDrift.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -10],
                      }),
                    },
                  ],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.heroOrbTwo,
                {
                  transform: [
                    {
                      translateX: orbDrift.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 10],
                      }),
                    },
                    {
                      translateY: orbDrift.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 8],
                      }),
                    },
                  ],
                },
              ]}
            />

            <TouchableOpacity style={styles.closeButton} onPress={handleClose} activeOpacity={0.8}>
              <Icon name="close" size={18} color="#24543A" />
            </TouchableOpacity>

            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.chipRow}>
                <View style={styles.modeChip}>
                  <Icon name="leaf" size={14} color="#FFFFFF" />
                  <Text style={styles.modeChipText}>Senior Care</Text>
                </View>
              </View>

              <View style={styles.heroSection}>
                <View style={styles.heroTextCol}>
            <Text style={styles.title}>{`Welcome, ${guardianName}`}</Text>
                  <Text style={styles.subtitle}>
                    Everything is ready. You can review seniors, check live device status, and stay connected in one calm dashboard.
                  </Text>
                </View>
                <View style={styles.iconShell}>
                  <LinearGradient
                    colors={['#1F8F5F', '#116E49']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.iconCore}
                  >
                    <Icon name="shield-checkmark" size={34} color="#FFFFFF" />
                  </LinearGradient>
                </View>
              </View>

              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View style={styles.panelHeaderText}>
                    <Text style={styles.panelEyebrow}>Session overview</Text>
                    <Text style={styles.panelTitle}>Home is ready for monitoring</Text>
                  </View>
                  <View style={styles.panelBadge}>
                    <Text style={styles.panelBadgeText}>LIVE</Text>
                  </View>
                </View>

                <View style={styles.statGrid}>
                  <View style={styles.statCard}>
                    <Icon name="people-outline" size={18} color="#1F8F5F" />
                    <Text style={styles.statValue}>{Math.max(seniorsCount, 1)}</Text>
                    <Text style={styles.statLabel}>Senior profiles</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Icon name="watch-outline" size={18} color="#1F8F5F" />
                    <Text style={styles.statValue}>{devicesCount}</Text>
                    <Text style={styles.statLabel}>Connected devices</Text>
                  </View>
                  <View style={styles.statCardWide}>
                    <View style={styles.statWideRow}>
                      <View style={styles.signalDot} />
                      <Text style={styles.statWideLabel}>Status</Text>
                    </View>
                    <Text style={styles.statWideValue}>Care dashboard active</Text>
                    <Text style={styles.statWideHelp}>
                      Use the top-right selector or greeting card to switch seniors whenever needed.
                    </Text>
                  </View>
                </View>
              </View>
            </ScrollView>
            <View style={[styles.footer, { paddingBottom: BOTTOM_SAFE_PADDING }]}>
              <TouchableOpacity style={styles.primaryButton} onPress={handleClose} activeOpacity={0.92}>
                <LinearGradient
                  colors={['#14532D', '#0F3D23']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.primaryButtonFill}
                >
                  <Text style={styles.primaryButtonText}>Open Home</Text>
                  <Icon name="arrow-forward" size={18} color="#FFFFFF" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 44, 29, 0.42)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 430,
  },
  card: {
    overflow: 'hidden',
    borderRadius: 30,
    shadowColor: '#0F5132',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 18,
  },
  scrollArea: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 6,
  },
  footer: {
    paddingHorizontal: 22,
    paddingBottom: 12,
    paddingTop: 0,
  },
  heroHalo: {
    position: 'absolute',
    top: -84,
    right: -34,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  heroOrbOne: {
    position: 'absolute',
    right: -18,
    bottom: 110,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroOrbTwo: {
    position: 'absolute',
    left: -12,
    top: 160,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 2,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.64)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    paddingRight: 40,
  },
  modeChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F8F5F',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modeChipText: {
    marginLeft: 6,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  heroSection: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  heroTextCol: {
    flex: 1,
    paddingRight: 14,
  },
  title: {
    fontSize: SCREEN_WIDTH < 390 ? 28 : 31,
    fontWeight: '800',
    color: '#103B25',
    lineHeight: SCREEN_WIDTH < 390 ? 36 : 40,
  },
  subtitle: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 23,
    color: '#426450',
  },
  iconShell: {
    width: 84,
    height: 84,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  iconCore: {
    width: 66,
    height: 66,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    marginTop: 24,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(31, 143, 95, 0.10)',
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  panelHeaderText: {
    flex: 1,
    paddingRight: 10,
  },
  panelEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#5C8A6F',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#163C29',
  },
  panelBadge: {
    backgroundColor: '#DCFCE7',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  panelBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#166534',
    letterSpacing: 0.7,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -5,
  },
  statCard: {
    width: '50%',
    paddingHorizontal: 5,
    marginBottom: 10,
  },
  statValue: {
    marginTop: 10,
    fontSize: 22,
    fontWeight: '800',
    color: '#173B28',
  },
  statLabel: {
    marginTop: 4,
    fontSize: 13,
    color: '#5E7666',
    lineHeight: 18,
  },
  statCardWide: {
    width: '100%',
    paddingHorizontal: 5,
  },
  statWideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  signalDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22C55E',
    marginRight: 8,
  },
  statWideLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#5C8A6F',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  statWideValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#173B28',
  },
  statWideHelp: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#5E7666',
  },
  primaryButton: {
    borderRadius: 18,
    overflow: 'hidden',
    minHeight: 56,
  },
  primaryButtonFill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    marginRight: 10,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});

export default GuardianWelcomeModal;
