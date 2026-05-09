#import "V8BleModule.h"
#import <CoreBluetooth/CoreBluetooth.h>
#import <V8SDK/BleSDK_V8.h>
#import <V8SDK/DeviceData_V8.h>

static NSString * const kV8ScanEvent = @"V8ScanResult";
static NSString * const kV8ConnectionEvent = @"V8ConnectionState";
static NSString * const kV8DataEvent = @"V8Data";

@interface V8BleModule () <CBCentralManagerDelegate, CBPeripheralDelegate>
@property(nonatomic, strong) CBCentralManager *central;
@property(nonatomic, strong) NSMutableDictionary<NSString *, CBPeripheral *> *seenPeripherals;
@property(nonatomic, strong) CBPeripheral *activePeripheral;
@property(nonatomic, strong) CBCharacteristic *writeCharacteristic;
@property(nonatomic, strong) CBCharacteristic *notifyCharacteristic;
@property(nonatomic, assign) BOOL hasListeners;
@property(nonatomic, strong) NSMutableArray<NSData *> *writeQueue;
@property(nonatomic, strong) NSData *lastWrite;
@property(nonatomic, assign) BOOL writeInFlight;
@property(nonatomic, assign) NSInteger lastRetryCount;
@end

@implementation V8BleModule

RCT_EXPORT_MODULE();

