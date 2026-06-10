#if targetEnvironment(simulator)
import Foundation
import CoreBluetooth
import React

@objc(PillBoxBridgeModule)
final class PillBoxBridgeModule: RCTEventEmitter {
  private let scanEvent = "PillBoxScanResult"
  private let connectionEvent = "PillBoxConnectionState"
  private let snapshotEvent = "PillBoxSnapshot"
  private let medicationEvent = "PillBoxMedication"
  private let scanStateEvent = "PillBoxScanState"

  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String]! {
    [scanEvent, connectionEvent, snapshotEvent, medicationEvent, scanStateEvent]
  }

  @objc(startScan:rejecter:)
  func startScan(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(true)
  }

  @objc(stopScan:rejecter:)
  func stopScan(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(true)
  }

  @objc(connect:rejecter:resolver:)
  func connect(_ deviceId: String, rejecter reject: RCTPromiseRejectBlock, resolver resolve: RCTPromiseResolveBlock) {
    resolve(true)
  }

  @objc(disconnect:rejecter:)
  func disconnect(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(true)
  }

  @objc(refreshSnapshot:rejecter:)
  func refreshSnapshot(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(true)
  }

  @objc(getCachedSnapshot:rejecter:)
  func getCachedSnapshot(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(NSNull())
  }

  @objc(getState:rejecter:)
  func getState(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(["state": "unsupported"])
  }

  @objc(setAlarm:time:enabled:repeatDays:remark:resolver:rejecter:)
  func setAlarm(
    _ slot: NSNumber,
    time: String,
    enabled: Bool,
    repeatDays: [NSNumber],
    remark: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(true)
  }

  @objc(setTimeFormat:resolver:rejecter:)
  func setTimeFormat(_ timeFormat: NSNumber, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(true)
  }

  @objc(setVolume:resolver:rejecter:)
  func setVolume(_ volume: NSNumber, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(true)
  }

  @objc(setRingType:resolver:rejecter:)
  func setRingType(_ ringType: NSNumber, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(true)
  }

  @objc(setReminderDuration:resolver:rejecter:)
  func setReminderDuration(_ duration: NSNumber, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(true)
  }

  @objc(unbind:rejecter:)
  func unbind(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(true)
  }
}

#else
import Foundation
import CoreBluetooth
import React
import LNBoxSDK

@objc(PillBoxBridgeModule)
final class PillBoxBridgeModule: RCTEventEmitter {
  private let scanEvent = "PillBoxScanResult"
  private let connectionEvent = "PillBoxConnectionState"
  private let snapshotEvent = "PillBoxSnapshot"
  private let medicationEvent = "PillBoxMedication"
  private let scanStateEvent = "PillBoxScanState"

