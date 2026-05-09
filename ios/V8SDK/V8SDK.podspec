Pod::Spec.new do |s|
  s.name         = 'V8SDK'
  s.version      = '1.0.0'
  s.summary      = 'Vendor V8 BLE SDK binary'
  s.description  = 'Static vendor BLE SDK and headers for V8 device integration.'
  s.homepage     = 'https://healthsoft.internal'
  s.license      = { :type => 'Commercial' }
  s.author       = { 'Healthsoft' => 'dev@healthsoft.invalid' }
  s.platform     = :ios, '13.0'
  s.source       = { :path => '.' }
  s.vendored_libraries = 'libBleSDK.a'
  s.source_files = '*.h'
  s.public_header_files = '*.h'
end
