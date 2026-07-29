#import "EspBlufiModule.h"
#import <CoreBluetooth/CoreBluetooth.h>
#import <TargetConditionals.h>

#if !TARGET_OS_SIMULATOR
#import <EspBlufi/BlufiClient.h>
#endif

static NSString * const EspBlufiDeviceFoundEvent = @"EspBlufiDeviceFound";
static NSString * const EspBlufiStateEvent = @"EspBlufiState";
static NSString * const EspBlufiWifiNetworksEvent = @"EspBlufiWifiNetworks";
static NSString * const EspBlufiWifiStatusEvent = @"EspBlufiWifiStatus";
static NSTimeInterval const EspBlufiConnectionTimeoutSeconds = 15.0;

#if TARGET_OS_SIMULATOR
@interface EspBlufiModule () <CBCentralManagerDelegate>
#else
@interface EspBlufiModule () <CBCentralManagerDelegate, BlufiDelegate>
#endif
@property(nonatomic, assign) BOOL hasListeners;
@property(nonatomic, strong) CBCentralManager *scanManager;
@property(nonatomic, strong) NSMutableDictionary<NSString *, CBPeripheral *> *discoveredPeripherals;
@property(nonatomic, strong) NSString *activeDeviceId;
@property(nonatomic, strong) NSString *provisioningSsid;
@property(nonatomic, strong) NSString *blufiVersion;
@property(nonatomic, assign) BOOL secureSessionReady;
@property(nonatomic, assign) BOOL compatibilityMode;
@property(nonatomic, assign) NSInteger statusCheckCount;
#if !TARGET_OS_SIMULATOR
@property(nonatomic, strong) BlufiClient *client;
#endif
@end

@implementation EspBlufiModule

RCT_EXPORT_MODULE();

- (instancetype)init {
  self = [super init];
  if (self) {
    _discoveredPeripherals = [NSMutableDictionary new];
    _scanManager = [[CBCentralManager alloc] initWithDelegate:self
                                                        queue:dispatch_get_main_queue()];
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[
    EspBlufiDeviceFoundEvent,
    EspBlufiStateEvent,
    EspBlufiWifiNetworksEvent,
    EspBlufiWifiStatusEvent
  ];
}

- (void)startObserving {
  self.hasListeners = YES;
}

- (void)stopObserving {
  self.hasListeners = NO;
}

- (void)emit:(NSString *)event body:(NSDictionary *)body {
  if (!self.hasListeners) return;
  [self sendEventWithName:event body:body];
}

- (void)emitState:(NSString *)state
         deviceId:(NSString *)deviceId
              ssid:(NSString *)ssid
           message:(NSString *)message {
  NSMutableDictionary *body = [NSMutableDictionary dictionaryWithObject:state forKey:@"state"];
  if (deviceId.length > 0) body[@"deviceId"] = deviceId;
  if (ssid.length > 0) body[@"ssid"] = ssid;
  if (message.length > 0) body[@"message"] = message;
  [self emit:EspBlufiStateEvent body:body];
}

- (void)rejectSimulator:(RCTPromiseRejectBlock)reject {
  reject(
    @"NOT_SUPPORTED",
    @"ESP-BluFi setup requires a physical iPhone because Bluetooth is unavailable in the iOS Simulator.",
    nil
  );
}

- (NSString *)bluetoothUnavailableReason {
  switch (self.scanManager.state) {
    case CBManagerStatePoweredOff:
      return @"Turn on Bluetooth to find the pill dispenser.";
    case CBManagerStateUnauthorized:
      return @"Bluetooth permission is required to find the pill dispenser.";
    case CBManagerStateUnsupported:
      return @"Bluetooth Low Energy is unsupported on this device.";
    case CBManagerStateResetting:
      return @"Bluetooth is resetting. Please try again.";
    case CBManagerStateUnknown:
    default:
      return @"Bluetooth is not ready yet. Please try again.";
  }
}

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
}

RCT_REMAP_METHOD(startScan,
                 startScanWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
#if TARGET_OS_SIMULATOR
  [self rejectSimulator:reject];
#else
  if (self.scanManager.state != CBManagerStatePoweredOn) {
    reject(@"BLE_UNAVAILABLE", [self bluetoothUnavailableReason], nil);
    return;
  }
  [self.discoveredPeripherals removeAllObjects];
  [self.scanManager stopScan];
  [self.scanManager scanForPeripheralsWithServices:nil
                                           options:@{CBCentralManagerScanOptionAllowDuplicatesKey: @NO}];
  [self emitState:@"scanning" deviceId:nil ssid:nil message:nil];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(12 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    if (self.scanManager.isScanning) {
      [self.scanManager stopScan];
      [self emitState:@"scanStopped" deviceId:nil ssid:nil message:nil];
    }
  });
  resolve(@YES);