  private var hasListeners = false
  private var seenPeripherals: [String: CBPeripheral] = [:]
  private var activePeripheralId: String?
  private var lastSnapshot: [String: Any] = [:]

  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String]! {
    [scanEvent, connectionEvent, snapshotEvent, medicationEvent, scanStateEvent]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  override init() {
    super.init()
    installCallbacks()
  }

  private func installCallbacks() {
    LNBoxSDK.setBlockOnDeviceDidUpdateState { [weak self] box in
      guard let self else { return }
      let snapshot = self.serializeBox(box)
      self.lastSnapshot = snapshot
      self.activePeripheralId = box.identifier.isEmpty ? self.activePeripheralId : box.identifier
      self.emit(self.snapshotEvent, snapshot)
      self.emit(self.connectionEvent, [
        "state": self.connectionStateName(box.state),
        "deviceId": box.identifier.isEmpty ? (self.activePeripheralId ?? NSNull()) : box.identifier,
        "box": snapshot,
      ])
    }

    LNBoxSDK.setBlockOnUpdateMedication { [weak self] medication in
      guard let self else { return }
      self.emit(self.medicationEvent, medication)
    }
  }

  private func emit(_ event: String, _ body: [String: Any]) {
    guard hasListeners else { return }
    sendEvent(withName: event, body: body)
  }

  private func reject(_ reject: RCTPromiseRejectBlock, code: String, message: String) {
    reject(code, message, nil)
  }

  private func connectionStateName(_ state: LNBoxState) -> String {
    switch state {
    case .bluetoothNone:
      return "unsupported"
    case .bluetoothUnauthorized:
      return "unauthorized"
    case .bluetoothPowerOff:
      return "powerOff"
    case .bluetoothReady:
      return "ready"
    case .scanning:
      return "scanning"
    case .connecting:
      return "connecting"
    case .connected:
      return "connected"
    case .dataSyncing:
      return "dataSyncing"
    case .dataSynced:
      return "dataSynced"
    }
  }

  private func boxStateString() -> String {
    connectionStateName(LNBoxSDK.getBoxState())
  }

  private func serializeBox(_ box: LNBox) -> [String: Any] {
    let alarms = box.alarms.map { serializeAlarm($0) }
    return [
      "state": connectionStateName(box.state),
      "deviceId": box.deviceId,
      "name": box.name,
      "nickName": box.nickName,
      "patientName": box.patientName,
      "identifier": box.identifier,
      "firmwareVersion": box.firmwareVersion,
      "duration": box.duration,
      "timeFormat": box.timeFormat,
      "ring": box.ring,
      "volume": box.volume,
      "batteryStatus": box.batteryStatus,
      "batteryPower": box.batteryPower,
      "nextPutDrugTime": box.nextPutDrugTime,
      "nextAlarmTime": box.nextAlarmTime ?? NSNull(),
      "nextAlarmDate": box.nextAlarmDate ?? NSNull(),
      "alarms": alarms,
    ]
  }

  private func serializeAlarm(_ alarm: LNAlarmModel) -> [String: Any] {
    [
      "alarmId": alarm.alarmId,
      "status": alarm.status,
      "isRepeat": alarm.isRepeat,
      "row": alarm.row,
      "alarmTime": alarm.alarmTime,
      "remark": alarm.remark,
      "effectWeekdays": alarm.effectWeekdays,
      "type": alarm.type as Any,
      "drugCount": alarm.drugCount,
      "drugNumCount": alarm.drugNumCount,
      "isOpen": alarm.isOpen,
      "deviceId": alarm.deviceId,
      "hasImage": alarm.hasImage,
    ]
  }

  @objc(startScan:rejecter:)
  func startScan(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    seenPeripherals.removeAll()
    emit(scanStateEvent, ["state": "scanning"])
    LNBoxSDK.cancelScan()
    LNBoxSDK.doScan { [weak self] peripheral in
      guard let self else { return }
      let deviceId = peripheral.identifier.uuidString
      self.seenPeripherals[deviceId] = peripheral
      self.emit(self.scanEvent, [
        "id": deviceId,
        "name": peripheral.name as Any,
        "localName": peripheral.name as Any,
        "rssi": NSNull(),
      ])
    }
    resolve(true)
  }

  @objc(stopScan:rejecter:)
  func stopScan(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    LNBoxSDK.cancelScan()
    emit(scanStateEvent, ["state": "idle"])
    resolve(true)
  }

  @objc(connect:rejecter:resolver:)
  func connect(_ deviceId: String, rejecter reject: RCTPromiseRejectBlock, resolver resolve: RCTPromiseResolveBlock) {
    guard let peripheral = seenPeripherals[deviceId] else {
      reject("NOT_FOUND", "Peripheral not found. Scan first.", nil)
      return
    }

    activePeripheralId = deviceId
    emit(connectionEvent, ["state": "connecting", "deviceId": deviceId])
    LNBoxSDK.connectWithPeripheral(peripheral: peripheral, successBlock: { [weak self] box in
      guard let self else { return }
      let snapshot = self.serializeBox(box)
      self.lastSnapshot = snapshot
      self.activePeripheralId = box.identifier.isEmpty ? deviceId : box.identifier
      self.emit(self.connectionEvent, [
        "state": "connected",
        "deviceId": self.activePeripheralId ?? deviceId,
        "box": snapshot,
      ])
      self.emit(self.snapshotEvent, snapshot)
    }, failureBlock: { [weak self] error in
      guard let self else { return }
      self.emit(self.connectionEvent, [
        "state": "error",
        "deviceId": deviceId,
        "message": error.errorDescription,
      ])
    })
    resolve(true)
  }

  @objc(disconnect:rejecter:)
  func disconnect(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    LNBoxSDK.doDisconnect()
    let currentId = activePeripheralId ?? ""
    activePeripheralId = nil
    emit(connectionEvent, [
      "state": "disconnected",
      "deviceId": currentId.isEmpty ? NSNull() : currentId,
    ])
    resolve(true)
  }

  @objc(refreshSnapshot:rejecter:)
  func refreshSnapshot(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    if !lastSnapshot.isEmpty {
      emit(snapshotEvent, lastSnapshot)
    }
    resolve(true)
  }

  @objc(getCachedSnapshot:rejecter:)
  func getCachedSnapshot(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(lastSnapshot.isEmpty ? NSNull() : lastSnapshot)
  }

  @objc(getState:rejecter:)
  func getState(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(["state": boxStateString()])
  }

  @objc(setAlarm:time:enabled:repeatDays:remark:resolver:rejecter:)
  func setAlarm(
    _ slot: NSNumber,
    time: String,
    enabled: Bool,
    repeatDays: [NSNumber],
    remark: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard !activePeripheralId.isNilOrEmpty || !lastSnapshot.isEmpty else {
      reject("NOT_CONNECTED", "Pill dispenser is not connected.", nil)
      return
    }

    let dict: [String: Any] = [
      "alarmId": UUID().uuidString,
      "status": enabled ? 1 : 0,
      "isRepeat": repeatDays.isEmpty ? 0 : 1,
      "row": slot.intValue,
      "alarmTime": time,
      "remark": remark,
      "effectWeekdays": repeatDays.map { String($0.intValue) },
      "drugCount": 0,
      "drugNumCount": Float(0),
      "isOpen": enabled,
      "deviceId": activePeripheralId ?? "",
      "hasImage": false,
    ]
    let alarm = LNAlarmModel(dict: dict)
    LNBoxSDK.setupAlarm(alarm: alarm)
    resolve(true)
  }

  @objc(setTimeFormat:resolver:rejecter:)
  func setTimeFormat(_ timeFormat: NSNumber, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let value = LNBoxTimeFormat(rawValue: timeFormat.intValue) ?? .H24
    LNBoxSDK.setUpTimeFormat(timeFormat: value)
    resolve(true)
  }

  @objc(setVolume:resolver:rejecter:)
  func setVolume(_ volume: NSNumber, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let value = LNBoxVolumeType(rawValue: volume.intValue) ?? .mute
    LNBoxSDK.setUpVolume(volume: value)
    resolve(true)
  }

  @objc(setRingType:resolver:rejecter:)
  func setRingType(_ ringType: NSNumber, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let value = LNBoxRingType(rawValue: ringType.intValue) ?? .value1
    LNBoxSDK.setupRingType(ringType: value)
    resolve(true)
  }

  @objc(setReminderDuration:resolver:rejecter:)
  func setReminderDuration(_ duration: NSNumber, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    LNBoxSDK.setupRemindTime(duration: duration.intValue)
    resolve(true)
  }

  @objc(unbind:rejecter:)
  func unbind(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    LNBoxSDK.unBindDeviceBox()
    activePeripheralId = nil
    emit(connectionEvent, ["state": "disconnected"])
    resolve(true)
  }
}

#endif

private extension Optional where Wrapped == String {
  var isNilOrEmpty: Bool {
    switch self {
    case .none:
      return true
    case .some(let value):
      return value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
  }
}
