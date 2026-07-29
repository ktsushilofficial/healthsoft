Pod::Spec.new do |s|
  s.name         = 'EspBlufi'
  s.version      = '1.7.1.dev.20260304'
  s.summary      = 'Espressif BluFi client library for iOS'
  s.description  = 'Espressif BluFi client pinned to the IDF 6.0/BluFi 1.4 compatible development revision.'
  s.homepage     = 'https://github.com/EspressifApp/EspBlufiForiOS'
  s.license      = { :type => 'ESPRESSIF MIT', :file => 'LICENSE.txt' }
  s.author       = { 'Espressif Systems' => 'sales@espressif.com' }
  s.platform     = :ios, '13.0'
  s.source       = {
    :git => 'https://github.com/EspressifApp/EspBlufiForiOS.git',
    :commit => 'f4266980ae616df25a1fa5acdff281937304b129'
  }
  s.source_files = 'BlufiLibrary/**/*.{h,m}'
  s.public_header_files = 'BlufiLibrary/*.h'
  s.header_mappings_dir = 'BlufiLibrary'
  s.vendored_libraries = [
    'BlufiLibrary/Security/openssl/libcrypto.a',
    'BlufiLibrary/Security/openssl/libssl.a'
  ]
  s.frameworks = 'CoreBluetooth', 'Security'
  s.libraries = 'z'
  s.requires_arc = true
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/BlufiLibrary" "${PODS_TARGET_SRCROOT}/BlufiLibrary/Security/openssl/include"',
    'DEFINES_MODULE' => 'YES'
  }
end
