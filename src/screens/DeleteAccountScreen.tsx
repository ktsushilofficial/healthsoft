import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';

const DeleteAccountScreen = () => {
  const navigation = useNavigation();
  const { requestAccountDeletion } = useAuth();
  const [reason, setReason] = useState('');
  const [consentToDelete, setConsentToDelete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const confirmationOpen = useRef(false);
  const requestAccepted = useRef(false);
  const canSubmit = !!reason.trim() && consentToDelete && !isSubmitting;

  const submitRequest = async () => {
    confirmationOpen.current = false;
    if (requestInFlight.current || requestAccepted.current) return;
    requestInFlight.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const message = await requestAccountDeletion(reason, consentToDelete);
      requestAccepted.current = true;
      setSuccessMessage(message);
    } catch (requestError) {
      setError(
        requestError instanceof Error && requestError.message
          ? requestError.message
          : 'Unable to submit your deletion request. Please try again.',
      );
    } finally {
      requestInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const confirmDeletion = () => {
    if (
      !canSubmit ||
      confirmationOpen.current ||
      requestInFlight.current ||
      requestAccepted.current
    )
      return;
    confirmationOpen.current = true;
    Alert.alert(
      'Delete Account?',
      'Submit a request to delete your Healthsoft account? Once deletion is completed, it cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            confirmationOpen.current = false;
          },
        },
        {
          text: 'Submit Request',
          style: 'destructive',
          onPress: submitRequest,
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          confirmationOpen.current = false;
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back"
          disabled={isSubmitting}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" size={24} color="#333333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delete Account</Text>
        <View style={styles.headerSpacer} />
      </View>
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {successMessage ? (
            <View style={styles.card}>
              <Icon name="checkmark-circle-outline" size={44} color="#2E7D32" />
              <Text style={styles.title}>Request Submitted</Text>
              <Text style={styles.description} accessibilityLiveRegion="polite">
                {successMessage}
              </Text>
              <TouchableOpacity
                style={styles.doneButton}
                accessibilityRole="button"
                onPress={() => navigation.goBack()}
              >
                <Text style={styles.buttonText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.title}>Request account deletion</Text>
              <Text style={styles.description}>
                You can request deletion of your Healthsoft account here. Please
                provide a reason and confirm your consent before submitting.
              </Text>
              <Text style={styles.warning}>
                Once your account is deleted, this action cannot be undone.
              </Text>
              <Text style={styles.label}>Reason for deletion</Text>
              <TextInput
                style={styles.reasonInput}
                accessibilityLabel="Reason for deletion"
                placeholder="Tell us why you want to delete your account"
                placeholderTextColor="#777777"
                value={reason}
                onChangeText={text => {
                  setReason(text);
                  setError(null);
                }}
                multiline
                textAlignVertical="top"
                editable={!isSubmitting}
              />
              <TouchableOpacity
                style={styles.consentRow}
                accessibilityRole="checkbox"
                accessibilityLabel="I consent to the deletion of my Healthsoft account"
                accessibilityState={{
                  checked: consentToDelete,
                  disabled: isSubmitting,
                }}
                disabled={isSubmitting}
                onPress={() => setConsentToDelete(value => !value)}
              >
                <Icon
                  name={consentToDelete ? 'checkbox' : 'square-outline'}
                  size={26}
                  color={consentToDelete ? '#C62828' : '#666666'}
                />
                <Text style={styles.consentText}>
                  I consent to the deletion of my Healthsoft account.
                </Text>
              </TouchableOpacity>
              {error ? (
                <Text
                  style={styles.error}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  {error}
                </Text>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  !canSubmit && styles.disabledButton,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Submit Deletion Request"
                accessibilityState={{
                  disabled: !canSubmit,
                  busy: isSubmitting,
                }}
                disabled={!canSubmit}
                onPress={confirmDeletion}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>Submit Deletion Request</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => navigation.goBack()}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default DeleteAccountScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  body: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
  },
  headerSpacer: { width: 24 },
  content: { padding: 16, paddingBottom: 32 },
  card: { backgroundColor: '#FFFFFF', padding: 20, borderRadius: 12 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333333',
    marginBottom: 12,
    marginTop: 8,
  },
  description: { fontSize: 16, lineHeight: 24, color: '#666666' },
  warning: { fontSize: 14, lineHeight: 21, color: '#C62828', marginTop: 12 },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginTop: 24,
    marginBottom: 10,
  },
  reasonInput: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#333333',
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
  },
  consentText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    marginLeft: 12,
    color: '#333333',
  },
  error: { color: '#C62828', fontSize: 14, lineHeight: 21, marginBottom: 12 },
  submitButton: {
    backgroundColor: '#C62828',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  disabledButton: { opacity: 0.45 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  cancelButton: { padding: 16, alignItems: 'center', marginTop: 4 },
  cancelText: { color: '#666666', fontSize: 16, fontWeight: '600' },
  doneButton: {
    backgroundColor: '#FF9500',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 24,
  },
});
