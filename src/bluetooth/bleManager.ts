import { BleManager } from 'react-native-ble-plx';

// Initialize once per app lifetime.
// The hook will call `destroy()` only if you choose to, but for now we keep it global.
const bleManager = new BleManager();

export default bleManager;

