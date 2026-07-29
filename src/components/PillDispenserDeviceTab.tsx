import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { usePillDispenserProvisioning } from '../pillDispenser/usePillDispenserProvisioning';

function signalLabel(rssi: number | null) {
  if (rssi == null) return 'Available';
  if (rssi >= -60) return 'Strong signal';
  if (rssi >= -75) return 'Good signal';
  return 'Weak signal';
}

const PillDispenserDeviceTab = () => {
  const {
    isAvailable,
    devices,
    wifiNetworks,
    stage,
    selectedDeviceId,
    connectedWifiSsid,
    compatibilityAvailable,
    connectionEncrypted,
    statusMessage,
    error,
    startScan,
    stopScan,
    connect,
    connectCompatibility,
    provision,
    refreshWifi,
    checkWifiStatus,
    disconnect,
  } = usePillDispenserProvisioning();
  const [selectedSsid, setSelectedSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const isScanning = stage === 'scanning';
  const isConnecting = stage === 'connecting' || stage === 'securing';
  const isReady = stage === 'ready';
  const isProvisioning = stage === 'provisioning';
  const isComplete = stage === 'connected';

  useEffect(() => {
    if (isComplete) {
      setPassword('');
      setShowPassword(false);
    }
  }, [isComplete]);

  const step = useMemo(() => {
    if (isComplete) return 3;
    if (isReady || isProvisioning) return 2;
    return 1;
  }, [isComplete, isProvisioning, isReady]);

  return (
    <View style={styles.card}>
      <View style={styles.titleIcon}>
        <Icon name="medical-outline" size={22} color="#F28C28" />
      </View>
      <Text style={styles.cardTitle}>Pill Dispenser Wi-Fi Setup</Text>
      <Text style={styles.cardSubtitle}>
        Connect to the dispenser over Bluetooth, then securely give it your
        Wi-Fi details. Select only your pill dispenser; BluFi compatibility is
        verified before Wi-Fi details can be entered.
      </Text>

      <View style={styles.steps}>
        {['Dispenser', 'Wi-Fi', 'Complete'].map((label, index) => {
          const number = index + 1;
          const active = number <= step;
          return (
            <React.Fragment key={label}>
              {index > 0 ? (
                <View
                  style={[
                    styles.stepLine,
                    active ? styles.stepLineActive : null,
                  ]}
                />
              ) : null}
              <View style={styles.stepItem}>
                <View
                  style={[
                    styles.stepCircle,
                    active ? styles.stepCircleActive : null,
                  ]}
                >
                  {number < step ? (
                    <Icon name="checkmark" size={14} color="#FFFFFF" />
                  ) : (
                    <Text
                      style={[
                        styles.stepNumber,
                        active ? styles.stepNumberActive : null,
                      ]}
                    >
                      {number}
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.stepLabel,
                    active ? styles.stepLabelActive : null,
                  ]}
                >
                  {label}
                </Text>
              </View>
            </React.Fragment>
          );
        })}
      </View>

      <View style={[styles.statusBox, error ? styles.errorBox : null]}>
        <Icon
          name={
            error
              ? 'alert-circle-outline'
              : isComplete
              ? 'checkmark-circle'
              : 'information-circle-outline'
          }
          size={19}
          color={error ? '#B42318' : isComplete ? '#128044' : '#73573C'}
        />
        <Text style={[styles.statusText, error ? styles.errorText : null]}>
          {error || statusMessage}
        </Text>
      </View>

      {compatibilityAvailable ? (
        <View style={styles.compatibilityBox}>
          <Text style={styles.compatibilityTitle}>
            Encrypted setup was not accepted
          </Text>
          <Text style={styles.compatibilityText}>
            This dispenser appears to use an older or manufacturer-specific
            BluFi setup. Compatibility mode may work, but the Wi-Fi password
            will not be encrypted inside the Bluetooth connection.
          </Text>
          <TouchableOpacity
            style={styles.compatibilityButton}
            onPress={connectCompatibility}
          >
            <Icon name="warning-outline" size={17} color="#FFFFFF" />
            <Text style={styles.compatibilityButtonText}>
              Continue in compatibility mode
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {step === 1 ? (
        <>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              !isAvailable ? styles.disabled : null,
            ]}
            disabled={!isAvailable || isConnecting}
            onPress={() => (isScanning ? stopScan() : startScan())}
          >
            {isScanning || isConnecting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Icon name="bluetooth" size={18} color="#FFFFFF" />
            )}
            <Text style={styles.primaryButtonText}>
              {isScanning
                ? 'Stop Scanning'
                : isConnecting
                ? 'Connecting…'
                : 'Scan Pill Dispensers'}
            </Text>
          </TouchableOpacity>

          {devices.length === 0 && isScanning ? (
            <Text style={styles.helperText}>
              Keep the dispenser close, make sure its setup light is blinking,
              and look for the BLE name printed in its manual or label.
            </Text>
          ) : null}

          {devices.map(device => {
            const selected = device.id === selectedDeviceId;
            return (
              <View key={device.id} style={styles.deviceRow}>
                <View style={styles.deviceIcon}>
                  <Icon name="medical" size={20} color="#D97706" />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{device.name}</Text>
                  <Text style={styles.rowMeta}>
                    {signalLabel(device.rssi)}
                    {device.rssi == null ? '' : ` · ${device.rssi} dBm`}
                    {device.isLikelyBluFi
                      ? ' · BluFi advertised'
                      : ' · Compatibility unknown'}
                    {device.isConnectable === false ? ' · Not connectable' : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.smallButton,
                    selected && isConnecting ? styles.disabled : null,
                  ]}
                  disabled={isConnecting}
                  onPress={() => {
                    if (device.isConnectable === false) {
                      Alert.alert(
                        'Dispenser is not accepting connections',
                        'The device is advertising over Bluetooth, but it is not connectable. Put the dispenser into Wi-Fi/BluFi setup mode until its setup light blinks, then scan again.',
                      );
                      return;
                    }
                    connect(device.id);
                  }}
                >
                  <Text style={styles.smallButtonText}>
                    {selected && isConnecting
                      ? 'Connecting'
                      : device.isConnectable === false
                      ? 'Unavailable'
                      : 'Connect'}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Choose a 2.4 GHz Wi-Fi network
            </Text>
            <TouchableOpacity
              onPress={refreshWifi}
              disabled={isProvisioning}
              hitSlop={10}
            >
              <Icon name="refresh" size={19} color="#F28C28" />
            </TouchableOpacity>
          </View>

          {wifiNetworks.slice(0, 8).map(network => {
            const selected = selectedSsid === network.ssid;
            return (
              <TouchableOpacity
                key={network.ssid}
                style={[
                  styles.wifiRow,
                  selected ? styles.wifiRowSelected : null,
                ]}
                onPress={() => setSelectedSsid(network.ssid)}
                disabled={isProvisioning}
              >
                <Icon
                  name="wifi"
                  size={18}
                  color={selected ? '#F28C28' : '#7A726A'}
                />
                <Text style={styles.wifiName} numberOfLines={1}>
                  {network.ssid}
                </Text>
                <Text style={styles.wifiSignal}>{network.rssi} dBm</Text>
                {selected ? (
                  <Icon name="checkmark-circle" size={19} color="#F28C28" />
                ) : null}
              </TouchableOpacity>
            );
          })}

          <Text style={styles.inputLabel}>Wi-Fi name</Text>
          <TextInput
            value={selectedSsid}
            onChangeText={setSelectedSsid}
            editable={!isProvisioning}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Enter SSID manually"
            placeholderTextColor="#A69B91"
            style={styles.input}
          />

          <Text style={styles.inputLabel}>Wi-Fi password</Text>
          <View style={styles.passwordWrap}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              editable={!isProvisioning}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!showPassword}
              placeholder="Enter Wi-Fi password"
              placeholderTextColor="#A69B91"
              style={styles.passwordInput}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(value => !value)}
              hitSlop={10}
            >
              <Icon
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color="#7A726A"
              />
            </TouchableOpacity>
          </View>

          <Text style={styles.securityNote}>
            <Icon
              name={connectionEncrypted ? 'lock-closed' : 'warning'}
              size={12}
              color={connectionEncrypted ? '#287052' : '#B54708'}
            />{' '}
            {connectionEncrypted
              ? 'Credentials are sent directly to the dispenser through the encrypted BluFi session.'
              : 'Compatibility mode is active. Credentials are sent directly over the local Bluetooth connection without BluFi payload encryption.'}
          </Text>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              !selectedSsid.trim() || isProvisioning ? styles.disabled : null,
            ]}
            disabled={!selectedSsid.trim() || isProvisioning}
            onPress={() => provision(selectedSsid, password)}
          >
            {isProvisioning ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Icon name="wifi" size={18} color="#FFFFFF" />
            )}
            <Text style={styles.primaryButtonText}>
              {isProvisioning
                ? 'Connecting to Wi-Fi…'
                : 'Connect Dispenser to Wi-Fi'}
            </Text>
          </TouchableOpacity>

          {isProvisioning ? (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={checkWifiStatus}
            >
              <Text style={styles.secondaryButtonText}>
                Check connection status
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}

      {isComplete ? (
        <View style={styles.successContent}>
          <View style={styles.successIcon}>
            <Icon name="checkmark" size={34} color="#FFFFFF" />
          </View>
          <Text style={styles.successTitle}>Pill dispenser is online</Text>
          <Text style={styles.successBody}>
            {connectedWifiSsid
              ? `Connected to ${connectedWifiSsid}.`
              : 'The dispenser successfully joined Wi-Fi.'}
          </Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={disconnect}>
            <Text style={styles.secondaryButtonText}>
              Finish Bluetooth setup
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

export default PillDispenserDeviceTab;

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  titleIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFF4E6',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2E2A27',
    textAlign: 'center',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#7A726A',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 6,
  },
  steps: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 18,
  },
  stepItem: {
    width: 64,
    alignItems: 'center',
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E9E2DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: {
    backgroundColor: '#F28C28',
  },
  stepNumber: {
    color: '#8B7F74',
    fontSize: 12,
    fontWeight: '700',
  },
  stepNumberActive: {
    color: '#FFFFFF',
  },
  stepLabel: {
    fontSize: 10,
    color: '#9A8F85',
    marginTop: 5,
  },
  stepLabelActive: {
    color: '#5A4633',
    fontWeight: '700',
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#E9E2DA',
    marginTop: 13,
    marginHorizontal: -10,
  },
  stepLineActive: {
    backgroundColor: '#F28C28',
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FAF5EF',
    borderRadius: 12,
    padding: 11,
    marginBottom: 14,
  },
  errorBox: {
    backgroundColor: '#FFF1F0',
  },
  statusText: {
    flex: 1,
    marginLeft: 8,
    color: '#73573C',
    fontSize: 12,
    lineHeight: 17,
  },
  errorText: {
    color: '#B42318',
  },
  compatibilityBox: {
    backgroundColor: '#FFF7E8',
    borderColor: '#F2B84B',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  compatibilityTitle: {
    color: '#7A4510',
    fontSize: 13,
    fontWeight: '700',
  },
  compatibilityText: {
    color: '#875B2A',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  compatibilityButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B54708',
    borderRadius: 20,
    paddingHorizontal: 14,
    marginTop: 10,
  },
  compatibilityButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  primaryButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F28C28',
    borderRadius: 23,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    marginLeft: 7,
  },
  disabled: {
    opacity: 0.5,
  },
  helperText: {
    marginTop: 10,
    color: '#8B7F74',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F7F4',
    borderRadius: 14,
    padding: 11,
    marginTop: 10,
  },
  deviceIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFF3DE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: '#2E2A27',
    fontSize: 14,
    fontWeight: '700',
  },
  rowMeta: {
    color: '#8B7F74',
    fontSize: 11,
    marginTop: 3,
  },
  smallButton: {
    backgroundColor: '#F28C28',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  smallButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#4A4038',
    fontWeight: '700',
    fontSize: 13,
  },
  wifiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ECE5DE',
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    marginBottom: 7,
  },
  wifiRowSelected: {
    borderColor: '#F28C28',
    backgroundColor: '#FFF9F2',
  },
  wifiName: {
    flex: 1,
    color: '#3B342E',
    fontSize: 13,
    fontWeight: '600',
    marginHorizontal: 9,
  },
  wifiSignal: {
    color: '#8B7F74',
    fontSize: 10,
    marginRight: 7,
  },
  inputLabel: {
    color: '#5D5147',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    minHeight: 45,
    borderWidth: 1,
    borderColor: '#DDD4CB',
    borderRadius: 12,
    paddingHorizontal: 12,
    color: '#2E2A27',
    backgroundColor: '#FFFFFF',
  },
  passwordWrap: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DDD4CB',
    borderRadius: 12,
    paddingRight: 12,
    backgroundColor: '#FFFFFF',
  },
  passwordInput: {
    flex: 1,
    color: '#2E2A27',
    paddingHorizontal: 12,
  },
  securityNote: {
    color: '#557063',
    fontSize: 11,
    lineHeight: 16,
    marginVertical: 10,
  },
  secondaryButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    borderWidth: 1,
    borderColor: '#D7C3AB',
    backgroundColor: '#F8EFE5',
    marginTop: 10,
  },
  secondaryButtonText: {
    color: '#8B5E34',
    fontWeight: '700',
    fontSize: 13,
  },
  successContent: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#22A15F',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  successTitle: {
    fontSize: 18,
    color: '#1C5838',
    fontWeight: '800',
  },
  successBody: {
    color: '#657269',
    fontSize: 13,
    marginTop: 5,
    textAlign: 'center',
  },
});
