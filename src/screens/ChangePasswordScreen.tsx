// src/screens/ChangePasswordScreen.tsx
import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '@react-navigation/native';

const ChangePasswordScreen = () => {
    const navigation = useNavigation<any>();
    const { changePassword } = useAuth();

    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [showOldPassword, setShowOldPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const [isLoading, setIsLoading] = useState(false);

    const getErrorMessage = (error: unknown, fallback: string): string => {
        if (error instanceof Error && error.message.trim().length > 0) {
            return error.message;
        }
        return fallback;
    };

    const handleChangePassword = async () => {
        if (!oldPassword || !newPassword || !confirmPassword) {
            Alert.alert('Error', 'Please fill in all fields');
            return;
        }

        if (newPassword !== confirmPassword) {
            Alert.alert('Error', 'New passwords do not match');
            return;
        }

        if (newPassword.length < 6) {
            Alert.alert('Error', 'Password must be at least 6 characters long');
            return;
        }

        setIsLoading(true);
        try {
            await changePassword(oldPassword, newPassword);
            Alert.alert('Success', 'Your password has been changed successfully.', [
                {
                    text: 'OK',
                    onPress: () => navigation.goBack(),
                },
            ]);
        } catch (error) {
            Alert.alert('Error', getErrorMessage(error, 'Failed to change password.'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.keyboardView}>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled">

                    <View style={styles.header}>
                        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                            <Icon name="arrow-back" size={24} color="#333" />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Change Password</Text>
                        <View style={{ width: 24 }} />
                    </View>

                    <View style={styles.formContainer}>
                        <Text style={styles.loginSubtext}>
                            Please enter your current password and choose a new one.
                        </Text>

                        {/* Old Password Input */}
                        <View style={styles.inputContainer}>
                            <Icon name="lock-closed-outline" size={20} color="#8E8E93" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="Current Password"
                                placeholderTextColor="#8E8E93"
                                value={oldPassword}
                                onChangeText={setOldPassword}
                                secureTextEntry={!showOldPassword}
                                autoCapitalize="none"
                            />
                            <TouchableOpacity onPress={() => setShowOldPassword(!showOldPassword)} style={styles.eyeIcon}>
                                <Icon name={showOldPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#8E8E93" />
                            </TouchableOpacity>
                        </View>

                        {/* New Password Input */}
                        <View style={styles.inputContainer}>
                            <Icon name="key-outline" size={20} color="#8E8E93" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="New Password"
                                placeholderTextColor="#8E8E93"
                                value={newPassword}
                                onChangeText={setNewPassword}
                                secureTextEntry={!showNewPassword}
                                autoCapitalize="none"
                            />
                            <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)} style={styles.eyeIcon}>
                                <Icon name={showNewPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#8E8E93" />
                            </TouchableOpacity>
                        </View>

                        {/* Confirm New Password Input */}
                        <View style={styles.inputContainer}>
                            <Icon name="key-outline" size={20} color="#8E8E93" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="Confirm New Password"
                                placeholderTextColor="#8E8E93"
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                secureTextEntry={!showConfirmPassword}
                                autoCapitalize="none"
                            />
                            <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeIcon}>
                                <Icon name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'} size={20} color="#8E8E93" />
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                            style={[styles.saveButton, isLoading && styles.buttonDisabled]}
                            onPress={handleChangePassword}
                            disabled={isLoading}>
                            {isLoading ? (
                                <ActivityIndicator color="#FFFFFF" />
                            ) : (
                                <Text style={styles.saveButtonText}>Update Password</Text>
                            )}
                        </TouchableOpacity>

                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    keyboardView: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    backButton: {
        padding: 8,
        marginLeft: -8,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
    },
    formContainer: {
        paddingHorizontal: 24,
        paddingTop: 32,
    },
    loginSubtext: {
        fontSize: 14,
        color: '#8E8E93',
        marginBottom: 32,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8F8F8',
        borderRadius: 12,
        paddingHorizontal: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#E5E5E5',
        height: 52,
    },
    inputIcon: {
        marginRight: 12,
    },
    input: {
        flex: 1,
        height: '100%',
        fontSize: 16,
        color: '#000000',
    },
    eyeIcon: {
        padding: 8,
        marginRight: -8,
    },
    saveButton: {
        backgroundColor: '#FF9500',
        height: 52,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 16,
        shadowColor: '#FF9500',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    saveButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
});

export default ChangePasswordScreen;
