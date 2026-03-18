import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';

const contacts = [
  {
    id: '1',
    name: 'Sarah Johnson',
    relation: 'Wife',
    mobile: '+1 555-123-4567',
    home: '+1 555-765-4321',
    color: '#F6C7A7',
  },
  {
    id: '2',
    name: 'Michael Davis',
    relation: 'Father',
    mobile: '+1 555-987-6543',
    color: '#CBE4F6',
  },
];

const conditions = [
  { id: '1', label: 'Asthma', checked: false },
  { id: '2', label: 'Diabetes', checked: true },
  { id: '3', label: 'Hypertension', checked: true },
  { id: '4', label: 'High Cholesterol', checked: true },
  { id: '5', label: 'Sleep Apnea', checked: false },
  { id: '6', label: 'Allergies', checked: false },
];

const medicines = [
  {
    id: '1',
    name: 'Lipitor',
    generic: 'Atorvastatin',
    dose: '20 mg tablet',
    usage: 'Take 1 tablet at morning',
    type: 'pill',
  },
  {
    id: '2',
    name: 'Advair',
    generic: 'Fluticasone/Salmeterol',
    dose: '250 mcg / 50 mcg',
    usage: 'Take 1 puff twice daily',
    type: 'inhaler',
  },
];

const bluetoothDevices = [
  { id: '1', name: 'Smart Pill Dispenser', status: 'Connected' },
  { id: '2', name: 'Fall Detection Pendant', status: 'Available' },
  { id: '3', name: 'Blood Pressure Monitor', status: 'Available' },
];