#endif
}

RCT_REMAP_METHOD(stopScan,
                 stopScanWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  [self.scanManager stopScan];
  [self emitState:@"scanStopped" deviceId:nil ssid:nil message:nil];
  resolve(@YES);
}

RCT_REMAP_METHOD(connect,
                 connectWithDeviceId:(NSString *)deviceId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
#if TARGET_OS_SIMULATOR
  [self rejectSimulator:reject];
#else
  [self startConnection:deviceId
      compatibilityMode:NO
                resolver:resolve
                rejecter:reject];
#endif
}

RCT_REMAP_METHOD(connectCompatibility,
                 connectCompatibilityWithDeviceId:(NSString *)deviceId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
#if TARGET_OS_SIMULATOR
  [self rejectSimulator:reject];
#else
  [self startConnection:deviceId
      compatibilityMode:YES
                resolver:resolve
                rejecter:reject];
#endif
}

#if !TARGET_OS_SIMULATOR
- (void)startConnection:(NSString *)deviceId
      compatibilityMode:(BOOL)compatibilityMode
                resolver:(RCTPromiseResolveBlock)resolve
                rejecter:(RCTPromiseRejectBlock)reject {
  if (self.discoveredPeripherals[deviceId] == nil) {
    reject(@"DEVICE_NOT_FOUND", @"Scan again and select the pill dispenser.", nil);
    return;
  }

  [self.scanManager stopScan];
  [self.client close];
  self.client = [[BlufiClient alloc] init];
  self.client.centralManagerDelete = self;
  self.client.blufiDelegate = self;
  self.activeDeviceId = deviceId;
  self.provisioningSsid = nil;
  self.blufiVersion = nil;
  self.secureSessionReady = NO;
  self.compatibilityMode = compatibilityMode;
  self.statusCheckCount = 0;
  [self emitState:@"connecting" deviceId:deviceId ssid:nil message:nil];
  [self.client connect:deviceId];
  NSString *attemptedDeviceId = [deviceId copy];
  BlufiClient *attemptedClient = self.client;
  dispatch_after(
    dispatch_time(
      DISPATCH_TIME_NOW,
      (int64_t)(EspBlufiConnectionTimeoutSeconds * NSEC_PER_SEC)
    ),
    dispatch_get_main_queue(),
    ^{
      if (self.client == attemptedClient &&
          [self.activeDeviceId isEqualToString:attemptedDeviceId] &&
          !self.secureSessionReady) {
        [self.client close];
        self.client = nil;
        NSString *versionSuffix = self.blufiVersion.length > 0
          ? [NSString stringWithFormat:@" (BluFi %@)", self.blufiVersion]
          : @"";
        if (compatibilityMode) {
          [self emitState:@"error"
                 deviceId:attemptedDeviceId
                      ssid:nil
                   message:
                     @"The dispenser did not respond in BluFi compatibility mode. Its firmware may use a manufacturer-specific setup protocol."];
        } else {
          [self emitState:@"securityUnsupported"
                 deviceId:attemptedDeviceId
                      ssid:nil
                   message:[NSString stringWithFormat:
                     @"The dispenser connected%@, but did not answer the standard encrypted BluFi handshake.",
                     versionSuffix]];
        }
      }
    }
  );
  resolve(@YES);
}
#endif

RCT_REMAP_METHOD(disconnect,
                 disconnectWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
#if !TARGET_OS_SIMULATOR
  [self.client close];
  self.client = nil;
#endif
  [self.scanManager stopScan];
  self.secureSessionReady = NO;
  self.compatibilityMode = NO;
  self.provisioningSsid = nil;
  self.blufiVersion = nil;
  [self emitState:@"disconnected" deviceId:self.activeDeviceId ssid:nil message:nil];
  self.activeDeviceId = nil;
  resolve(@YES);
}

RCT_REMAP_METHOD(requestWifiScan,
                 requestWifiScanWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
#if TARGET_OS_SIMULATOR
  [self rejectSimulator:reject];
#else
  if (![self requireSecureClient:reject]) return;
  [self.client requestDeviceScan];
  resolve(@YES);
#endif
}

