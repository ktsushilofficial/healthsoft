#import "PillDispenserBridge.h"

#import <CoreBluetooth/CoreBluetooth.h>
#import <React/RCTLog.h>

#import <BlufiLibrary/BlufiClient.h>

@interface PillDispenserBridge () <CBCentralManagerDelegate, CBPeripheralDelegate, BlufiDelegate>
@property(nonatomic, strong) CBCentralManager *central;
@property(nonatomic, strong) NSMutableDictionary<NSString *, CBPeripheral *> *seenPeripherals;
@property(nonatomic, strong) NSArray<NSString *> *scanNameFilters;
@property(nonatomic, strong) BlufiClient *blufiClient;
@property(nonatomic, strong) NSString *activeDeviceId;
@property(nonatomic, assign) BOOL hasListeners;
@property(nonatomic, strong) NSTimer *scanStopTimer;
@end

@implementation PillDispenserBridge

RCT_EXPORT_MODULE();

- (instancetype)init {
  if (self = [super init]) {
    _seenPeripherals = [NSMutableDictionary new];
    _scanNameFilters = @[];
    _central = [[CBCentralManager alloc] initWithDelegate:self queue:dispatch_get_main_queue()];
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[
    @"PillDispenserScanResult",
    @"PillDispenserConnectionState",
    @"PillDispenserLog",
    @"PillDispenserStatus",
    @"PillDispenserVersion",
    @"PillDispenserWifiScan",
    @"PillDispenserCustomData",
    @"PillDispenserError"
  ];
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
  [self sendEventWithName:name body:body ?: @{}];
}

- (void)emitLog:(NSString *)message {
  [self emitEvent:@"PillDispenserLog" body:@{@"message": message ?: @""}];
}

- (void)emitConnection:(NSString *)state deviceId:(NSString *)deviceId {
  NSMutableDictionary *body = [@{@"state": state ?: @"unknown"} mutableCopy];
  if (deviceId.length > 0) {
    body[@"deviceId"] = deviceId;
  }
  [self emitEvent:@"PillDispenserConnectionState" body:body];
}

- (void)emitError:(NSString *)code message:(NSString *)message {
  [self emitEvent:@"PillDispenserError" body:@{
    @"code": code ?: @"UNKNOWN",
    @"message": message ?: @"Unknown BluFi error",
  }];
}

- (NSString *)stringForPeripheral:(CBPeripheral *)peripheral advertisementData:(NSDictionary<NSString *, id> *)advertisementData {
  NSString *name = peripheral.name;
  if (name.length > 0) return name;
  NSString *localName = advertisementData[CBAdvertisementDataLocalNameKey];
  if ([localName isKindOfClass:[NSString class]] && ((NSString *)localName).length > 0) {
    return (NSString *)localName;
  }
  return @"";
}

- (BOOL)isLikelyBluFiName:(NSString *)name {
  NSString *lower = [[name ?: @"" lowercaseString] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (lower.length == 0) return NO;
  if (self.scanNameFilters.count == 0) return YES;
  for (NSString *filter in self.scanNameFilters) {
    NSString *normalizedFilter = [[filter ?: @"" lowercaseString] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (normalizedFilter.length > 0 && [lower containsString:normalizedFilter]) {
      return YES;
    }
  }
  return NO;
}

- (void)stopScanTimer {
  [self.scanStopTimer invalidate];
  self.scanStopTimer = nil;
}

RCT_REMAP_METHOD(startScan,
                 startScanWithNameFilters:(NSArray<NSString *> * _Nullable)nameFilters
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (self.central.state != CBManagerStatePoweredOn) {
    NSString *reason = @"Bluetooth is unavailable";
    switch (self.central.state) {
      case CBManagerStatePoweredOff: reason = @"Bluetooth is off"; break;
      case CBManagerStateUnauthorized: reason = @"Bluetooth permission is not granted"; break;
      case CBManagerStateUnsupported: reason = @"Bluetooth is unsupported on this device"; break;
      case CBManagerStateResetting: reason = @"Bluetooth is resetting"; break;
      case CBManagerStateUnknown:
      default: break;
    }
    reject(@"BLE_UNAVAILABLE", reason, nil);
    return;
  }

  NSMutableArray<NSString *> *normalized = [NSMutableArray array];
  for (id item in nameFilters ?: @[]) {
    if (![item isKindOfClass:[NSString class]]) continue;
    NSString *trimmed = [[(NSString *)item lowercaseString] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (trimmed.length > 0) {
      [normalized addObject:trimmed];
    }
  }
  if (normalized.count > 0) {
    self.scanNameFilters = [normalized copy];
  } else {
    self.scanNameFilters = @[];
  }

  [self.seenPeripherals removeAllObjects];
  [self stopScanTimer];
  [self.central stopScan];
  [self.central scanForPeripheralsWithServices:nil options:@{CBCentralManagerScanOptionAllowDuplicatesKey: @NO}];
  self.scanStopTimer = [NSTimer scheduledTimerWithTimeInterval:15.0 target:self selector:@selector(stopScanFromTimer) userInfo:nil repeats:NO];
  resolve(@YES);
}

- (void)stopScanFromTimer {
  [self.central stopScan];
  [self stopScanTimer];
}

RCT_REMAP_METHOD(stopScan,
                 stopScanWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  [self.central stopScan];
  [self stopScanTimer];
  resolve(@YES);
}

- (BlufiClient *)ensureClient {
  if (!self.blufiClient) {
    self.blufiClient = [[BlufiClient alloc] init];
    self.blufiClient.blufiDelegate = self;
    self.blufiClient.centralManagerDelete = self;
    self.blufiClient.peripheralDelegate = self;
    self.blufiClient.postPackageLengthLimit = 128;
  }
  return self.blufiClient;
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

  if (self.blufiClient) {
    [self.blufiClient close];
    self.blufiClient = nil;
  }
  [self stopScanTimer];
  [self.central stopScan];
  self.activeDeviceId = deviceId;
  [self emitConnection:@"connecting" deviceId:deviceId];
  [[self ensureClient] connect:deviceId];
  resolve(@YES);
}

RCT_REMAP_METHOD(disconnect,
                 disconnectWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (self.blufiClient) {
    [self.blufiClient requestCloseConnection];
    [self.blufiClient close];
    self.blufiClient = nil;
  }
  if (self.activeDeviceId.length > 0) {
    [self emitConnection:@"disconnected" deviceId:self.activeDeviceId];
  }
  self.activeDeviceId = nil;
  resolve(@YES);
}

RCT_REMAP_METHOD(requestCloseConnection,
                 requestCloseConnectionWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (self.blufiClient) {
    [self.blufiClient requestCloseConnection];
  }
  resolve(@YES);
}

RCT_REMAP_METHOD(negotiateSecurity,
                 negotiateSecurityWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (!self.blufiClient) {
    reject(@"NOT_CONNECTED", @"Connect to a device before negotiating security.", nil);
    return;
  }
  [self.blufiClient negotiateSecurity];
  resolve(@YES);
}

RCT_REMAP_METHOD(requestDeviceVersion,
                 requestDeviceVersionWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (!self.blufiClient) {
    reject(@"NOT_CONNECTED", @"Connect to a device before requesting version.", nil);
    return;
  }
  [self.blufiClient requestDeviceVersion];
  resolve(@YES);
}

RCT_REMAP_METHOD(requestDeviceStatus,
                 requestDeviceStatusWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (!self.blufiClient) {
    reject(@"NOT_CONNECTED", @"Connect to a device before requesting status.", nil);
    return;
  }
  [self.blufiClient requestDeviceStatus];
  resolve(@YES);
}

RCT_REMAP_METHOD(requestDeviceScan,
                 requestDeviceScanWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (!self.blufiClient) {
    reject(@"NOT_CONNECTED", @"Connect to a device before requesting Wi-Fi scan.", nil);
    return;
  }
  [self.blufiClient requestDeviceScan];
  resolve(@YES);
}

RCT_REMAP_METHOD(postCustomData,
                 postCustomDataWithBase64:(NSString *)base64
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (!self.blufiClient) {
    reject(@"NOT_CONNECTED", @"Connect to a device before posting custom data.", nil);
    return;
  }
  NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 options:NSDataBase64DecodingIgnoreUnknownCharacters];
  if (!data) {
    reject(@"INVALID_DATA", @"Custom data must be base64 encoded.", nil);
    return;
  }
  [self.blufiClient postCustomData:data];
  resolve(@YES);
}

RCT_REMAP_METHOD(configureStation,
                 configureStationWithSsid:(NSString *)ssid
                 password:(NSString *)password
                 bssid:(NSString * _Nullable)bssid
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  if (!self.blufiClient) {
    reject(@"NOT_CONNECTED", @"Connect to a device before configuring Wi-Fi.", nil);
    return;
  }
  BlufiConfigureParams *params = [[BlufiConfigureParams alloc] init];
  params.opMode = OpModeSta;
  params.staSsid = ssid ?: @"";
  params.staPassword = password ?: @"";
  params.staBssid = bssid ?: @"";
  [self.blufiClient configure:params];
  resolve(@YES);
}

- (void)emitStatusResponse:(BlufiStatusResponse *)response status:(BlufiStatusCode)status {
  NSMutableDictionary *body = [@{
    @"status": @(status),
  } mutableCopy];
  if (response) {
    body[@"opMode"] = @(response.opMode);
    body[@"softApSecurity"] = @(response.softApSecurity);
    body[@"softApConnectionCount"] = @(response.softApConnectionCount);
    body[@"softApMaxConnection"] = @(response.softApMaxConnection);
    body[@"softApChannel"] = @(response.softApChannel);
    body[@"softApPassword"] = response.softApPassword ?: @"";
    body[@"softApSsid"] = response.softApSsid ?: @"";
    body[@"staConnectionStatus"] = @(response.staConnectionStatus);
    body[@"staBssid"] = response.staBssid ?: @"";
    body[@"staSsid"] = response.staSsid ?: @"";
    body[@"staPassword"] = response.staPassword ?: @"";
  }
  [self emitEvent:@"PillDispenserStatus" body:body];
}

- (void)emitVersionResponse:(BlufiVersionResponse *)response status:(BlufiStatusCode)status {
  NSMutableDictionary *body = [@{@"status": @(status)} mutableCopy];
  if (response) {
    body[@"versionString"] = [response getVersionString] ?: @"";
    body[@"bigVer"] = @(response.bigVer);
    body[@"smallVer"] = @(response.smallVer);
  }
  [self emitEvent:@"PillDispenserVersion" body:body];
}

- (void)emitWifiScanResponse:(NSArray<BlufiScanResponse *> *)scanResults status:(BlufiStatusCode)status {
  NSMutableArray *results = [NSMutableArray array];
  for (BlufiScanResponse *response in scanResults ?: @[]) {
    [results addObject:@{
      @"ssid": response.ssid ?: @"",
      @"rssi": @(response.rssi),
      @"type": @(response.type)
    }];
  }
  [self emitEvent:@"PillDispenserWifiScan" body:@{
    @"status": @(status),
    @"results": results,
  }];
}

- (void)blufi:(BlufiClient *)client gattPrepared:(BlufiStatusCode)status service:(nullable CBService *)service writeChar:(nullable CBCharacteristic *)writeChar notifyChar:(nullable CBCharacteristic *)notifyChar {
  if (status == StatusSuccess && service && writeChar && notifyChar) {
    [self emitConnection:@"connected" deviceId:self.activeDeviceId ?: @""];
    [self emitLog:@"BluFi GATT prepared"];
  } else {
    [self emitError:@"GATT_PREPARE_FAILED" message:@"Failed to prepare BluFi GATT connection."];
    [self emitConnection:@"error" deviceId:self.activeDeviceId ?: @""];
  }
}

- (BOOL)blufi:(BlufiClient *)client gattNotification:(NSData *)data packageType:(PackageType)pkgType subType:(SubType)subType {
  if (data.length == 0) return NO;
  NSString *base64 = [data base64EncodedStringWithOptions:0];
  NSString *utf8 = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
  [self emitEvent:@"PillDispenserCustomData" body:@{
    @"dataBase64": base64,
    @"dataUtf8": utf8,
    @"packageType": @(pkgType),
    @"subType": @(subType)
  }];
  return NO;
}

- (void)blufi:(BlufiClient *)client didReceiveError:(NSInteger)errCode {
  [self emitError:@"BLUFI_ERROR" message:[NSString stringWithFormat:@"BluFi error code %ld", (long)errCode]];
}

- (void)blufi:(BlufiClient *)client didNegotiateSecurity:(BlufiStatusCode)status {
  [self emitEvent:@"PillDispenserLog" body:@{@"message": status == StatusSuccess ? @"BluFi security negotiation complete" : @"BluFi security negotiation failed"}];
}

- (void)blufi:(BlufiClient *)client didPostConfigureParams:(BlufiStatusCode)status {
  [self emitEvent:@"PillDispenserLog" body:@{@"message": status == StatusSuccess ? @"BluFi configuration posted" : @"BluFi configuration failed"}];
}

- (void)blufi:(BlufiClient *)client didReceiveDeviceVersionResponse:(nullable BlufiVersionResponse *)response status:(BlufiStatusCode)status {
  [self emitVersionResponse:response status:status];
}

- (void)blufi:(BlufiClient *)client didReceiveDeviceStatusResponse:(nullable BlufiStatusResponse *)response status:(BlufiStatusCode)status {
  [self emitStatusResponse:response status:status];
}

- (void)blufi:(BlufiClient *)client didReceiveDeviceScanResponse:(nullable NSArray<BlufiScanResponse *> *)scanResults status:(BlufiStatusCode)status {
  [self emitWifiScanResponse:scanResults status:status];
}

- (void)blufi:(BlufiClient *)client didPostCustomData:(NSData *)data status:(BlufiStatusCode)status {
  [self emitEvent:@"PillDispenserCustomData" body:@{
    @"status": @(status),
    @"direction": @"sent",
    @"dataBase64": [data base64EncodedStringWithOptions:0] ?: @""
  }];
}

- (void)blufi:(BlufiClient *)client didReceiveCustomData:(NSData *)data status:(BlufiStatusCode)status {
  [self emitEvent:@"PillDispenserCustomData" body:@{
    @"status": @(status),
    @"direction": @"received",
    @"dataBase64": [data base64EncodedStringWithOptions:0] ?: @"",
    @"dataUtf8": [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @""
  }];
}

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
  NSString *state = @"Unknown";
  switch (central.state) {
    case CBManagerStatePoweredOn: state = @"PoweredOn"; break;
    case CBManagerStatePoweredOff: state = @"PoweredOff"; break;
    case CBManagerStateUnauthorized: state = @"Unauthorized"; break;
    case CBManagerStateUnsupported: state = @"Unsupported"; break;
    case CBManagerStateResetting: state = @"Resetting"; break;
    case CBManagerStateUnknown:
    default: break;
  }
  [self emitEvent:@"PillDispenserLog" body:@{@"message": [NSString stringWithFormat:@"Bluetooth state: %@", state]}];
}

- (void)centralManager:(CBCentralManager *)central didDiscoverPeripheral:(CBPeripheral *)peripheral advertisementData:(NSDictionary<NSString *,id> *)advertisementData RSSI:(NSNumber *)RSSI {
  NSString *deviceId = peripheral.identifier.UUIDString;
  NSString *name = [self stringForPeripheral:peripheral advertisementData:advertisementData];
  if (deviceId.length == 0) return;

  BOOL isLikelyBluFi = [self isLikelyBluFiName:name];
  if (!isLikelyBluFi) {
    return;
  }

  self.seenPeripherals[deviceId] = peripheral;
  NSArray *serviceUUIDs = advertisementData[CBAdvertisementDataServiceUUIDsKey];
  NSMutableArray *uuidStrings = [NSMutableArray array];
  for (id item in serviceUUIDs ?: @[]) {
    if ([item respondsToSelector:@selector(UUIDString)]) {
      [uuidStrings addObject:[item UUIDString]];
    }
  }
  [self emitEvent:@"PillDispenserScanResult" body:@{
    @"id": deviceId,
    @"name": name ?: @"",
    @"localName": advertisementData[CBAdvertisementDataLocalNameKey] ?: @"",
    @"rssi": RSSI ?: @0,
    @"isConnectable": advertisementData[CBAdvertisementDataIsConnectable] ?: @NO,
    @"serviceUUIDs": uuidStrings,
    @"isLikelyBluFi": @(isLikelyBluFi),
  }];
}

// Unused CBCentralManagerDelegate methods retained for safety.
- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {}
- (void)centralManager:(CBCentralManager *)central didFailToConnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {}
- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
  if (self.activeDeviceId.length > 0) {
    [self emitConnection:@"disconnected" deviceId:self.activeDeviceId];
  }
  self.activeDeviceId = nil;
  self.blufiClient = nil;
}

// Unused CBPeripheralDelegate methods retained for safety.
- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error {}
- (void)peripheral:(CBPeripheral *)peripheral didDiscoverCharacteristicsForService:(CBService *)service error:(NSError *)error {}
- (void)peripheral:(CBPeripheral *)peripheral didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {}

@end
