package `in`.healthsoftcare.seniorcare.blufi

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import blufi.espressif.BlufiCallback
import blufi.espressif.BlufiClient
import blufi.espressif.params.BlufiConfigureParams
import blufi.espressif.params.BlufiParameter
import blufi.espressif.response.BlufiScanResult
import blufi.espressif.response.BlufiStatusResponse
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.nio.charset.StandardCharsets

class EspBlufiModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val EVENT_DEVICE_FOUND = "EspBlufiDeviceFound"
    private const val EVENT_STATE = "EspBlufiState"
    private const val EVENT_WIFI_NETWORKS = "EspBlufiWifiNetworks"
    private const val EVENT_WIFI_STATUS = "EspBlufiWifiStatus"
    private const val SCAN_DURATION_MS = 12_000L
    private const val CONNECTION_TIMEOUT_MS = 15_000L
    private const val STATUS_RETRY_MS = 2_500L
    private const val MAX_STATUS_CHECKS = 5
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private val bluetoothAdapter: BluetoothAdapter? by lazy {
    val manager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    manager?.adapter
  }
  private val discoveredDevices = linkedMapOf<String, BluetoothDevice>()
  private var scanning = false
  private var activeDeviceId: String? = null
  private var blufiClient: BlufiClient? = null
  private var secureSessionReady = false
  private var compatibilityMode = false
  private var provisioningSsid: String? = null
  private var statusCheckCount = 0

  override fun getName(): String = "EspBlufiModule"

  private fun emit(event: String, payload: WritableMap) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, payload)
  }

  private fun emitState(
    state: String,
    deviceId: String? = activeDeviceId,
    ssid: String? = null,
    message: String? = null,
  ) {
    val payload = Arguments.createMap()
    payload.putString("state", state)
    deviceId?.let { payload.putString("deviceId", it) }
    ssid?.let { payload.putString("ssid", it) }
    message?.let { payload.putString("message", it) }
    emit(EVENT_STATE, payload)
  }

  private fun hasPermission(permission: String): Boolean {
    return ContextCompat.checkSelfPermission(reactContext, permission) ==
      PackageManager.PERMISSION_GRANTED
  }

  private fun hasScanPermission(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      hasPermission(Manifest.permission.BLUETOOTH_SCAN)
    } else {
      hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    }
  }

  private fun hasConnectPermission(): Boolean {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
      hasPermission(Manifest.permission.BLUETOOTH_CONNECT)
  }

  @SuppressLint("MissingPermission")
  private fun stopNativeScan(emitStopped: Boolean) {
    if (!scanning) return
    bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
    mainHandler.removeCallbacks(stopScanRunnable)
    scanning = false
    if (emitStopped) {
      emitState("scanStopped", deviceId = null)
    }
  }

  private val stopScanRunnable = Runnable { stopNativeScan(emitStopped = true) }

  private val scanCallback = object : ScanCallback() {
    @SuppressLint("MissingPermission")
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val device = result.device
      discoveredDevices[device.address] = device

      val payload = Arguments.createMap()
      payload.putString("id", device.address)
      payload.putString(
        "name",
        result.scanRecord?.deviceName ?: device.name ?: "Nearby BLE device",
      )
      payload.putInt("rssi", result.rssi)
      payload.putBoolean(
        "isConnectable",
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || result.isConnectable,
      )
      val blufiServiceUuid = "0000ffff-0000-1000-8000-00805f9b34fb"
      val scanRecord = result.scanRecord
      val advertisesBluFi =
        scanRecord?.serviceUuids?.any {
          it.uuid.toString().equals(blufiServiceUuid, ignoreCase = true)
        } == true ||
          scanRecord?.serviceData?.keys?.any {
            it.uuid.toString().equals(blufiServiceUuid, ignoreCase = true)
          } == true
      if (!advertisesBluFi) return
      payload.putBoolean("isLikelyBluFi", true)
      emit(EVENT_DEVICE_FOUND, payload)
    }

    override fun onScanFailed(errorCode: Int) {
      scanning = false
      mainHandler.removeCallbacks(stopScanRunnable)
      emitState(
        "error",
        deviceId = null,
        message = "Bluetooth scan failed (code $errorCode).",
      )
    }
  }

  @ReactMethod
  fun startScan(promise: Promise) {
    if (!hasScanPermission() || !hasConnectPermission()) {
      promise.reject(
        "BLE_PERMISSION",
        "Bluetooth permission is required to scan for the pill dispenser.",
      )
      return
    }
    val adapter = bluetoothAdapter
    if (adapter == null || !adapter.isEnabled) {
      promise.reject("BLE_OFF", "Turn on Bluetooth to find the pill dispenser.")
      return
    }

    try {
      stopNativeScan(emitStopped = false)
      discoveredDevices.clear()
      val scanner = adapter.bluetoothLeScanner
      if (scanner == null) {
        promise.reject("BLE_UNAVAILABLE", "Bluetooth LE scanning is unavailable.")
        return
      }
      val settings =
        ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
      scanner.startScan(null, settings, scanCallback)
      scanning = true
      emitState("scanning", deviceId = null)
      mainHandler.postDelayed(stopScanRunnable, SCAN_DURATION_MS)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("SCAN_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun stopScan(promise: Promise) {
    try {
      stopNativeScan(emitStopped = true)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("STOP_SCAN_FAILED", error.message, error)
    }
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun connect(deviceId: String, promise: Promise) {
    startConnection(deviceId, useCompatibilityMode = false, promise)
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun connectCompatibility(deviceId: String, promise: Promise) {
    startConnection(deviceId, useCompatibilityMode = true, promise)
  }

  @SuppressLint("MissingPermission")
  private fun startConnection(
    deviceId: String,
    useCompatibilityMode: Boolean,
    promise: Promise,
  ) {
    if (!hasConnectPermission()) {
      promise.reject(
        "BLE_PERMISSION",
        "Bluetooth permission is required to connect to the pill dispenser.",
      )
      return
    }
    val device = discoveredDevices[deviceId]
    if (device == null) {
      promise.reject("DEVICE_NOT_FOUND", "Scan again and select the pill dispenser.")
      return
    }

    try {
      stopNativeScan(emitStopped = false)
      closeClient()
      activeDeviceId = deviceId
      secureSessionReady = false
      compatibilityMode = useCompatibilityMode
      provisioningSsid = null
      statusCheckCount = 0

      val client = BlufiClient(reactContext.applicationContext, device)
      client.setGattWriteTimeout(10_000L)
      client.setGattCallback(gattCallback)
      client.setBlufiCallback(blufiCallback)
      blufiClient = client
      emitState("connecting", deviceId)
      client.connect()
      mainHandler.postDelayed(
        {
          if (blufiClient === client && !secureSessionReady) {
            closeClient()
            if (useCompatibilityMode) {
              emitState(
                "error",
                deviceId,
                message =
                  "The dispenser did not respond in BluFi compatibility mode. Its firmware may use a manufacturer-specific setup protocol.",
              )
            } else {
              emitState(
                "securityUnsupported",
                deviceId,
                message =
                  "The dispenser connected, but did not answer the standard encrypted BluFi handshake.",
              )
            }
          }
        },
        CONNECTION_TIMEOUT_MS,
      )
      promise.resolve(true)
    } catch (error: Exception) {
      emitState("error", deviceId, message = error.message ?: "Connection failed.")
      promise.reject("CONNECT_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun disconnect(promise: Promise) {
    try {
      closeClient()
      emitState("disconnected")
      activeDeviceId = null
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("DISCONNECT_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun requestWifiScan(promise: Promise) {
    val client = readyClient(promise) ?: return
    client.requestDeviceWifiScan()
    promise.resolve(true)
  }

  @ReactMethod
  fun provision(ssid: String, password: String, promise: Promise) {
    val client = readyClient(promise) ?: return
    val normalizedSsid = ssid.trim()
    if (normalizedSsid.isEmpty()) {
      promise.reject("INVALID_SSID", "Select or enter a Wi-Fi network name.")
      return
    }

    val params = BlufiConfigureParams()
    params.setOpMode(BlufiParameter.OP_MODE_STA)
    params.setStaSSIDBytes(normalizedSsid.toByteArray(StandardCharsets.UTF_8))
    params.setStaPassword(password)
    provisioningSsid = normalizedSsid
    statusCheckCount = 0
    emitState("provisioning", ssid = normalizedSsid)
    client.configure(params)
    promise.resolve(true)
  }

  @ReactMethod
  fun requestWifiStatus(promise: Promise) {
    val client = blufiClient
    if (client == null) {
      promise.reject("NOT_CONNECTED", "Connect to the pill dispenser first.")
      return
    }
    client.requestDeviceStatus()
    promise.resolve(true)
  }

  private fun readyClient(promise: Promise): BlufiClient? {
    val client = blufiClient
    if (client == null) {
      promise.reject("NOT_CONNECTED", "Connect to the pill dispenser first.")
      return null
    }
    if (!secureSessionReady) {
      promise.reject("SESSION_NOT_READY", "The encrypted BluFi session is not ready.")
      return null
    }
    return client
  }

  private val gattCallback = object : BluetoothGattCallback() {
    @SuppressLint("MissingPermission")
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS &&
        newState == BluetoothProfile.STATE_CONNECTED
      ) {
        emitState("connected", gatt.device.address)
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        secureSessionReady = false
        emitState("disconnected", gatt.device.address)
      } else if (status != BluetoothGatt.GATT_SUCCESS) {
        secureSessionReady = false
        emitState(
          "error",
          gatt.device.address,
          message = "Bluetooth connection failed (status $status).",
        )
      }
    }
  }

  private val blufiCallback = object : BlufiCallback() {
    override fun onGattPrepared(client: BlufiClient, status: Int, gatt: BluetoothGatt) {
      if (status != STATUS_SUCCESS) {
        emitState(
          "error",
          message = "Pill dispenser does not expose the expected BluFi service (code $status).",
        )
        return
      }
      emitState("connected")
      if (compatibilityMode) {
        secureSessionReady = true
        emitState("compatible")
      } else {
        client.negotiateSecurity()
      }
    }

    override fun onNegotiateSecurityResult(client: BlufiClient, status: Int) {
      if (status == STATUS_SUCCESS) {
        secureSessionReady = true
        emitState("secure")
      } else {
        secureSessionReady = false
        emitState(
          "securityUnsupported",
          message = "The dispenser rejected the standard encrypted BluFi handshake.",
        )
      }
    }

    override fun onDeviceScanResult(
      client: BlufiClient,
      status: Int,
      results: List<BlufiScanResult>,
    ) {
      if (status != STATUS_SUCCESS) {
        emitState("error", message = "The dispenser could not scan Wi-Fi (code $status).")
        return
      }
      val networks = Arguments.createArray()
      results.forEach { result ->
        if (result.ssid.isNullOrBlank()) return@forEach
        val network = Arguments.createMap()
        network.putString("ssid", result.ssid)
        network.putInt("rssi", result.rssi)
        networks.pushMap(network)
      }
      val payload = Arguments.createMap()
      payload.putArray("networks", networks)
      emit(EVENT_WIFI_NETWORKS, payload)
    }

    override fun onPostConfigureParams(client: BlufiClient, status: Int) {
      if (status == STATUS_SUCCESS) {
        emitState("configured", ssid = provisioningSsid)
        statusCheckCount = 0
        scheduleStatusCheck()
      } else {
        emitState(
          "error",
          ssid = provisioningSsid,
          message = "The dispenser rejected the Wi-Fi settings (code $status).",
        )
      }
    }

    override fun onDeviceStatusResponse(
      client: BlufiClient,
      status: Int,
      response: BlufiStatusResponse?,
    ) {
      if (status != STATUS_SUCCESS || response == null) {
        emitWifiStatus(
          connected = false,
          statusCode = status,
          message = "Could not read the dispenser's Wi-Fi status.",
        )
        return
      }

      val connected = response.isStaConnectWifi
      val ssid = response.staSSID ?: provisioningSsid
      emitWifiStatus(
        connected = connected,
        ssid = ssid,
        statusCode = response.staConnectionStatus,
        message =
          if (connected) {
            "Pill dispenser joined Wi-Fi."
          } else {
            "The dispenser is still connecting to Wi-Fi…"
          },
      )
      if (connected) {
        emitState("wifiConnected", ssid = ssid)
      } else if (provisioningSsid != null && statusCheckCount < MAX_STATUS_CHECKS) {
        scheduleStatusCheck()
      }
    }

    override fun onError(client: BlufiClient, errCode: Int) {
      emitState("error", message = "BluFi communication error (code $errCode).")
    }
  }

  private fun emitWifiStatus(
    connected: Boolean,
    ssid: String? = null,
    statusCode: Int? = null,
    message: String? = null,
  ) {
    val payload = Arguments.createMap()
    payload.putBoolean("connected", connected)
    ssid?.let { payload.putString("ssid", it) }
    statusCode?.let { payload.putInt("statusCode", it) }
    message?.let { payload.putString("message", it) }
    emit(EVENT_WIFI_STATUS, payload)
  }

  private fun scheduleStatusCheck() {
    statusCheckCount += 1
    mainHandler.postDelayed(
      {
        if (blufiClient != null && provisioningSsid != null) {
          blufiClient?.requestDeviceStatus()
        }
      },
      STATUS_RETRY_MS,
    )
  }

  private fun closeClient() {
    mainHandler.removeCallbacksAndMessages(null)
    stopNativeScan(emitStopped = false)
    try {
      blufiClient?.close()
    } finally {
      blufiClient = null
      secureSessionReady = false
      compatibilityMode = false
      provisioningSsid = null
      statusCheckCount = 0
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by NativeEventEmitter.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required by NativeEventEmitter.
  }

  override fun invalidate() {
    closeClient()
    super.invalidate()
  }
}