RCT_REMAP_METHOD(provision,
                 provisionWithSsid:(NSString *)ssid
                 password:(NSString *)password
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
#if TARGET_OS_SIMULATOR
  [self rejectSimulator:reject];
#else
  if (![self requireSecureClient:reject]) return;
  NSString *normalizedSsid =
    [ssid stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (normalizedSsid.length == 0) {
    reject(@"INVALID_SSID", @"Select or enter a Wi-Fi network name.", nil);
    return;
  }

  BlufiConfigureParams *params = [BlufiConfigureParams new];
  params.opMode = OpModeSta;
  params.staSsid = normalizedSsid;
  params.staPassword = password ?: @"";
  self.provisioningSsid = normalizedSsid;
  self.statusCheckCount = 0;
  [self emitState:@"provisioning"
         deviceId:self.activeDeviceId
              ssid:normalizedSsid
           message:nil];
  [self.client configure:params];
  resolve(@YES);
#endif
}

RCT_REMAP_METHOD(requestWifiStatus,
                 requestWifiStatusWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
#if TARGET_OS_SIMULATOR
  [self rejectSimulator:reject];
#else
  if (self.client == nil) {
    reject(@"NOT_CONNECTED", @"Connect to the pill dispenser first.", nil);
    return;
  }
  [self.client requestDeviceStatus];
  resolve(@YES);
#endif
}

#if !TARGET_OS_SIMULATOR
- (BOOL)requireSecureClient:(RCTPromiseRejectBlock)reject {
  if (self.client == nil) {
    reject(@"NOT_CONNECTED", @"Connect to the pill dispenser first.", nil);
    return NO;
  }
  if (!self.secureSessionReady) {
    reject(@"SESSION_NOT_READY", @"The encrypted BluFi session is not ready.", nil);
    return NO;
  }
  return YES;
}

- (void)scheduleStatusCheck {
  self.statusCheckCount += 1;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2.5 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    if (self.client != nil && self.provisioningSsid.length > 0) {
      [self.client requestDeviceStatus];
    }
  });
}

- (void)centralManager:(CBCentralManager *)central
 didDiscoverPeripheral:(CBPeripheral *)peripheral
     advertisementData:(NSDictionary<NSString *, id> *)advertisementData
                  RSSI:(NSNumber *)RSSI {
  NSString *name = advertisementData[CBAdvertisementDataLocalNameKey] ?: peripheral.name ?: @"";
  NSString *normalizedName = name.lowercaseString;
  NSArray<CBUUID *> *serviceUuids = advertisementData[CBAdvertisementDataServiceUUIDsKey] ?: @[];
  BOOL advertisesBluFi = [serviceUuids containsObject:[CBUUID UUIDWithString:@"FFFF"]];
  BOOL nameMatches =
    [normalizedName containsString:@"blufi"] ||
    [normalizedName containsString:@"pill"] ||
    [normalizedName containsString:@"dispenser"];
  NSNumber *connectable = advertisementData[CBAdvertisementDataIsConnectable] ?: @YES;

  NSString *identifier = peripheral.identifier.UUIDString;
  self.discoveredPeripherals[identifier] = peripheral;
  [self emit:EspBlufiDeviceFoundEvent
         body:@{
           @"id": identifier,
           @"name": name.length > 0 ? name : @"Nearby BLE device",
           @"rssi": RSSI ?: @(-127),
           @"isConnectable": connectable,
           @"isLikelyBluFi": @(advertisesBluFi || nameMatches)
         }];
}

- (void)centralManager:(CBCentralManager *)central
  didConnectPeripheral:(CBPeripheral *)peripheral {
  [self emitState:@"connected"
         deviceId:peripheral.identifier.UUIDString
              ssid:nil
           message:nil];
}

- (void)centralManager:(CBCentralManager *)central
didFailToConnectPeripheral:(CBPeripheral *)peripheral
                 error:(NSError *)error {
  [self emitState:@"error"
         deviceId:peripheral.identifier.UUIDString
              ssid:nil
           message:error.localizedDescription ?: @"Bluetooth connection failed."];
}

- (void)centralManager:(CBCentralManager *)central
didDisconnectPeripheral:(CBPeripheral *)peripheral
                 error:(NSError *)error {
  self.secureSessionReady = NO;
  [self emitState:@"disconnected"
         deviceId:peripheral.identifier.UUIDString
              ssid:nil
           message:error.localizedDescription];
}

- (void)blufi:(BlufiClient *)client
 gattPrepared:(BlufiStatusCode)status
      service:(CBService *)service
    writeChar:(CBCharacteristic *)writeChar
   notifyChar:(CBCharacteristic *)notifyChar {
  if (client != self.client) return;
  if (status != StatusSuccess) {
    [self emitState:@"error"
           deviceId:self.activeDeviceId
                ssid:nil
             message:@"The dispenser does not expose the expected BluFi service."];
    return;
  }
  [self emitState:@"connected" deviceId:self.activeDeviceId ssid:nil message:nil];
  if (self.compatibilityMode) {
    self.secureSessionReady = YES;
    [self emitState:@"compatible"
           deviceId:self.activeDeviceId
                ssid:nil
             message:nil];
  } else {
    [client negotiateSecurity];
  }
}

