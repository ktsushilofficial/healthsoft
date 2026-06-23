package `in`.healthsoftcare.seniorcare.blufi

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.os.SystemClock
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import blufi.espressif.BlufiCallback
import blufi.espressif.BlufiClient
import blufi.espressif.params.BlufiConfigureParams
import blufi.espressif.params.BlufiParameter
import blufi.espressif.response.BlufiScanResult as BlufiWifiScanResult
import blufi.espressif.response.BlufiStatusResponse
import blufi.espressif.response.BlufiVersionResponse
import java.nio.charset.Charset
import java.util.Locale

class PillDispenserBridgeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val bluetoothAdapter: BluetoothAdapter? by lazy {
    val manager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    manager?.adapter
  }

  private val wifiManager: WifiManager? by lazy {
    reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
  }

  private val seenDevices = linkedMapOf<String, BluetoothDevice>()
  private var activeScanFilters = emptyList<String>()
  private var bluetoothGatt: BluetoothGatt? = null
  private var blufiClient: BlufiClient? = null
  private var activeDeviceId: String? = null
  private var writeCharacteristic: BluetoothGattCharacteristic? = null
  private var notifyCharacteristic: BluetoothGattCharacteristic? = null

  override fun getName(): String = "PillDispenserBridge"

  private fun emit(event: String, map: Map<String, Any?>) {
    val payload = Arguments.createMap()
    map.forEach { (key, value) ->
      when (value) {
        null -> payload.putNull(key)
        is String -> payload.putString(key, value)
        is Int -> payload.putInt(key, value)
        is Long -> payload.putDouble(key, value.toDouble())
        is Double -> payload.putDouble(key, value)
        is Float -> payload.putDouble(key, value.toDouble())
        is Boolean -> payload.putBoolean(key, value)
        is Map<*, *> -> {
          val child = Arguments.createMap()
          value.forEach { (childKey, childValue) ->
            val name = childKey?.toString() ?: return@forEach
            when (childValue) {
              null -> child.putNull(name)
              is String -> child.putString(name, childValue)
              is Int -> child.putInt(name, childValue)
              is Long -> child.putDouble(name, childValue.toDouble())
              is Double -> child.putDouble(name, childValue)
              is Float -> child.putDouble(name, childValue.toDouble())
              is Boolean -> child.putBoolean(name, childValue)
              else -> child.putString(name, childValue.toString())
            }
          }
          payload.putMap(key, child)
        }
        is Iterable<*> -> {
          val array = Arguments.createArray()
          value.forEach { item ->
            when (item) {
              null -> array.pushNull()
              is String -> array.pushString(item)
              is Int -> array.pushInt(item)
              is Long -> array.pushDouble(item.toDouble())
              is Double -> array.pushDouble(item)
              is Float -> array.pushDouble(item.toDouble())
              is Boolean -> array.pushBoolean(item)
              is Map<*, *> -> {
                val child = Arguments.createMap()
                item.forEach { (childKey, childValue) ->
                  val name = childKey?.toString() ?: return@forEach
                  when (childValue) {
                    null -> child.putNull(name)
                    is String -> child.putString(name, childValue)
                    is Int -> child.putInt(name, childValue)
                    is Long -> child.putDouble(name, childValue.toDouble())
                    is Double -> child.putDouble(name, childValue)
                    is Float -> child.putDouble(name, childValue.toDouble())
                    is Boolean -> child.putBoolean(name, childValue)
                    else -> child.putString(name, childValue.toString())
                  }
                }
                array.pushMap(child)
              }
              else -> array.pushString(item.toString())
            }
          }
          payload.putArray(key, array)
        }
        else -> payload.putString(key, value.toString())
      }
    }
    reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, payload)
  }

  private fun toWritableValueMap(map: Map<String, Any?>): WritableMap {
    val payload = Arguments.createMap()
    map.forEach { (key, value) ->
      when (value) {
        null -> payload.putNull(key)
        is String -> payload.putString(key, value)
        is Int -> payload.putInt(key, value)
        is Long -> payload.putDouble(key, value.toDouble())
        is Double -> payload.putDouble(key, value)
        is Float -> payload.putDouble(key, value.toDouble())
        is Boolean -> payload.putBoolean(key, value)
        is Map<*, *> -> {
          @Suppress("UNCHECKED_CAST")
          payload.putMap(key, toWritableValueMap(value as Map<String, Any?>))
        }
        is Iterable<*> -> {
          val array = Arguments.createArray()
          value.forEach { item ->
            when (item) {
              null -> array.pushNull()
              is String -> array.pushString(item)
              is Int -> array.pushInt(item)
              is Long -> array.pushDouble(item.toDouble())
              is Double -> array.pushDouble(item)
              is Float -> array.pushDouble(item.toDouble())
              is Boolean -> array.pushBoolean(item)
              is Map<*, *> -> {
                @Suppress("UNCHECKED_CAST")
                array.pushMap(toWritableValueMap(item as Map<String, Any?>))
              }
              else -> array.pushString(item.toString())
            }
          }
          payload.putArray(key, array)
        }
        else -> payload.putString(key, value.toString())
      }
    }
    return payload
  }

  private fun emitError(code: String, message: String) {
    emit(
      "PillDispenserError",
      mapOf(
        "code" to code,
        "message" to message,
      ),
    )
  }

  private fun emitConnection(state: String, deviceId: String? = null) {
    emit(
      "PillDispenserConnectionState",
      mapOf(
        "state" to state,
        "deviceId" to deviceId,
      ),
    )
  }

  private fun normalizeSsid(rawSsid: String?): String? {
    val trimmed = rawSsid?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return trimmed
      .removePrefix("\"")
      .removeSuffix("\"")
      .takeIf { it.isNotEmpty() && !it.equals("<unknown ssid>", ignoreCase = true) }
  }

  private fun currentPhoneSsid(manager: WifiManager): String? {
    val connectionInfo = manager.connectionInfo ?: return null
    return normalizeSsid(connectionInfo.ssid)
  }

  private fun buildPhoneWifiContext(manager: WifiManager): Map<String, Any?> {
    val currentSsid = currentPhoneSsid(manager)
    val isWifiEnabled = manager.isWifiEnabled
    val networks = mutableListOf<Map<String, Any?>>()

    if (isWifiEnabled) {
      try {
        manager.startScan()
      } catch (_: Exception) {
        // Ignore and fall back to the latest scan results.
      }

      try {
        SystemClock.sleep(1200)
        manager.scanResults
          ?.asSequence()
          ?.mapNotNull { scanResult ->
            val ssid = normalizeSsid(scanResult.SSID) ?: return@mapNotNull null
            mapOf(
              "ssid" to ssid,
              "rssi" to scanResult.level,
              "frequency" to scanResult.frequency,
              "capabilities" to scanResult.capabilities,
              "isCurrent" to (currentSsid != null && ssid.equals(currentSsid, ignoreCase = true)),
            )
          }
          ?.distinctBy { it["ssid"]?.toString()?.lowercase(Locale.US) }
          ?.sortedWith(
            compareByDescending<Map<String, Any?>> { (it["isCurrent"] as? Boolean) == true }
              .thenByDescending { it["rssi"] as? Int ?: Int.MIN_VALUE },
          )
          ?.forEach { networks.add(it) }
      } catch (_: SecurityException) {
        return mapOf(
          "isWifiEnabled" to isWifiEnabled,
          "currentSsid" to currentSsid,
          "permissionRequired" to true,
          "errorMessage" to "Wi-Fi permission is required to read nearby networks.",
          "networks" to emptyList<Map<String, Any?>>(),
        )
      } catch (e: Exception) {
        return mapOf(
          "isWifiEnabled" to isWifiEnabled,
          "currentSsid" to currentSsid,
          "permissionRequired" to false,
          "errorMessage" to (e.message ?: "Failed to read Wi-Fi networks."),
          "networks" to emptyList<Map<String, Any?>>(),
        )
      }
    }

    return mapOf(
      "isWifiEnabled" to isWifiEnabled,
      "currentSsid" to currentSsid,
      "permissionRequired" to false,
      "errorMessage" to null,
      "networks" to networks,
    )
  }

  private fun normalizeNameFilters(nameFilters: ReadableArray?): List<String> {
    if (nameFilters == null) return emptyList()

    val normalized = mutableListOf<String>()
    for (index in 0 until nameFilters.size()) {
      val raw = nameFilters.getString(index) ?: continue
      val trimmed = raw.trim()
      if (trimmed.isNotEmpty()) {
        normalized.add(trimmed)
      }
    }
    return normalized
  }

  private fun matchesScanFilter(name: String?, filters: List<String>): Boolean {
    val haystack = (name ?: "").trim()
    if (haystack.isEmpty()) return false
    if (filters.isEmpty()) return true
    val normalizedHaystack = haystack.lowercase(Locale.US)
    return filters.any { filter ->
      val normalizedFilter = filter.trim().lowercase(Locale.US)
      normalizedFilter.isNotEmpty() && normalizedHaystack.contains(normalizedFilter)
    }
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun startScan(nameFilters: ReadableArray?, promise: Promise) {
    val adapter = bluetoothAdapter
    if (adapter == null || !adapter.isEnabled) {
      promise.reject("BLE_OFF", "Bluetooth is off")
      return
    }

    seenDevices.clear()
    adapter.bluetoothLeScanner?.stopScan(scanCallback)
    activeScanFilters = normalizeNameFilters(nameFilters)
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .build()
    val filters = activeScanFilters.map { filterName ->
      android.bluetooth.le.ScanFilter.Builder().setDeviceName(filterName).build()
    }
    adapter.bluetoothLeScanner?.startScan(if (filters.isEmpty()) emptyList() else filters, settings, scanCallback)
    promise.resolve(true)
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun stopScan(promise: Promise) {
    bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
    promise.resolve(true)
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val device = result.device ?: return
      val deviceId = device.address ?: return
      val name = device.name ?: result.scanRecord?.deviceName
      if (!matchesScanFilter(name, activeScanFilters)) {
        return
      }
      seenDevices[deviceId] = device
      emit(
        "PillDispenserScanResult",
        mapOf(
          "id" to deviceId,
          "name" to name,
          "localName" to result.scanRecord?.deviceName,
          "rssi" to result.rssi,
          "isConnectable" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) result.isConnectable else null,
          "serviceUUIDs" to result.scanRecord?.serviceUuids?.mapNotNull { it?.uuid?.toString() },
          "isLikelyBlufi" to (activeScanFilters.isEmpty() || matchesScanFilter(name, activeScanFilters)),
        ),
      )
    }
  }

  private fun ensureClient(): BlufiClient {
    val existing = blufiClient
    if (existing != null) return existing

    val deviceId = activeDeviceId
    val device = deviceId?.let { seenDevices[it] } ?: bluetoothAdapter?.getRemoteDevice(deviceId)
    requireNotNull(device) { "Device not found. Scan first." }

    val client = BlufiClient(reactContext.applicationContext, device)
    client.setGattCallback(gattCallback)
    client.setBlufiCallback(blufiCallback)
    client.setGattWriteTimeout(5000)
    blufiClient = client
    return client
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun connect(deviceId: String, promise: Promise) {
    val adapter = bluetoothAdapter
    if (adapter == null || !adapter.isEnabled) {
      promise.reject("BLE_OFF", "Bluetooth is off")
      return
    }

    blufiClient?.close()
    blufiClient = null
    bluetoothGatt?.close()
    bluetoothGatt = null
    writeCharacteristic = null
    notifyCharacteristic = null

    val device = seenDevices[deviceId] ?: try {
      adapter.getRemoteDevice(deviceId)
    } catch (e: IllegalArgumentException) {
      null
    }

    if (device == null) {
      promise.reject("NOT_FOUND", "Peripheral not found. Scan first.")
      return
    }

    activeDeviceId = deviceId
    emitConnection("connecting", deviceId)
    val client = BlufiClient(reactContext.applicationContext, device)
    client.setGattCallback(gattCallback)
    client.setBlufiCallback(blufiCallback)
    client.setGattWriteTimeout(5000)
    blufiClient = client
    client.connect()
    promise.resolve(true)
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun disconnect(promise: Promise) {
    blufiClient?.close()
    blufiClient = null
    bluetoothGatt?.close()
    bluetoothGatt = null
    writeCharacteristic = null
    notifyCharacteristic = null
    activeDeviceId?.let { emitConnection("disconnected", it) }
    activeDeviceId = null
    promise.resolve(true)
  }

  @ReactMethod
  fun requestCloseConnection(promise: Promise) {
    blufiClient?.requestCloseConnection()
    promise.resolve(true)
  }

  @ReactMethod
  fun negotiateSecurity(promise: Promise) {
    val client = blufiClient
    if (client == null) {
      promise.reject("NOT_CONNECTED", "Connect to a device before negotiating security.")
      return
    }
    client.negotiateSecurity()
    promise.resolve(true)
  }

  @ReactMethod
  fun requestDeviceVersion(promise: Promise) {
    val client = blufiClient
    if (client == null) {
      promise.reject("NOT_CONNECTED", "Connect to a device before requesting version.")
      return
    }
    client.requestDeviceVersion()
    promise.resolve(true)
  }

  @ReactMethod
  fun requestDeviceStatus(promise: Promise) {
    val client = blufiClient
    if (client == null) {
      promise.reject("NOT_CONNECTED", "Connect to a device before requesting status.")
      return
    }
    client.requestDeviceStatus()
    promise.resolve(true)
  }

  @ReactMethod
  fun requestDeviceScan(promise: Promise) {
    val client = blufiClient
    if (client == null) {
      promise.reject("NOT_CONNECTED", "Connect to a device before requesting Wi-Fi scan.")
      return
    }
    client.requestDeviceWifiScan()
    promise.resolve(true)
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun getWifiContext(requestPermissions: Boolean, promise: Promise) {
    val manager = wifiManager
    if (manager == null) {
      promise.reject("WIFI_UNAVAILABLE", "Wi-Fi manager is unavailable.")
      return
    }

    if (requestPermissions) {
      // Permission handling is driven from the JS side.
    }

    val payload = buildPhoneWifiContext(manager)
    promise.resolve(toWritableValueMap(payload))
  }

  @ReactMethod
  fun postCustomData(base64Data: String, promise: Promise) {
    val client = blufiClient
    if (client == null) {
      promise.reject("NOT_CONNECTED", "Connect to a device before posting custom data.")
      return
    }
    val data = try {
      Base64.decode(base64Data, Base64.DEFAULT)
    } catch (e: IllegalArgumentException) {
      null
    }
    if (data == null) {
      promise.reject("INVALID_DATA", "Custom data must be base64 encoded.")
      return
    }
    client.postCustomData(data)
    promise.resolve(true)
  }

  @ReactMethod
  fun configureStation(ssid: String, password: String, bssid: String?, promise: Promise) {
    val client = blufiClient
    if (client == null) {
      promise.reject("NOT_CONNECTED", "Connect to a device before configuring Wi-Fi.")
      return
    }
    if (ssid.isBlank()) {
      promise.reject("INVALID_SSID", "Wi-Fi SSID cannot be empty.")
      return
    }
    emit("PillDispenserLog", mapOf("message" to "Starting Wi-Fi configuration for SSID \"$ssid\""))
    val params = BlufiConfigureParams().apply {
      setOpMode(BlufiParameter.OP_MODE_STA)
      setStaSSIDBytes(ssid.toByteArray(Charset.forName("UTF-8")))
      setStaPassword(password)
      if (!bssid.isNullOrBlank()) {
        setStaBSSID(bssid)
      }
    }
    try {
      client.configure(params)
      promise.resolve(true)
    } catch (e: Exception) {
      emitError("CONFIGURE_STATION", e.message ?: "Failed to configure Wi-Fi.")
      promise.reject("CONFIGURE_STATION", e.message, e)
    }
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      val deviceId = gatt.device?.address ?: activeDeviceId
      if (status == BluetoothGatt.GATT_SUCCESS) {
        when (newState) {
          BluetoothProfile.STATE_CONNECTED -> {
            bluetoothGatt = gatt
            emitConnection("connected", deviceId)
          }
          BluetoothProfile.STATE_DISCONNECTED -> {
            gatt.close()
            emitConnection("disconnected", deviceId)
            activeDeviceId = null
            blufiClient = null
          }
        }
      } else {
        gatt.close()
        emitConnection("error", deviceId)
        emitError("GATT_DISCONNECT", "Disconnected with status $status")
      }
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) {
        emit("PillDispenserLog", mapOf("message" to "MTU request failed, mtu=$mtu status=$status"))
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) {
        gatt.disconnect()
        emitError("GATT_SERVICES", "Discover services failed: $status")
      }
    }

    override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      val message = if (status == BluetoothGatt.GATT_SUCCESS) "Notification enable complete" else "Notification enable failed"
      emit("PillDispenserLog", mapOf("message" to message))
    }

    override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) {
        gatt.disconnect()
        emitError("GATT_WRITE", "Characteristic write failed: $status")
      }
    }
  }

  private val blufiCallback = object : BlufiCallback() {
    override fun onGattPrepared(client: BlufiClient, status: Int, gatt: BluetoothGatt) {
      when (status) {
        BlufiCallback.STATUS_SUCCESS -> {
          emitConnection("connected", activeDeviceId)
          val mtu = 512
          if (!gatt.requestMtu(mtu)) {
            emit("PillDispenserLog", mapOf("message" to "MTU request failed, continuing with default"))
          }
        }
        CODE_GATT_DISCOVER_SERVICE_FAILED,
        CODE_GATT_DISCOVER_WRITE_CHAR_FAILED,
        CODE_GATT_DISCOVER_NOTIFY_CHAR_FAILED,
        CODE_GATT_ERR_OPEN_NOTIFY -> {
          gatt.disconnect()
          emitError("GATT_PREPARE", "BluFi GATT prepare failed: $status")
        }
        else -> {
          gatt.disconnect()
          emitError("GATT_PREPARE", "Unknown BluFi GATT prepare status: $status")
        }
      }
    }

    override fun onNegotiateSecurityResult(client: BlufiClient, status: Int) {
      emit("PillDispenserLog", mapOf("message" to if (status == BlufiCallback.STATUS_SUCCESS) "BluFi security negotiation complete" else "BluFi security negotiation failed"))
    }

    override fun onPostConfigureParams(client: BlufiClient, status: Int) {
      emit(
        "PillDispenserLog",
        mapOf("message" to if (status == BlufiCallback.STATUS_SUCCESS) "BluFi configuration posted" else "BluFi configuration failed with status $status"),
      )
    }

    override fun onDeviceStatusResponse(client: BlufiClient, status: Int, response: BlufiStatusResponse?) {
      emit(
        "PillDispenserStatus",
        mapOf(
          "status" to status,
          "opMode" to response?.opMode,
          "softApSecurity" to response?.getSoftAPSecurity(),
          "softApConnectionCount" to response?.getSoftAPConnectionCount(),
          "softApMaxConnection" to response?.getSoftAPMaxConnectionCount(),
          "softApChannel" to response?.getSoftAPChannel(),
          "softApPassword" to response?.getSoftAPPassword(),
          "softApSsid" to response?.getSoftAPSSID(),
          "staConnectionStatus" to response?.getStaConnectionStatus(),
          "staBssid" to response?.getStaBSSID(),
          "staSsid" to response?.getStaSSID(),
          "staPassword" to response?.getStaPassword(),
        ),
      )
    }

    override fun onDeviceScanResult(client: BlufiClient, status: Int, results: List<BlufiWifiScanResult>?) {
      emit(
        "PillDispenserWifiScan",
        mapOf(
          "status" to status,
          "results" to results.orEmpty().map {
            mapOf(
              "ssid" to it.ssid,
              "rssi" to it.rssi,
              "type" to it.type,
            )
          },
        ),
      )
    }

    override fun onDeviceVersionResponse(client: BlufiClient, status: Int, response: BlufiVersionResponse?) {
      emit(
        "PillDispenserVersion",
        mapOf(
          "status" to status,
          "versionString" to response?.getVersionString(),
          "bigVer" to response?.getVersionValues()?.getOrNull(0),
          "smallVer" to response?.getVersionValues()?.getOrNull(1),
        ),
      )
    }

    override fun onPostCustomDataResult(client: BlufiClient, status: Int, data: ByteArray?) {
      val raw = data ?: byteArrayOf()
      emit(
        "PillDispenserCustomData",
        mapOf(
          "status" to status,
          "direction" to "sent",
          "dataBase64" to Base64.encodeToString(raw, Base64.NO_WRAP),
          "dataUtf8" to String(raw, Charset.forName("UTF-8")),
        ),
      )
    }

    override fun onReceiveCustomData(client: BlufiClient, status: Int, data: ByteArray?) {
      val raw = data ?: byteArrayOf()
      emit(
        "PillDispenserCustomData",
        mapOf(
          "status" to status,
          "direction" to "received",
          "dataBase64" to Base64.encodeToString(raw, Base64.NO_WRAP),
          "dataUtf8" to String(raw, Charset.forName("UTF-8")),
        ),
      )
    }

    override fun onError(client: BlufiClient, errCode: Int) {
      emitError("BLUFI_ERROR", "BluFi error code $errCode")
      if (errCode == CODE_GATT_WRITE_TIMEOUT) {
        client.close()
        emitConnection("error", activeDeviceId)
      }
    }
  }

  override fun invalidate() {
    super.invalidate()
    blufiClient?.close()
    bluetoothGatt?.close()
    blufiClient = null
    bluetoothGatt = null
    writeCharacteristic = null
    notifyCharacteristic = null
    activeDeviceId = null
  }
}
