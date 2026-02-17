import React from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    FlatList,
    Image,
    Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuth, Senior } from '../context/AuthContext';

interface SeniorSelectionModalProps {
    visible: boolean;
    onClose: () => void;
}

const SeniorSelectionModal: React.FC<SeniorSelectionModalProps> = ({
    visible,
    onClose,
}) => {
    const { seniors, selectSenior, selectedSenior } = useAuth();

    const handleSelect = async (seniorId: string) => {
        await selectSenior(seniorId);
        onClose();
    };

    const renderSeniorItem = ({ item }: { item: Senior }) => {
        const isSelected = selectedSenior?.userId === item.userId;
        return (
            <TouchableOpacity
                style={[styles.seniorItem, isSelected && styles.selectedItem]}
                onPress={() => handleSelect(item.userId)}
            >
                {item.profileImageUrl ? (
                    <Image
                        source={{ uri: item.profileImageUrl }}
                        style={styles.avatar}
                    />
                ) : (
                    <View style={styles.avatarPlaceholder}>
                        <Text style={styles.avatarInitials}>
                            {(item.firstName?.[0] || '').toUpperCase()}{(item.lastName?.[0] || '').toUpperCase()}
                        </Text>
                    </View>
                )}
                <View style={styles.infoContainer}>
                    <Text style={styles.name}>{`${item.firstName} ${item.lastName}`}</Text>
                    {isSelected && <Text style={styles.selectedLabel}>Selected</Text>}
                </View>
                {isSelected && <Icon name="checkmark-circle" size={24} color="#FF9500" />}
            </TouchableOpacity>
        );
    };

    return (
        <Modal
            animationType="slide"
            transparent={true}
            visible={visible}
            onRequestClose={onClose}
        >
            <View style={styles.centeredView}>
                <View style={styles.modalView}>
                    <Text style={styles.modalTitle}>Select Senior Profile</Text>
                    <Text style={styles.modalSubtitle}>
                        Choose a senior to manage their health and activities.
                    </Text>

                    {seniors.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>No seniors associated with your account.</Text>
                        </View>
                    ) : (
                        <FlatList
                            data={seniors}
                            renderItem={renderSeniorItem}
                            keyExtractor={item => item.userId}
                            contentContainerStyle={styles.listContainer}
                        />
                    )}

                    <TouchableOpacity
                        style={styles.closeButton}
                        onPress={onClose}
                    >
                        <Text style={styles.closeButtonText}>Close</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    centeredView: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modalView: {
        width: Dimensions.get('window').width * 0.9,
        backgroundColor: 'white',
        borderRadius: 20,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
        maxHeight: '80%',
    },
    modalTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 8,
        textAlign: 'center',
    },
    modalSubtitle: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        marginBottom: 24,
    },
    listContainer: {
        paddingBottom: 20,
    },
    seniorItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#F9F9F9',
        borderRadius: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    selectedItem: {
        borderColor: '#FF9500',
        backgroundColor: '#FFF8E1',
    },
    avatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
        marginRight: 16,
    },
    infoContainer: {
        flex: 1,
    },
    name: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
    },
    selectedLabel: {
        fontSize: 12,
        color: '#FF9500',
        marginTop: 4,
    },
    emptyContainer: {
        alignItems: 'center',
        padding: 20,
    },
    emptyText: {
        color: '#666',
        textAlign: 'center',
    },
    closeButton: {
        marginTop: 16,
        backgroundColor: '#333',
        borderRadius: 12,
        padding: 14,
        alignItems: 'center',
    },
    closeButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 16,
    },
    avatarPlaceholder: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#FF9500',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    avatarInitials: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
});

export default SeniorSelectionModal;
