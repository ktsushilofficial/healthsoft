package `in`.healthsoftcare.seniorcare.pillbox

import android.app.Application
import android.bluetooth.BluetoothGatt
import android.content.Context
import android.os.Build
import com.clj.fastble.data.BleDevice
import com.clj.fastble.exception.BleException
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.xm.xjh.blelibrary.bean.Battery
import com.xm.xjh.blelibrary.bean.ClockBean
import com.xm.xjh.blelibrary.bean.ParamBean
import com.xm.xjh.blelibrary.bean.TakeDrugBean
import com.xm.xjh.blelibrary.listener.PillBoxConnectListener
import com.xm.xjh.blelibrary.listener.PillBoxParamsCallbackListener
import com.xm.xjh.blelibrary.listener.PillBoxScanCallbackListener
import com.xm.xjh.blelibrary.listener.PillBoxWriteCallBack
import com.xm.xjh.blelibrary.listener.SettingAlarmCallbackListener
import java.util.LinkedHashMap
import java.util.UUID

class PillBoxModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val seenDevices = LinkedHashMap<String, BleDevice>()
  private var activeDeviceMac: String? = null
  private var lastSnapshot: MutableMap<String, Any?> = mutableMapOf()

  override fun getName(): String = "PillBoxBridgeModule"

  init {
    if (reactContext.applicationContext is Application) {
      // App-level init happens in MainApplication, this is just a defensive no-op.
    }
    registerConnectListener()
  }

  private fun emit(event: String, map: WritableMap) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, map)
  }

  private fun emit(event: String, payload: Map<String, Any?>) {
    emit(event, toWritableMap(payload))
  }

  private fun toWritableMap(payload: Map<String, Any?>): WritableMap {
    val map = Arguments.createMap()
    payload.forEach { (key, value) ->
      when (value) {
        null -> map.putNull(key)
        is String -> map.putString(key, value)
        is Boolean -> map.putBoolean(key, value)
        is Int -> map.putInt(key, value)
        is Long -> map.putDouble(key, value.toDouble())
        is Float -> map.putDouble(key, value.toDouble())
        is Double -> map.putDouble(key, value)
        is Map<*, *> -> {
          @Suppress("UNCHECKED_CAST")
          map.putMap(key, toWritableMap(value as Map<String, Any?>))
        }
        is Iterable<*> -> {
          val array = Arguments.createArray()
          value.forEach { item ->
            when (item) {
              null -> array.pushNull()
              is String -> array.pushString(item)
              is Boolean -> array.pushBoolean(item)
              is Int -> array.pushInt(item)
              is Long -> array.pushDouble(item.toDouble())
              is Float -> array.pushDouble(item.toDouble())
              is Double -> array.pushDouble(item)
              is Map<*, *> -> {
                @Suppress("UNCHECKED_CAST")
                array.pushMap(toWritableMap(item as Map<String, Any?>))
              }
              else -> array.pushString(item.toString())
            }
          }
          map.putArray(key, array)
        }
        else -> map.putString(key, value.toString())
      }
    }
    return map
  }

  private fun deviceKey(device: BleDevice?): String? {
    if (device == null) return null
    val mac = device.mac?.trim()
    if (!mac.isNullOrEmpty()) return mac.uppercase()
    val name = device.name?.trim()
    if (!name.isNullOrEmpty()) return name
    return null
  }

  private fun serializeDevice(device: BleDevice?): Map<String, Any?> {
    return mapOf(
      "id" to (deviceKey(device) ?: ""),
      "name" to device?.name,
      "localName" to device?.name,
      "mac" to device?.mac,
    )
  }

  private fun serializeClock(clock: ClockBean): Map<String, Any?> {
    val repeatDays = try {
      clock.repeatArray?.toList()?.map { it.toString() } ?: emptyList()
    } catch (_: Throwable) {
      val raw = clock.effect_time?.split(',')?.map { it.trim() } ?: emptyList()
      raw.filter { it.isNotEmpty() }
    }

    return mapOf(
      "alarmId" to clock.uid,
      "status" to clock.status,
      "row" to clock.row,
      "alarmTime" to clock.alarm_time,
      "remark" to clock.remark,
      "effectWeekdays" to repeatDays,
      "isOpen" to clock.isOpen(),
      "deviceId" to clock.bluetoothMac,
      "repeat" to clock.repeat,
      "effectTime" to clock.effect_time,
      "batteryVolume" to clock.battery_volume,
      "battery" to clock.battery,
    )
  }

  private fun serializeBattery(battery: Battery): Map<String, Any?> {
    return mapOf(
      "percent" to battery.percent,
      "state" to battery.state,
    )
  }

  private fun serializeParam(param: ParamBean): Map<String, Any?> {
    return mapOf(
      "batteryVolume" to param.battery_volume,
      "battery" to param.battery,
      "firmwareVersion" to param.firmware_version,
      "timeFormat" to param.time_format,
      "alarmRing" to param.alarm_ring,
      "alarmVoice" to param.alarm_voice,
      "alarmClockDuration" to param.alarm_clock_duration,
      "alarms" to (param.alarm_clock?.map { serializeClock(it) } ?: emptyList<Map<String, Any?>>()),
    )
  }

  private fun serializeDrug(drug: TakeDrugBean, label: String): Map<String, Any?> {
    return mapOf(
      "id" to drug.id,
      "row" to drug.row,
      "deviceMac" to drug.mDevice_mac,
      "alarmTime" to drug.alarm_time,
      "drugTime" to drug.drug_time,
      "date" to drug.date,
      "month" to drug.month,
      "year" to drug.year,
      "status" to drug.status,
      "accessToken" to drug.access_token,
      "label" to label,
    )
  }

  private fun serializeSnapshotFromParam(param: ParamBean): MutableMap<String, Any?> {
    return mutableMapOf(
      "state" to "connected",
      "firmwareVersion" to param.firmware_version,
      "timeFormat" to param.time_format,
      "ring" to param.alarm_ring,
      "volume" to param.alarm_voice,
      "duration" to param.alarm_clock_duration,
      "batteryVolume" to param.battery_volume,
      "battery" to param.battery,
      "alarms" to (param.alarm_clock?.map { serializeClock(it) } ?: emptyList<Map<String, Any?>>()),
    )
  }

  private fun refreshSnapshotFromDevice() {
    PillBoxSdkBridge.pillBox().getPillBoxParams(object : PillBoxParamsCallbackListener {
      override fun onPillBoxBaseParamsCallback(mPillBoxParamBean: ParamBean) {
        lastSnapshot.putAll(serializeSnapshotFromParam(mPillBoxParamBean))
        emit("PillBoxSnapshot", serializeParam(mPillBoxParamBean))
      }

      override fun onPillBoxClockParamsCallback(clockBeanList: List<ClockBean>) {
        val alarms = clockBeanList.map { serializeClock(it) }
        lastSnapshot["alarms"] = alarms
        emit("PillBoxSnapshot", mapOf("kind" to "alarms", "alarms" to alarms))
      }

      override fun onPillBoxDrugParamsCallback(mDrugBean: TakeDrugBean, mStr: String) {
        emit("PillBoxMedication", serializeDrug(mDrugBean, mStr))
      }

      override fun onPillBoxBatteryParamsCallback(battery: Battery) {
        val batteryMap = serializeBattery(battery)
        lastSnapshot["batteryPercent"] = battery.percent
        lastSnapshot["batteryState"] = battery.state
        emit("PillBoxSnapshot", mapOf("kind" to "battery", "battery" to batteryMap))
      }
    })
  }

  private fun registerConnectListener() {
    PillBoxSdkBridge.pillBox().pillBoxConnectListener(object : PillBoxConnectListener {
      override fun onPillBoxStartConnect(bleDevice: BleDevice) {
        emit("PillBoxConnectionState", mapOf("state" to "connecting", "deviceId" to (deviceKey(bleDevice) ?: "")))
      }

      override fun onPillBoxConnectFail(bleDevice: BleDevice, exception: BleException) {
        activeDeviceMac = null
        emit(
          "PillBoxConnectionState",
          mapOf(
            "state" to "error",
            "deviceId" to (deviceKey(bleDevice) ?: ""),
            "message" to (exception.description ?: "Connection failed"),
          ),
        )
      }

      override fun onPillBoxConnectSuccess(bleDevice: BleDevice, gatt: BluetoothGatt, status: Int) {
        val deviceId = deviceKey(bleDevice) ?: ""
        activeDeviceMac = bleDevice.mac ?: activeDeviceMac
        lastSnapshot["deviceId"] = deviceId
        lastSnapshot["name"] = bleDevice.name
        lastSnapshot["state"] = "connected"
        emit(
          "PillBoxConnectionState",
          mapOf(
            "state" to "connected",
            "deviceId" to deviceId,
            "device" to serializeDevice(bleDevice),
          ),
        )
      }

      override fun onPillBoxInitDataSuccess(bleDevice: BleDevice, gatt: BluetoothGatt, status: Int) {
        val deviceId = deviceKey(bleDevice) ?: ""
        lastSnapshot["state"] = "dataSynced"
        emit(
          "PillBoxConnectionState",
          mapOf(
            "state" to "dataSynced",
            "deviceId" to deviceId,
            "device" to serializeDevice(bleDevice),
          ),
        )
        refreshSnapshotFromDevice()
      }

      override fun onPillBoxDisConnected(
        isActiveDisConnected: Boolean,
        device: BleDevice,
        gatt: BluetoothGatt,
        status: Int,
      ) {
        val deviceId = deviceKey(device) ?: ""
        if (activeDeviceMac != null && activeDeviceMac.equals(device.mac, ignoreCase = true)) {
          activeDeviceMac = null
        }
        lastSnapshot["state"] = "disconnected"
        emit(
          "PillBoxConnectionState",
          mapOf(
            "state" to "disconnected",
            "deviceId" to deviceId,
            "isActive" to isActiveDisConnected,
          ),
        )
      }
    })
  }

  private fun ensureConnectedOrThrow(promise: Promise): Boolean {
    if (activeDeviceMac.isNullOrBlank() && lastSnapshot["state"] != "connected" && lastSnapshot["state"] != "dataSynced") {
      promise.reject("NOT_CONNECTED", "Pill dispenser is not connected.")
      return false
    }
    return true
  }

  @com.facebook.react.bridge.ReactMethod
  fun startScan(promise: Promise) {
    try {
      seenDevices.clear()
      emit("PillBoxScanState", mapOf("state" to "scanning"))
      PillBoxSdkBridge.pillBox().initBlueScanRule(15_000, false).initPillBoxScan(object : PillBoxScanCallbackListener {
        override fun onPillBoxScanFinished(scanResultList: MutableList<BleDevice>) {
          scanResultList.forEach { device ->
            deviceKey(device)?.let { seenDevices[it] = device }
          }
          emit(
            "PillBoxScanState",
            mapOf(
              "state" to "idle",
              "results" to scanResultList.map { serializeDevice(it) },
            ),
          )
        }

        override fun onPillBoxScanStarted(success: Boolean) {
          if (!success) {
            emit("PillBoxScanState", mapOf("state" to "error", "message" to "Bluetooth is off or unavailable"))
          } else {
            emit("PillBoxScanState", mapOf("state" to "scanning"))
          }
        }

        override fun onPillBoxScanning(bleDevice: BleDevice?) {
          val device = bleDevice ?: return
          val key = deviceKey(device) ?: return
          seenDevices[key] = device
          emit("PillBoxScanResult", serializeDevice(device))
        }
      })
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("SCAN_FAILED", error.message, error)
    }
  }

  @com.facebook.react.bridge.ReactMethod
  fun stopScan(promise: Promise) {
    try {
      com.clj.fastble.BleManager.getInstance().cancelScan()
      emit("PillBoxScanState", mapOf("state" to "idle"))
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("STOP_SCAN_FAILED", error.message, error)
    }
  }

  @com.facebook.react.bridge.ReactMethod
  fun connect(deviceId: String, promise: Promise) {
    val device = seenDevices[deviceId.uppercase()] ?: seenDevices[deviceId] ?: seenDevices.values.firstOrNull {
      it.mac.equals(deviceId, ignoreCase = true)
    }
    if (device == null) {
      promise.reject("NOT_FOUND", "Peripheral not found. Scan first.")
      return
    }

    try {
      activeDeviceMac = device.mac
      PillBoxSdkBridge.pillBox().onPillBoxConnect(device)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("CONNECT_FAILED", error.message, error)
    }
  }

  @com.facebook.react.bridge.ReactMethod
  fun disconnect(promise: Promise) {
    try {
      val mac = activeDeviceMac
      if (mac.isNullOrBlank()) {
        promise.resolve(true)
        return
      }
      PillBoxSdkBridge.pillBox().onPillBoxDisConnect(mac)
      activeDeviceMac = null
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("DISCONNECT_FAILED", error.message, error)
    }
  }

  @com.facebook.react.bridge.ReactMethod
  fun refreshSnapshot(promise: Promise) {
    try {
      if (!ensureConnectedOrThrow(promise)) return
      refreshSnapshotFromDevice()
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("REFRESH_FAILED", error.message, error)
    }
  }

  @com.facebook.react.bridge.ReactMethod
  fun getCachedSnapshot(promise: Promise) {
    promise.resolve(if (lastSnapshot.isEmpty()) null else toWritableMap(lastSnapshot))
  }

  @com.facebook.react.bridge.ReactMethod
  fun getState(promise: Promise) {
    promise.resolve(mapOf("state" to (lastSnapshot["state"] ?: "disconnected")))
  }

  @com.facebook.react.bridge.ReactMethod
  fun setAlarm(
    slot: Int,
    time: String,
    enabled: Boolean,
    repeatDays: ReadableArray?,
    remark: String,
    promise: Promise,
  ) {
    try {
      if (!ensureConnectedOrThrow(promise)) return
      val days = mutableListOf<Int>()
      repeatDays?.let {
        for (i in 0 until it.size()) {
          days.add(it.getInt(i))
        }
      }
      val dayArray = days.toIntArray()
      PillBoxSdkBridge.controlManager().addAlarmClock(
        reactContext,
        slot,
        time,
        enabled,
        dayArray,
        object : SettingAlarmCallbackListener {
          override fun onSettingAlarmSuccess(mClock: ClockBean) {
            val alarmMap = serializeClock(mClock)
            lastSnapshot["alarms"] = (lastSnapshot["alarms"] as? List<Map<String, Any?>>)?.toMutableList()?.apply {
              val index = indexOfFirst { (it["row"] as? Int) == mClock.row }
              if (index >= 0) {
                this[index] = alarmMap
              } else {
                add(alarmMap)
              }
            } ?: mutableListOf(alarmMap)
            emit("PillBoxSnapshot", mapOf("kind" to "alarm", "alarm" to alarmMap, "remark" to remark))
            promise.resolve(true)
          }

          override fun onSettingAlarmFail(exception: String) {
            promise.reject("SET_ALARM_FAILED", exception)
          }
        },
      )
    } catch (error: Throwable) {
      promise.reject("SET_ALARM_FAILED", error.message, error)
    }
  }

  @com.facebook.react.bridge.ReactMethod
  fun setTimeFormat(timeFormat: Int, promise: Promise) {
    try {
      if (!ensureConnectedOrThrow(promise)) return
      PillBoxSdkBridge.controlManager().setPillBoxTimeFormat(reactContext, timeFormat.toString(), object : PillBoxWriteCallBack<Any> {
        override fun onPillBoxResponseSuccess(responseData: Any) {
          lastSnapshot["timeFormat"] = timeFormat.toString()
          emit("PillBoxSnapshot", mapOf("kind" to "timeFormat", "timeFormat" to timeFormat))
          promise.resolve(true)
        }

        override fun onPillBoxWriteFailure(exception: BleException) {
          promise.reject("SET_TIME_FORMAT_FAILED", exception.description)
        }
      })
    } catch (error: Throwable) {
      promise.reject("SET_TIME_FORMAT_FAILED", error.message, error)
    }
  }

  @com.facebook.react.bridge.ReactMethod
  fun setVolume(volume: Int, promise: Promise) {
    try {
      if (!ensureConnectedOrThrow(promise)) return
      PillBoxSdkBridge.controlManager().setPillBoxVoiceMaxAndMin(reactContext, volume.toString(), object : PillBoxWriteCallBack<Any> {
        override fun onPillBoxResponseSuccess(responseData: Any) {
          lastSnapshot["volume"] = volume
          emit("PillBoxSnapshot", mapOf("kind" to "volume", "volume" to volume))
          promise.resolve(true)
        }

        override fun onPillBoxWriteFailure(exception: BleException) {
          promise.reject("SET_VOLUME_FAILED", exception.description)
        }
      })
    } catch (error: Throwable) {
      promise.reject("SET_VOLUME_FAILED", error.message, error)
    }
  }

  @com.facebook.react.bridge.ReactMethod
  fun setRingType(ringType: Int, promise: Promise) {
    try {
      if (!ensureConnectedOrThrow(promise)) return
      PillBoxSdkBridge.controlManager().setPillBoxClockVoice(reactContext, ringType.toString(), object : PillBoxWriteCallBack<Any> {
        override fun onPillBoxResponseSuccess(responseData: Any) {
          lastSnapshot["ring"] = ringType
          emit("PillBoxSnapshot", mapOf("kind" to "ring", "ring" to ringType))
          promise.resolve(true)
        }

        override fun onPillBoxWriteFailure(exception: BleException) {
          promise.reject("SET_RING_FAILED", exception.description)
        }
      })
    } catch (error: Throwable) {
      promise.reject("SET_RING_FAILED", error.message, error)
    }
  }

  @com.facebook.react.bridge.ReactMethod
  fun setReminderDuration(duration: Int, promise: Promise) {
    try {
      if (!ensureConnectedOrThrow(promise)) return
      PillBoxSdkBridge.controlManager().setPillBoxClockRemindTime(reactContext, duration.toString(), object : PillBoxWriteCallBack<Any> {
        override fun onPillBoxResponseSuccess(responseData: Any) {
          lastSnapshot["duration"] = duration
          emit("PillBoxSnapshot", mapOf("kind" to "duration", "duration" to duration))
          promise.resolve(true)
        }

        override fun onPillBoxWriteFailure(exception: BleException) {
          promise.reject("SET_DURATION_FAILED", exception.description)
        }
      })
    } catch (error: Throwable) {
      promise.reject("SET_DURATION_FAILED", error.message, error)
    }
  }

  @com.facebook.react.bridge.ReactMethod
  fun unbind(promise: Promise) {
    try {
      PillBoxSdkBridge.controlManager().unBindPillBox(reactContext, 0, object : PillBoxWriteCallBack<Any> {
        override fun onPillBoxResponseSuccess(responseData: Any) {
          activeDeviceMac = null
          lastSnapshot["state"] = "disconnected"
          emit("PillBoxConnectionState", mapOf("state" to "disconnected"))
          promise.resolve(true)
        }

        override fun onPillBoxWriteFailure(exception: BleException) {
          promise.reject("UNBIND_FAILED", exception.description)
        }
      })
    } catch (error: Throwable) {
      promise.reject("UNBIND_FAILED", error.message, error)
    }
  }
}