- (void)blufi:(BlufiClient *)client didNegotiateSecurity:(BlufiStatusCode)status {
  if (client != self.client) return;
  if (status == StatusSuccess) {
    self.secureSessionReady = YES;
    [self emitState:@"secure" deviceId:self.activeDeviceId ssid:nil message:nil];
  } else {
    self.secureSessionReady = NO;
    [self emitState:@"securityUnsupported"
           deviceId:self.activeDeviceId
                ssid:nil
             message:@"The dispenser rejected the standard encrypted BluFi handshake."];
  }
}

- (void)blufi:(BlufiClient *)client
didReceiveDeviceVersionResponse:(BlufiVersionResponse *)response
       status:(BlufiStatusCode)status {
  if (client != self.client) return;
  if (status == StatusSuccess && response != nil) {
    self.blufiVersion = [response getVersionString];
    NSLog(@"Healthsoft BluFi device protocol version: %@", self.blufiVersion);
  } else {
    NSLog(@"Healthsoft could not read BluFi device protocol version (code %ld)",
          (long)status);
  }
}

- (void)blufi:(BlufiClient *)client
didReceiveDeviceScanResponse:(NSArray<BlufiScanResponse *> *)scanResults
       status:(BlufiStatusCode)status {
  if (status != StatusSuccess) {
    [self emitState:@"error"
           deviceId:self.activeDeviceId
                ssid:nil
             message:@"The dispenser could not scan Wi-Fi networks."];
    return;
  }

  NSMutableArray *networks = [NSMutableArray new];
  for (BlufiScanResponse *response in scanResults) {
    if (response.ssid.length == 0) continue;
    [networks addObject:@{@"ssid": response.ssid, @"rssi": @(response.rssi)}];
  }
  [self emit:EspBlufiWifiNetworksEvent body:@{@"networks": networks}];
}

- (void)blufi:(BlufiClient *)client didPostConfigureParams:(BlufiStatusCode)status {
  if (status == StatusSuccess) {
    [self emitState:@"configured"
           deviceId:self.activeDeviceId
                ssid:self.provisioningSsid
             message:nil];
    self.statusCheckCount = 0;
    [self scheduleStatusCheck];
  } else {
    [self emitState:@"error"
           deviceId:self.activeDeviceId
                ssid:self.provisioningSsid
             message:[NSString stringWithFormat:
               @"The dispenser rejected the Wi-Fi settings (code %ld).",
               (long)status]];
  }
}

- (void)blufi:(BlufiClient *)client
didReceiveDeviceStatusResponse:(BlufiStatusResponse *)response
       status:(BlufiStatusCode)status {
  if (status != StatusSuccess || response == nil) {
    [self emit:EspBlufiWifiStatusEvent
           body:@{
             @"connected": @NO,
             @"statusCode": @(status),
             @"message": @"Could not read the dispenser's Wi-Fi status."
           }];
    return;
  }

  BOOL connected = response.isStaConnectWiFi;
  NSString *ssid = response.staSsid.length > 0 ? response.staSsid : self.provisioningSsid;
  NSMutableDictionary *body =
    [@{
      @"connected": @(connected),
      @"statusCode": @(response.staConnectionStatus),
      @"message": connected
        ? @"Pill dispenser joined Wi-Fi."
        : @"The dispenser is still connecting to Wi-Fi…"
    } mutableCopy];
  if (ssid.length > 0) body[@"ssid"] = ssid;
  [self emit:EspBlufiWifiStatusEvent body:body];

  if (connected) {
    [self emitState:@"wifiConnected"
           deviceId:self.activeDeviceId
                ssid:ssid
             message:nil];
  } else if (self.provisioningSsid.length > 0 && self.statusCheckCount < 5) {
    [self scheduleStatusCheck];
  }
}

- (void)blufi:(BlufiClient *)client didReceiveError:(NSInteger)errCode {
  [self emitState:@"error"
         deviceId:self.activeDeviceId
              ssid:nil
           message:[NSString stringWithFormat:
             @"BluFi communication error (code %ld).",
             (long)errCode]];
}
#endif

- (void)invalidate {
#if !TARGET_OS_SIMULATOR
  [self.client close];
  self.client = nil;
#endif
  [self.scanManager stopScan];
  self.scanManager.delegate = nil;
  self.scanManager = nil;
  [super invalidate];
}

@end
