Pod::Spec.new do |s|
  s.name = 'PillBoxBridge'
  s.version = '1.0.0'
  s.summary = 'React Native bridge for the pill dispenser SDK'
  s.description = 'Native bridge module for scanning, connection, alarms, and settings using the LNBoxSDK pill dispenser framework.'
  s.homepage = 'https://healthsoft.internal'
  s.license = { :type => 'Commercial' }
  s.author = { 'Healthsoft' => 'dev@healthsoft.invalid' }
  s.platform = :ios, '13.0'
  s.source = { :path => '.' }
  s.source_files = '*.{swift,m}'
  s.requires_arc = true
  s.dependency 'React-Core'
  s.dependency 'LNBoxSDK'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION' => '5.0'
  }
end
