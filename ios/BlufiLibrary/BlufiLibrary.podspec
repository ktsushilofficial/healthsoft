Pod::Spec.new do |s|
  s.name         = 'BlufiLibrary'
  s.version      = '2.2.0'
  s.summary      = 'Espressif BluFi library source'
  s.description  = 'Vendor BluFi source and bundled OpenSSL libraries for device provisioning.'
  s.homepage     = 'https://github.com/EspressifApp/EspBlufiForiOS'
  s.license      = { :type => 'MIT' }
  s.author       = { 'Espressif' => 'support@espressif.com' }
  s.platform     = :ios, '13.0'
  s.source       = { :path => '.' }
  s.requires_arc = true
  s.source_files = '**/*.{h,m}'
  s.public_header_files = '**/*.h'
  s.vendored_libraries = [
    'Security/openssl/libcrypto.a',
    'Security/openssl/libssl.a'
  ]
  s.frameworks = 'CoreBluetooth'
  s.libraries = 'z'
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '$(inherited) $(PODS_TARGET_SRCROOT) $(PODS_TARGET_SRCROOT)/Security/openssl/include'
  }
end