const DeviceScreen = () => {
  const navigation = useNavigation();
  const tabs = useMemo(
    () => [
      { id: 'devices', label: 'Devices' },
      { id: 'conditions', label: 'Conditions' },
      { id: 'medicines', label: 'Medicines' },
      { id: 'contacts', label: 'Contacts' },
    ],
    [],
  );
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const hasPurchased = true;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.navigate('Home' as never)}>
            <Icon name="arrow-back" size={22} color="#F28C28" />
          </TouchableOpacity>
          <View style={styles.brand} />
          <View style={styles.headerSpacer} />
        </View>

        {hasPurchased ? (
          <>
            <View style={styles.segmentWrap}>
              {tabs.map(tab => {
                const isActive = tab.id === activeTab;
                return (
                  <TouchableOpacity
                    key={tab.id}
                    style={[styles.segment, isActive && styles.segmentActive]}
                    onPress={() => setActiveTab(tab.id)}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        isActive && styles.segmentTextActive,
                      ]}
                    >
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {activeTab === 'contacts' ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Emergency Contacts</Text>
                <Text style={styles.cardSubtitle}>
                  Your emergency contacts may be notified in case of a medical
                  emergency or alert.
                </Text>
                <TouchableOpacity style={styles.primaryButton}>
                  <Icon name="add" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>
                    Add Emergency Contact
                  </Text>
                </TouchableOpacity>

                {contacts.map(contact => (
                  <View key={contact.id} style={styles.contactCard}>
                    <View style={styles.contactHeader}>
                      <View
                        style={[
                          styles.avatar,
                          { backgroundColor: contact.color || '#F6C7A7' },
                        ]}
                      >
                        <Text style={styles.avatarText}>
                          {contact.name
                            .split(' ')
                            .map(part => part[0])
                            .slice(0, 2)
                            .join('')}
                        </Text>
                      </View>
                      <View style={styles.contactInfo}>
                        <Text style={styles.contactName}>{contact.name}</Text>
                        <Text style={styles.contactRelation}>
                          {contact.relation}
                        </Text>
                      </View>
                      <Icon name="call" size={20} color="#F28C28" />
                    </View>

                    <View style={styles.contactRow}>
                      <Text style={styles.contactLabel}>Mobile</Text>
                      <Text style={styles.contactValue}>{contact.mobile}</Text>
                      <Icon name="call" size={16} color="#F28C28" />
                    </View>
                    {contact.home ? (
                      <View style={styles.contactRow}>
                        <Text style={styles.contactLabel}>Home</Text>
                        <Text style={styles.contactValue}>{contact.home}</Text>
                        <Icon name="call" size={16} color="#F28C28" />
                      </View>
                    ) : null}
                  </View>
                ))}

                <TouchableOpacity style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Edit</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {activeTab === 'conditions' ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  Pre-existing Health Conditions
                </Text>
                <Text style={styles.cardSubtitle}>
                  Select any relevant pre-existing health conditions for your
                  medical profile.
                </Text>

                {conditions.map(item => (
                  <View key={item.id} style={styles.checkboxRow}>
                    <View
                      style={[
                        styles.checkbox,
                        item.checked
                          ? styles.checkboxChecked
                          : styles.checkboxEmpty,
                      ]}
                    >
                      {item.checked ? (
                        <Icon name="checkmark" size={14} color="#FFFFFF" />
                      ) : null}
                    </View>
                    <Text style={styles.checkboxLabel}>{item.label}</Text>
                  </View>
                ))}

                <TouchableOpacity style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Save</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {activeTab === 'medicines' ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Medicines Taken</Text>
                <Text style={styles.cardSubtitle}>
                  Keep track of medications you are currently taking.
                </Text>
                <TouchableOpacity style={styles.primaryButton}>
                  <Icon name="add" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>Add Medicine</Text>
                </TouchableOpacity>

                {medicines.map(item => (
                  <View key={item.id} style={styles.medicineCard}>
                    <View
                      style={[
                        styles.medicineIcon,
                        item.type === 'inhaler'
                          ? styles.medicineIconPurple
                          : styles.medicineIconGold,
                      ]}
                    >
                      <Icon
                        name={item.type === 'inhaler' ? 'medical' : 'bandage'}
                        size={22}
                        color="#FFFFFF"
                      />
                    </View>
                    <View style={styles.medicineInfo}>
                      <Text style={styles.medicineName}>
                        {item.name}{' '}
                        <Text style={styles.medicineGeneric}>
                          ({item.generic})
                        </Text>
                      </Text>
                      <Text style={styles.medicineDetail}>{item.dose}</Text>
                      <Text style={styles.medicineDetail}>{item.usage}</Text>
                    </View>
                    <Icon name="pencil" size={18} color="#F28C28" />
                  </View>
                ))}

                <TouchableOpacity style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Edit</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {activeTab === 'devices' ? (
              <View style={styles.card}>
                <View style={styles.deviceHeaderRow}>
                  <Text style={styles.deviceTitle}>Device Manager</Text>
                  <TouchableOpacity style={styles.unlinkChip}>
                    <Text style={styles.unlinkText}>Unlink</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.deviceCard}>
                  <View style={styles.deviceImage}>
                    <Icon name="medical" size={40} color="#FFFFFF" />
                  </View>
                  <Text style={styles.deviceCardName}>Pill Dispenser</Text>
                </View>

                <View style={styles.deviceInfoRow}>
                  <Text style={styles.deviceInfoLabel}>IMEI Code</Text>
                  <Text style={styles.deviceInfoValue}>359544090451234</Text>
                </View>
                <View style={styles.deviceInfoRow}>
                  <Text style={styles.deviceInfoLabel}>SIM Number</Text>
                  <Text style={styles.deviceInfoValue}>445683072100208</Text>
                </View>
                <View style={styles.deviceInfoRow}>
                  <Text style={styles.deviceInfoLabel}>Date of Setup</Text>
                  <Text style={styles.deviceInfoValue}>Apr 15, 2023</Text>
                </View>

                <TouchableOpacity style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>Manage Settings</Text>
                </TouchableOpacity>

                <View style={styles.deviceDivider} />

                <Text style={styles.cardTitle}>Bluetooth Devices</Text>
                <Text style={styles.cardSubtitle}>
                  Link and manage nearby medical devices for the care plan.
                </Text>
                <TouchableOpacity style={styles.primaryButton}>
                  <Icon name="bluetooth" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>Link New Device</Text>
                </TouchableOpacity>

                {bluetoothDevices.map(device => (
                  <View key={device.id} style={styles.deviceRow}>
                    <Icon name="radio" size={20} color="#F28C28" />
                    <View style={styles.deviceInfo}>
                      <Text style={styles.deviceName}>{device.name}</Text>
                      <Text style={styles.deviceStatus}>{device.status}</Text>
                    </View>
                    <TouchableOpacity style={styles.linkButton}>
                      <Text style={styles.linkButtonText}>
                        {device.status === 'Connected' ? 'Manage' : 'Link'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.deviceTitle}>Payment Details</Text>
            <View style={styles.paymentCard}>
              <View style={styles.paymentChipRow}>
                <Text style={styles.cardDigits}>•••• 5678</Text>
                <Icon name="wifi" size={18} color="#FFFFFF" />
              </View>
              <Text style={styles.cardBrand}>VISA</Text>
            </View>

            <View style={styles.deviceInfoRow}>
              <Text style={styles.deviceInfoLabel}>Subscription Start Date</Text>
              <Text style={styles.deviceInfoValue}>Jun 20, 2023</Text>
            </View>
            <View style={styles.deviceInfoRow}>
              <Text style={styles.deviceInfoLabel}>Subscription End Date</Text>
              <Text style={styles.deviceInfoValue}>Jun 20, 2024</Text>
            </View>
            <View style={styles.deviceInfoRow}>
              <Text style={styles.deviceInfoLabel}>Next Payment Due</Text>
              <Text style={styles.deviceInfoValue}>May 20, 2024</Text>
            </View>
            <View style={styles.deviceInfoRow}>
              <Text style={styles.deviceInfoLabel}>Last Payment Made</Text>
              <Text style={styles.deviceInfoValue}>Apr 20, 2023</Text>
            </View>

            <TouchableOpacity style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Make Payment</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default DeviceScreen;

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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  brand: {
    width: 24,
    height: 24,
  },
  headerSpacer: {
    width: 22,
  },
  segmentWrap: {
    flexDirection: 'row',
    backgroundColor: '#EFE7DD',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 18,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 14,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: {
    fontSize: 12,
    color: '#8B7F74',
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#2E2A27',
  },
  deviceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  deviceTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2E2A27',
  },
  unlinkChip: {
    backgroundColor: '#F28C28',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  unlinkText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  deviceCard: {
    alignItems: 'center',
    marginBottom: 12,
  },
  deviceImage: {
    width: 110,
    height: 70,
    borderRadius: 16,
    backgroundColor: '#F28C28',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  deviceCardName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2E2A27',
  },
  deviceInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#EEE6DD',
  },
  deviceInfoLabel: {
    fontSize: 13,
    color: '#7A726A',
  },
  deviceInfoValue: {
    fontSize: 14,
    color: '#2E2A27',
    fontWeight: '600',
  },
  deviceDivider: {
    height: 1,
    backgroundColor: '#EFE7DD',
    marginVertical: 16,
  },
  paymentCard: {
    backgroundColor: '#3B3F6B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    marginTop: 12,
  },
  paymentChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardDigits: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
  },
  cardBrand: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    alignSelf: 'flex-end',
    marginTop: 20,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F7F4',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  deviceInfo: {
    flex: 1,
    marginLeft: 10,
  },
  deviceName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E2A27',
  },
  deviceStatus: {
    fontSize: 12,
    color: '#7A726A',
    marginTop: 2,
  },
  linkButton: {
    backgroundColor: '#F28C28',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  linkButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2E2A27',
    textAlign: 'center',
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#7A726A',
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 18,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F28C28',
    borderRadius: 22,
    paddingVertical: 12,
    marginBottom: 16,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    marginLeft: 6,
  },
  secondaryButton: {
    backgroundColor: '#F28C28',
    borderRadius: 22,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  contactCard: {
    backgroundColor: '#F9F7F4',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  contactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontWeight: '700',
    color: '#5B4636',
  },
  contactInfo: {
    flex: 1,
    marginLeft: 12,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2E2A27',
  },
  contactRelation: {
    fontSize: 13,
    color: '#7A726A',
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#EEE6DD',
  },
  contactLabel: {
    fontSize: 12,
    color: '#7A726A',
    width: 60,
  },
  contactValue: {
    flex: 1,
    fontSize: 14,
    color: '#2E2A27',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F7F4',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F1E8DE',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: '#F28C28',
  },
  checkboxEmpty: {
    borderWidth: 2,
    borderColor: '#F28C28',
  },
  checkboxLabel: {
    fontSize: 14,
    color: '#2E2A27',
  },
  medicineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F7F4',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  medicineIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  medicineIconGold: {
    backgroundColor: '#F2B046',
  },
  medicineIconPurple: {
    backgroundColor: '#8D6CE8',
  },
  medicineInfo: {
    flex: 1,
  },
  medicineName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2E2A27',
  },
  medicineGeneric: {
    fontSize: 12,
    color: '#7A726A',
  },
  medicineDetail: {
    fontSize: 12,
    color: '#6E665E',
    marginTop: 2,
  },
});
