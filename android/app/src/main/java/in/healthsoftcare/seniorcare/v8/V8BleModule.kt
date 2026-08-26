package `in`.healthsoftcare.seniorcare.v8

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanRecord
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.jstyle.blesdkv8.Util.BleSDK
import com.jstyle.blesdkv8.callback.DataListener2301
import com.jstyle.blesdkv8.model.AutoTestMode
import com.jstyle.blesdkv8.model.MyDeviceTime
import com.jstyle.blesdkv8.model.MyPersonalInfo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.LinkedList
import java.util.Locale
import java.util.UUID

class V8BleModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val ecgMeasurementDurationMs = 30_000L

  private val bluetoothAdapter: BluetoothAdapter? by lazy {
    val manager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    manager?.adapter
  }

  private var bluetoothGatt: BluetoothGatt? = null
  private var activeDeviceId: String? = null
  private var writeCharacteristic: BluetoothGattCharacteristic? = null
  private var notifyCharacteristic: BluetoothGattCharacteristic? = null
  private val writeQueue = LinkedList<ByteArray>()
  private var writeInFlight = false
  private var lastWrite: ByteArray? = null
  private var lastRetryCount = 0
  private val maxWriteRetry = 2

  private val serviceUuid = UUID.fromString("0000fff0-0000-1000-8000-00805f9b34fb")
  private val writeUuid = UUID.fromString("0000fff6-0000-1000-8000-00805f9b34fb")
  private val notifyUuid = UUID.fromString("0000fff7-0000-1000-8000-00805f9b34fb")
  private val cccUuid = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

  override fun getName(): String = "V8BleModule"

  private fun emit(event: String, data: WritableMap) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, data)
  }

  private fun emitConnection(state: String, deviceId: String? = null) {
    val map = Arguments.createMap()
    map.putString("state", state)
    if (deviceId != null) map.putString("deviceId", deviceId)
    emit("V8ConnectionState", map)
  }

  private fun emitScanCandidate(device: BluetoothDevice?, rssi: Int? = null) {
    if (device == null) return
    val map = Arguments.createMap()
    map.putString("id", device.address)
    map.putString("name", device.name)
    map.putString("localName", device.name)
    if (rssi != null) {
      map.putInt("rssi", rssi)
    }
    emit("V8ScanResult", map)
  }

  private fun mapToWritable(map: Map<*, *>): WritableMap {
    val out = Arguments.createMap()
    map.forEach { (rawKey, value) ->
      val key = rawKey?.toString() ?: return@forEach
      putWritableValue(out, key, value)
    }
    return out
  }

  private fun listToWritable(values: Iterable<*>): WritableArray {
    val out = Arguments.createArray()
    values.forEach { value -> pushWritableValue(out, value) }
    return out
  }

  private fun putWritableValue(out: WritableMap, key: String, value: Any?) {
    when (value) {
      null -> out.putNull(key)
      is String -> out.putString(key, value)
      is Boolean -> out.putBoolean(key, value)
      is Byte -> out.putInt(key, value.toInt())
      is Short -> out.putInt(key, value.toInt())
      is Int -> out.putInt(key, value)
      is Long -> out.putDouble(key, value.toDouble())
      is Float -> out.putDouble(key, value.toDouble())
      is Double -> out.putDouble(key, value)
      is Map<*, *> -> out.putMap(key, mapToWritable(value))
      is Iterable<*> -> out.putArray(key, listToWritable(value))
      is Array<*> -> out.putArray(key, listToWritable(value.asIterable()))
      else -> out.putString(key, value.toString())
    }
  }

  private fun pushWritableValue(out: WritableArray, value: Any?) {
    when (value) {
      null -> out.pushNull()
      is String -> out.pushString(value)
      is Boolean -> out.pushBoolean(value)
      is Byte -> out.pushInt(value.toInt())
      is Short -> out.pushInt(value.toInt())
      is Int -> out.pushInt(value)
      is Long -> out.pushDouble(value.toDouble())
      is Float -> out.pushDouble(value.toDouble())
      is Double -> out.pushDouble(value)
      is Map<*, *> -> out.pushMap(mapToWritable(value))
      is Iterable<*> -> out.pushArray(listToWritable(value))
      is Array<*> -> out.pushArray(listToWritable(value.asIterable()))
      else -> out.pushString(value.toString())
    }
  }

  /**
   * The bundled vendor SDK parses 0x28 measurement results for modes 1-3 but
   * silently drops mode 4 (contact ECG). Mode 4 uses the same result layout:
   * byte 2 is the device-computed heart rate. Ignore start/stop acknowledgements
   * and malformed packets by requiring a physiologically plausible value.
   */
  private fun emitAndroidEcgResultIfPresent(value: ByteArray) {
    if (value.size < 8) return
    val command = value[0].toInt() and 0xff
    val measurementMode = value[1].toInt() and 0xff
    val heartRate = value[2].toInt() and 0xff
    if (command != 0x28 || measurementMode != 0x04 || heartRate !in 20..250) return

    val result = Arguments.createMap()
    result.putString("Type", measurementMode.toString())
    result.putInt("ECGHrValue", heartRate)
    result.putInt("heartRate", heartRate)

    val payload = Arguments.createMap()
    payload.putString("dataType", "ECGResult")
    payload.putBoolean("dataEnd", true)
    payload.putMap("dicData", result)

    val event = Arguments.createMap()
    event.putString("type", "parsed")
    event.putMap("payload", payload)
    emit("V8Data", event)
  }

  @ReactMethod
  fun startScan(nameFilters: ReadableArray?, promise: Promise) {
    val adapter = bluetoothAdapter
    if (adapter == null || !adapter.isEnabled) {
      promise.reject("BLE_OFF", "Bluetooth is off")
      return
    }

    // Surface already-connected GATT peripherals immediately after app restart.
    val manager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    manager?.getConnectedDevices(BluetoothProfile.GATT)?.forEach { connected ->
      if (looksLikeHandBand(connected, null)) {
        emitScanCandidate(connected, null)
      }
    }

    // Surface bonded candidates too (some vendors remain discoverable this way when advertising is sparse).
    adapter.bondedDevices?.forEach { bonded ->
      val name = (bonded.name ?: "").lowercase()
      if (name.contains("v8") || name.contains("jstyle") || name.contains("band")) {
        emitScanCandidate(bonded, null)
      }
    }

    adapter.bluetoothLeScanner?.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback)
    promise.resolve(true)
  }

  @ReactMethod
  fun stopScan(promise: Promise) {
    bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
    promise.resolve(true)
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun connect(deviceId: String, promise: Promise) {
    val adapter = bluetoothAdapter
    if (adapter == null || !adapter.isEnabled) {
      promise.reject("BLE_OFF", "Bluetooth is off")
      return
    }
    try {
      emitConnection("connecting", deviceId)
      val device = adapter.getRemoteDevice(deviceId)
      bluetoothGatt?.close()
      activeDeviceId = deviceId
      bluetoothGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        device.connectGatt(reactContext, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
      } else {
        device.connectGatt(reactContext, false, gattCallback)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      emitConnection("error", deviceId)
      promise.reject("CONNECT_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun disconnect(promise: Promise) {
    try {
      bluetoothGatt?.disconnect()
      bluetoothGatt?.close()
      bluetoothGatt = null
      writeCharacteristic = null
      notifyCharacteristic = null
      emitConnection("disconnected", activeDeviceId)
      activeDeviceId = null
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("DISCONNECT_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun requestDeviceVersion(promise: Promise) {
    enqueueVendorCommand(BleSDK.GetDeviceVersion(), promise)
  }

  @ReactMethod
  fun requestBattery(promise: Promise) {
    enqueueVendorCommand(BleSDK.GetDeviceBatteryLevel(), promise)
  }

  @ReactMethod
  fun requestDeviceMac(promise: Promise) {
    enqueueVendorCommand(BleSDK.GetDeviceMacAddress(), promise)
  }

  @ReactMethod
  fun requestDeviceName(promise: Promise) {
    enqueueVendorCommand(BleSDK.GetDeviceName(), promise)
  }

  @ReactMethod
  fun setDeviceName(name: String, promise: Promise) {
    enqueueVendorCommand(BleSDK.SetDeviceName(name), promise)
  }

  @ReactMethod
  fun setDeviceId(deviceId: String, promise: Promise) {
    enqueueVendorCommand(BleSDK.SetDeviceID(deviceId), promise)
  }

  @ReactMethod
  fun requestDeviceTime(promise: Promise) {
    enqueueVendorCommand(BleSDK.GetDeviceTime(), promise)
  }

  @ReactMethod
  fun syncDeviceTime(promise: Promise) {
    val now = Date()
    val md = MyDeviceTime()
    val year = SimpleDateFormat("yyyy", Locale.US).format(now).toInt()
    val month = SimpleDateFormat("MM", Locale.US).format(now).toInt()
    val day = SimpleDateFormat("dd", Locale.US).format(now).toInt()
    val hour = SimpleDateFormat("HH", Locale.US).format(now).toInt()
    val minute = SimpleDateFormat("mm", Locale.US).format(now).toInt()
    val second = SimpleDateFormat("ss", Locale.US).format(now).toInt()
    md.setYear(year)
    md.setMonth(month)
    md.setDay(day)
    md.setHour(hour)
    md.setMinute(minute)
    md.setSecond(second)
    enqueueVendorCommand(BleSDK.SetDeviceTime(md), promise)
  }

  @ReactMethod
  fun requestPersonalInfo(promise: Promise) {
    enqueueVendorCommand(BleSDK.GetPersonalInfo(), promise)
  }

  @ReactMethod
  fun setPersonalInfo(sex: Int, age: Int, height: Int, weight: Int, stepLength: Int, promise: Promise) {
    val info = MyPersonalInfo()
    info.setSex(sex)
    info.setAge(age)
    info.setHeight(height)
    info.setWeight(weight)
    info.setStepLength(stepLength)
    enqueueVendorCommand(BleSDK.SetPersonalInfo(info), promise)
  }

  @ReactMethod
  fun setRealtimeStepEnabled(enabled: Boolean, includeTemperature: Boolean, promise: Promise) {
    enqueueVendorCommand(BleSDK.RealTimeStep(enabled, includeTemperature), promise)
  }

  @ReactMethod
  fun setEcgRealtimeEnabled(enabled: Boolean, promise: Promise) {
    enqueueVendorCommand(BleSDK.setECGRealtimeDuringHRVEnabled(enabled), promise)
  }

  @ReactMethod
  fun startEcgMeasurement(promise: Promise) {
    // Contact ECG uses the vendor's HRV measurement command (0x28 0x04 0x01)
    // plus raw ECG transmission (0x07 0x01). The Android SDK exposes the
    // resulting 0x07 samples under the legacy arrayPpgRawData field name. Its
    // duration argument is milliseconds (unlike the iOS SDK's seconds value).
    enqueueVendorCommands(
      listOf(
        BleSDK.SetDeviceMeasurementWithType(AutoTestMode.AutoHRV, ecgMeasurementDurationMs, true),
        BleSDK.setECGRealtimeDuringHRVEnabled(true),
      ),
      promise,
    )
  }

  @ReactMethod
  fun stopEcgMeasurement(promise: Promise) {
    enqueueVendorCommands(
      listOf(
        BleSDK.SetDeviceMeasurementWithType(AutoTestMode.AutoHRV, ecgMeasurementDurationMs, false),
        BleSDK.setECGRealtimeDuringHRVEnabled(false),
      ),
      promise,
    )
  }

  @ReactMethod
  fun exitEcgMeasurement(promise: Promise) {
    // Android has no additional exit command for the contact ECG workflow.
    promise.resolve(true)
  }

  @ReactMethod
  fun startPpgMeasurement(promise: Promise) {
    // Optical PPG is the vendor's dedicated 0x78 blood-glucose/PPG workflow.
    // Do not start AutoHRV or 0x07 here: those commands enable contact ECG.
    enqueueVendorCommand(BleSDK.ppgWithMode(1, 0), promise)
  }

  @ReactMethod
  fun stopPpgMeasurement(promise: Promise) {
    enqueueVendorCommand(BleSDK.ppgWithMode(3, 0), promise)
  }

  @ReactMethod
  fun exitPpgMeasurement(promise: Promise) {
    enqueueVendorCommand(BleSDK.ppgWithMode(5, 0), promise)
  }

  @ReactMethod
  fun requestTotalActivity(mode: Int, startDate: String, promise: Promise) {
    enqueueVendorCommand(BleSDK.GetTotalActivityDataWithMode(mode.toByte(), startDate), promise)
  }

  @ReactMethod
  fun requestDetailActivity(mode: Int, startDate: String, promise: Promise) {
    enqueueVendorCommand(BleSDK.GetDetailActivityDataWithMode(mode.toByte(), startDate), promise)
  }

  @ReactMethod
  fun requestSleep(mode: Int, startDate: String, promise: Promise) {
    enqueueVendorCommand(BleSDK.GetDetailSleepDataWithMode(mode.toByte(), startDate), promise)
  }

  @ReactMethod
  fun requestDynamicHR(mode: Int, startDate: String, promise: Promise) {
    enqueueVendorCommand(BleSDK.GetDynamicHRWithMode(mode.toByte(), startDate), promise)
  }

  @ReactMethod
  fun requestStaticHR(mode: Int, startDate: String, promise: Promise) {
    enqueueVendorCommand(BleSDK.GetStaticHRWithMode(mode.toByte(), startDate), promise)
  }

  @ReactMethod
  fun requestHRV(mode: Int, startDate: String, promise: Promise) {
    enqueueVendorCommand(BleSDK.GetHRVDataWithMode(mode.toByte(), startDate), promise)
  }

  @ReactMethod
  fun requestSpo2(mode: Int, startDate: String, promise: Promise) {
    enqueueVendorCommand(BleSDK.Oxygen_data(mode.toByte(), startDate), promise)
  }

  @ReactMethod
  fun requestTemperature(mode: Int, startDate: String, promise: Promise) {
    enqueueVendorCommand(BleSDK.GetTemperature_historyData(mode.toByte(), startDate), promise)
  }

  @SuppressLint("MissingPermission")
  private fun enqueueVendorCommand(command: ByteArray?, promise: Promise) {
    enqueueVendorCommands(listOf(command), promise)
  }

  @SuppressLint("MissingPermission")
  private fun enqueueVendorCommands(commands: List<ByteArray?>, promise: Promise) {
    if (commands.any { it == null }) {
      promise.reject("CMD_EMPTY", "Vendor command is empty")
      return
    }
    if (bluetoothGatt == null || writeCharacteristic == null) {
      promise.reject(
        "NOT_READY",
        "The hand band connection is not ready. Wait a moment and try again.",
      )
      return
    }
    commands.filterNotNull().forEach(writeQueue::offer)
    processWriteQueue()
    promise.resolve(true)
  }

  @SuppressLint("MissingPermission")
  private fun processWriteQueue() {
    if (writeInFlight) return
    val gatt = bluetoothGatt
    val characteristic = writeCharacteristic
    if (gatt == null || characteristic == null) {
      return
    }
    val command = writeQueue.poll() ?: return
    characteristic.value = command
    lastWrite = command
    lastRetryCount = 0
    writeInFlight = true
    val ok = gatt.writeCharacteristic(characteristic)
    if (!ok) {
      writeInFlight = false
      writeQueue.offer(command)
    }
  }

  private fun looksLikeHandBand(device: BluetoothDevice?, record: ScanRecord?): Boolean {
    val name = (device?.name ?: "").lowercase()
    if (name.contains("v8") || name.contains("jstyle") || name.contains("band")) {
      return true
    }

    val uuids = record?.serviceUuids ?: return false
    return uuids.any { parcelUuid ->
      val uuid = parcelUuid.uuid.toString().lowercase()
      uuid == serviceUuid.toString().lowercase() || uuid.contains("0000fff0")
    }
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val device = result.device ?: return
      if (!looksLikeHandBand(device, result.scanRecord)) return
      emitScanCandidate(device, result.rssi)
    }
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      when (newState) {
        BluetoothProfile.STATE_CONNECTED -> {
          activeDeviceId = gatt.device.address
          emitConnection("connected", activeDeviceId)
          gatt.discoverServices()
        }
        BluetoothProfile.STATE_DISCONNECTED -> {
          emitConnection("disconnected", activeDeviceId ?: gatt.device.address)
          activeDeviceId = null
        }
        else -> Unit
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      val service: BluetoothGattService? = gatt.getService(serviceUuid)
      writeCharacteristic = service?.getCharacteristic(writeUuid)
      notifyCharacteristic = service?.getCharacteristic(notifyUuid)

      val notify = notifyCharacteristic ?: return
      gatt.setCharacteristicNotification(notify, true)
      val descriptor: BluetoothGattDescriptor? = notify.getDescriptor(cccUuid)
      descriptor?.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
      descriptor?.let { gatt.writeDescriptor(it) }
    }

    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      val value = characteristic.value ?: return
      emitAndroidEcgResultIfPresent(value)
      BleSDK.DataParsingWithData(value, object : DataListener2301 {
        override fun dataCallback(data: MutableMap<String, Any>?) {
          val map = Arguments.createMap()
          map.putString("type", "parsed")
          if (data != null) {
            map.putMap("payload", mapToWritable(data))
          }
          emit("V8Data", map)
        }

        override fun dataCallback(data: ByteArray?) {
          val map = Arguments.createMap()
          map.putString("type", "raw")
          map.putString("payloadHex", data?.joinToString("") { byte -> "%02X".format(byte) } ?: "")
          emit("V8Data", map)
        }
      })
    }

    override fun onCharacteristicWrite(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int,
    ) {
      if (status == BluetoothGatt.GATT_SUCCESS) {
        writeInFlight = false
        processWriteQueue()
        return
      }

      val retry = lastWrite
      if (retry != null && lastRetryCount < maxWriteRetry) {
        lastRetryCount += 1
        writeQueue.offerFirst(retry)
      }
      writeInFlight = false
      processWriteQueue()
    }
  }
}
