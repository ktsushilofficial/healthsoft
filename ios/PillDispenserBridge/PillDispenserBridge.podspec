Pod::Spec.new do |s|
  s.name         = 'PillDispenserBridge'
  s.version      = '1.0.0'
  s.summary      = 'React Native bridge for pill dispenser devices'
  s.description  = 'Separate RN bridge for BluFi scanning, connection, and custom data.'
  s.homepage     = 'https://healthsoft.internal'
  s.license      = { :type => 'Commercial' }
  s.author       = { 'Healthsoft' => 'dev@healthsoft.invalid' }
  s.platform     = :ios, '13.0'
  s.source       = { :path => '.' }
  s.requires_arc = true
  s.source_files = 'Sources/**/*.{h,m}'
  s.dependency 'React-Core'
  s.dependency 'BlufiLibrary'
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '$(inherited) $(PODS_TARGET_SRCROOT)/../BlufiLibrary $(PODS_TARGET_SRCROOT)/../BlufiLibrary/Security/openssl/include'
  }
end