- (instancetype)init {
  if (self = [super init]) {
    _seenPeripherals = [NSMutableDictionary new];
    dispatch_queue_t queue = dispatch_get_main_queue();
    _central = [[CBCentralManager alloc] initWithDelegate:self queue:queue];
    _writeQueue = [NSMutableArray new];
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[kV8ScanEvent, kV8ConnectionEvent, kV8DataEvent];
}

- (void)startObserving {
  self.hasListeners = YES;
}

- (void)stopObserving {
  self.hasListeners = NO;
}

- (BOOL)requiresMainQueueSetup {
  return YES;
}

- (void)emitEvent:(NSString *)name body:(NSDictionary *)body {
  if (!self.hasListeners) return;
  [self sendEventWithName:name body:body];
}

- (void)emitConnection:(NSString *)state deviceId:(NSString *)deviceId {
  NSMutableDictionary *body = [NSMutableDictionary dictionaryWithObject:state forKey:@"state"];
  if (deviceId.length > 0) {
    body[@"deviceId"] = deviceId;
  }
  [self emitEvent:kV8ConnectionEvent body:body];
}

RCT_REMAP_METHOD(startScan,
                 startScanWithNameFilters:(NSArray<NSString *> *)nameFilters
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (self.central.state != CBManagerStatePoweredOn) {
    reject(@"BLE_OFF", @"Bluetooth is off", nil);
    return;
  }

  [self.seenPeripherals removeAllObjects];
  [self.central scanForPeripheralsWithServices:nil options:@{CBCentralManagerScanOptionAllowDuplicatesKey: @NO}];
  resolve(@YES);
}

RCT_REMAP_METHOD(stopScan,
                 stopScanWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  [self.central stopScan];
  resolve(@YES);
}

RCT_REMAP_METHOD(connect,
                 connectWithDeviceId:(NSString *)deviceId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  CBPeripheral *peripheral = self.seenPeripherals[deviceId];
  if (!peripheral) {
    reject(@"NOT_FOUND", @"Peripheral not found. Scan first.", nil);
    return;
  }

  self.activePeripheral = peripheral;
  self.activePeripheral.delegate = self;
  [self emitConnection:@"connecting" deviceId:deviceId];
  [self.central connectPeripheral:peripheral options:nil];
  resolve(@YES);
}

RCT_REMAP_METHOD(disconnect,
                 disconnectWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *deviceId = self.activePeripheral.identifier.UUIDString;
  if (self.activePeripheral) {
    [self.central cancelPeripheralConnection:self.activePeripheral];
  }
  self.writeCharacteristic = nil;
  self.notifyCharacteristic = nil;
  self.activePeripheral = nil;
  [self emitConnection:@"disconnected" deviceId:deviceId];
  resolve(@YES);
}

RCT_REMAP_METHOD(requestDeviceVersion,
                 requestDeviceVersionWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSData *cmd = [[BleSDK_V8 sharedManager] GetDeviceVersion];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(requestBattery,
                 requestBatteryWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSData *cmd = [[BleSDK_V8 sharedManager] GetDeviceBatteryLevel];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(requestDeviceMac,
                 requestDeviceMacWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSData *cmd = [[BleSDK_V8 sharedManager] GetDeviceMacAddress];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(requestDeviceName,
                 requestDeviceNameWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  reject(@"NOT_SUPPORTED", @"GetDeviceName is not exposed by this iOS vendor SDK build.", nil);
}

RCT_REMAP_METHOD(setDeviceName,
                 setDeviceNameWithValue:(NSString *)name
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  reject(@"NOT_SUPPORTED", @"SetDeviceName is not exposed by this iOS vendor SDK build.", nil);
}

RCT_REMAP_METHOD(setDeviceId,
                 setDeviceIdWithValue:(NSString *)deviceId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  reject(@"NOT_SUPPORTED", @"SetDeviceID is not exposed by this iOS vendor SDK build.", nil);
}

RCT_REMAP_METHOD(requestDeviceTime,
                 requestDeviceTimeWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSData *cmd = [[BleSDK_V8 sharedManager] GetDeviceTime];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(syncDeviceTime,
                 syncDeviceTimeWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSDateComponents *components = [[NSCalendar currentCalendar]
      components:(NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay |
                  NSCalendarUnitHour | NSCalendarUnitMinute | NSCalendarUnitSecond)
      fromDate:[NSDate date]];
  MyDeviceTime_V8 dt;
  dt.year = (int)components.year;
  dt.month = (int)components.month;
  dt.day = (int)components.day;
  dt.hour = (int)components.hour;
  dt.minute = (int)components.minute;
  dt.second = (int)components.second;
  NSData *cmd = [[BleSDK_V8 sharedManager] SetDeviceTime:dt];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(requestPersonalInfo,
                 requestPersonalInfoWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSData *cmd = [[BleSDK_V8 sharedManager] GetPersonalInfo];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(setPersonalInfo,
                 setPersonalInfoWithSex:(nonnull NSNumber *)sex
                 age:(nonnull NSNumber *)age
                 height:(nonnull NSNumber *)height
                 weight:(nonnull NSNumber *)weight
                 stepLength:(nonnull NSNumber *)stepLength
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  MyPersonalInfo_V8 info;
  info.gender = [sex intValue];
  info.age = [age intValue];
  info.height = [height intValue];
  info.weight = [weight intValue];
  info.stride = [stepLength intValue];
  NSData *cmd = [[BleSDK_V8 sharedManager] SetPersonalInfo:info];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(setRealtimeStepEnabled,
                 setRealtimeStepEnabledWithEnabled:(BOOL)enabled
                 includeTemperature:(BOOL)includeTemperature
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSData *cmd = [[BleSDK_V8 sharedManager] RealTimeDataWithType:(enabled ? 1 : 0)];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(requestTotalActivity,
                 requestTotalActivityWithMode:(nonnull NSNumber *)mode
                 startDateEpochMs:(nonnull NSNumber *)startDateEpochMs
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:([startDateEpochMs doubleValue] / 1000.0)];
  NSData *cmd = [[BleSDK_V8 sharedManager] GetTotalActivityDataWithMode:[mode intValue] withStartDate:date];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(requestDetailActivity,
                 requestDetailActivityWithMode:(nonnull NSNumber *)mode
                 startDateEpochMs:(nonnull NSNumber *)startDateEpochMs
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:([startDateEpochMs doubleValue] / 1000.0)];
  NSData *cmd = [[BleSDK_V8 sharedManager] GetDetailActivityDataWithMode:[mode intValue] withStartDate:date];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(requestSleep,
                 requestSleepWithMode:(nonnull NSNumber *)mode
                 startDateEpochMs:(nonnull NSNumber *)startDateEpochMs
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:([startDateEpochMs doubleValue] / 1000.0)];
  NSData *cmd = [[BleSDK_V8 sharedManager] GetDetailSleepDataWithMode:[mode intValue] withStartDate:date];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(requestDynamicHR,
                 requestDynamicHRWithMode:(nonnull NSNumber *)mode
                 startDateEpochMs:(nonnull NSNumber *)startDateEpochMs
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:([startDateEpochMs doubleValue] / 1000.0)];
  NSData *cmd = [[BleSDK_V8 sharedManager] GetContinuousHRDataWithMode:[mode intValue] withStartDate:date];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(requestStaticHR,
                 requestStaticHRWithMode:(nonnull NSNumber *)mode
                 startDateEpochMs:(nonnull NSNumber *)startDateEpochMs
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:([startDateEpochMs doubleValue] / 1000.0)];
  NSData *cmd = [[BleSDK_V8 sharedManager] GetSingleHRDataWithMode:[mode intValue] withStartDate:date];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(requestHRV,
                 requestHRVWithMode:(nonnull NSNumber *)mode
                 startDateEpochMs:(nonnull NSNumber *)startDateEpochMs
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:([startDateEpochMs doubleValue] / 1000.0)];
  NSData *cmd = [[BleSDK_V8 sharedManager] GetHRVDataWithMode:[mode intValue] withStartDate:date];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(requestSpo2,
                 requestSpo2WithMode:(nonnull NSNumber *)mode
                 startDateEpochMs:(nonnull NSNumber *)startDateEpochMs
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:([startDateEpochMs doubleValue] / 1000.0)];
  NSData *cmd = [[BleSDK_V8 sharedManager] GetAutomaticSpo2DataWithMode:[mode intValue] withStartDate:date];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(requestTemperature,
                 requestTemperatureWithMode:(nonnull NSNumber *)mode
                 startDateEpochMs:(nonnull NSNumber *)startDateEpochMs
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSDate *date = [NSDate dateWithTimeIntervalSince1970:([startDateEpochMs doubleValue] / 1000.0)];
  NSData *cmd = [[BleSDK_V8 sharedManager] GetTemperatureDataWithMode:[mode intValue] withStartDate:date];
  [self enqueueCommand:cmd resolver:resolve rejecter:reject];
}

- (void)enqueueCommand:(NSData *)cmd
            resolver:(RCTPromiseResolveBlock)resolve
            rejecter:(RCTPromiseRejectBlock)reject {
  if (cmd.length == 0) {
    reject(@"CMD_EMPTY", @"Vendor command is empty.", nil);
    return;
  }
  if (!self.activePeripheral || !self.writeCharacteristic) {
    reject(@"NOT_CONNECTED", @"V8 device is not connected.", nil);
    return;
  }
  [self.writeQueue addObject:cmd];
  [self processWriteQueue];
  resolve(@YES);
}

- (void)processWriteQueue {
  if (self.writeInFlight || !self.activePeripheral || !self.writeCharacteristic) return;
  if (self.writeQueue.count == 0) return;
  NSData *cmd = self.writeQueue.firstObject;
  [self.writeQueue removeObjectAtIndex:0];
  self.lastWrite = cmd;
  self.lastRetryCount = 0;
  self.writeInFlight = YES;
  [self.activePeripheral writeValue:cmd
                  forCharacteristic:self.writeCharacteristic
                               type:CBCharacteristicWriteWithResponse];
}

- (BOOL)looksLikeV8:(CBPeripheral *)peripheral {
  NSString *name = [peripheral.name lowercaseString];
  if (name.length > 0 &&
      ([name containsString:@"v8"] || [name containsString:@"jstyle"] || [name containsString:@"band"])) {
    return YES;
  }
  return NO;
}

#pragma mark - CBCentralManagerDelegate

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
  // State is checked during calls.
}

- (void)centralManager:(CBCentralManager *)central
 didDiscoverPeripheral:(CBPeripheral *)peripheral
     advertisementData:(NSDictionary<NSString *, id> *)advertisementData
                  RSSI:(NSNumber *)RSSI {
  BOOL matchedByName = [self looksLikeV8:peripheral];
  BOOL matchedByService = NO;
  NSArray<CBUUID *> *serviceUUIDs = advertisementData[CBAdvertisementDataServiceUUIDsKey];
  for (CBUUID *uuid in serviceUUIDs) {
    NSString *uuidString = [uuid.UUIDString lowercaseString];
    if ([uuidString isEqualToString:@"fff0"] ||
        [uuidString containsString:@"0000fff0"]) {
      matchedByService = YES;
      break;
    }
  }
  if (!matchedByName && !matchedByService) return;

  NSString *deviceId = peripheral.identifier.UUIDString;
  self.seenPeripherals[deviceId] = peripheral;

  [self emitEvent:kV8ScanEvent body:@{
    @"id": deviceId ?: @"",
    @"name": peripheral.name ?: [NSNull null],
    @"localName": peripheral.name ?: [NSNull null],
    @"rssi": RSSI ?: @0
  }];
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
  [self emitConnection:@"connected" deviceId:peripheral.identifier.UUIDString];
  [peripheral discoverServices:nil];
}

- (void)centralManager:(CBCentralManager *)central
didDisconnectPeripheral:(CBPeripheral *)peripheral
                 error:(NSError *)error {
  [self emitConnection:@"disconnected" deviceId:peripheral.identifier.UUIDString];
  if (self.activePeripheral == peripheral) {
    self.activePeripheral = nil;
    self.writeCharacteristic = nil;
    self.notifyCharacteristic = nil;
  }
}

- (void)centralManager:(CBCentralManager *)central
 didFailToConnectPeripheral:(CBPeripheral *)peripheral
                  error:(NSError *)error {
  [self emitConnection:@"error" deviceId:peripheral.identifier.UUIDString];
}

#pragma mark - CBPeripheralDelegate

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error {
  if (error) return;
  CBUUID *serviceUUID = [CBUUID UUIDWithString:@"FFF0"];

  for (CBService *service in peripheral.services) {
    if (![service.UUID isEqual:serviceUUID]) continue;
    [peripheral discoverCharacteristics:nil forService:service];
  }
}

- (void)peripheral:(CBPeripheral *)peripheral
didDiscoverCharacteristicsForService:(CBService *)service
             error:(NSError *)error {
  if (error) return;

  CBUUID *writeUUID = [CBUUID UUIDWithString:@"FFF6"];
  CBUUID *notifyUUID = [CBUUID UUIDWithString:@"FFF7"];

  for (CBCharacteristic *characteristic in service.characteristics) {
    if ([characteristic.UUID isEqual:writeUUID]) {
      self.writeCharacteristic = characteristic;
    } else if ([characteristic.UUID isEqual:notifyUUID]) {
      self.notifyCharacteristic = characteristic;
      [peripheral setNotifyValue:YES forCharacteristic:characteristic];
    }
  }
}

- (NSString *)hexStringFromData:(NSData *)data {
  const unsigned char *dataBuffer = (const unsigned char *)data.bytes;
  if (!dataBuffer) return @"";
  NSUInteger dataLength = data.length;
  NSMutableString *hexString = [NSMutableString stringWithCapacity:(dataLength * 2)];
  for (NSInteger i = 0; i < dataLength; i++) {
    [hexString appendFormat:@"%02X", dataBuffer[i]];
  }
  return [hexString copy];
}

- (void)peripheral:(CBPeripheral *)peripheral
didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic
             error:(NSError *)error {
  if (error || characteristic.value.length == 0) return;

  NSData *value = characteristic.value;
  DeviceData_V8 *parsed = [[BleSDK_V8 sharedManager] DataParsingWithData:value];
  NSMutableDictionary *body = [NSMutableDictionary new];

  if (parsed) {
    body[@"type"] = @"parsed";
    body[@"payload"] = @{
      @"dataType": @((int)parsed.dataType).stringValue,
      @"dataEnd": @(parsed.dataEnd),
      @"dicData": parsed.dicData ?: @[]
    };
  } else {
    body[@"type"] = @"raw";
    body[@"payloadHex"] = [self hexStringFromData:value];
  }

  [self emitEvent:kV8DataEvent body:body];
}

- (void)peripheral:(CBPeripheral *)peripheral
didWriteValueForCharacteristic:(CBCharacteristic *)characteristic
             error:(NSError *)error {
  if (error != nil) {
    if (self.lastWrite && self.lastRetryCount < 2) {
      self.lastRetryCount += 1;
      [self.writeQueue insertObject:self.lastWrite atIndex:0];
    }
  }
  self.writeInFlight = NO;
  [self processWriteQueue];
}

@end
