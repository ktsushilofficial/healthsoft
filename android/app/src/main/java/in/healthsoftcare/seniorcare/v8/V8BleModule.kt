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
import com.jstyle.blesdkv8.model.MyDeviceTime
import com.jstyle.blesdkv8.model.MyPersonalInfo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.LinkedList
import java.util.Locale
import java.util.UUID

class V8BleModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

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

  private fun mapToWritable(map: Map<String, Any?>): WritableMap {
    val out = Arguments.createMap()
    map.forEach { (key, value) ->
      when (value) {
        null -> out.putNull(key)
        is String -> out.putString(key, value)
        is Int -> out.putInt(key, value)
        is Double -> out.putDouble(key, value)
        is Float -> out.putDouble(key, value.toDouble())
        is Boolean -> out.putBoolean(key, value)
        is Long -> out.putDouble(key, value.toDouble())
        else -> out.putString(key, value.toString())
      }
    }
    return out
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
    if (command == null) {
      promise.reject("CMD_EMPTY", "Vendor command is empty")
      return
    }
    writeQueue.offer(command)
    processWriteQueue()
    promise.resolve(true)
  }

  @SuppressLint("MissingPermission")
  private fun processWriteQueue() {
    if (writeInFlight) return
    val gatt = bluetoothGatt
    val characteristic = writeCharacteristic
    if (gatt == null || characteristic == null) {
      writeQueue.clear()
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
