Pod::Spec.new do |s|
  s.name = 'LNBoxSDK'
  s.version = '0.0.1'
  s.summary = 'Vendor pill dispenser SDK'
  s.description = 'Bundled LNBoxSDK pill dispenser framework used by the pillbox demo bridge.'
  s.homepage = 'https://healthsoft.internal'
  s.license = { :type => 'Commercial' }
  s.author = { 'Healthsoft' => 'dev@healthsoft.invalid' }
  s.source = { :path => '.' }
  s.vendored_frameworks = 'LNBoxSDK.framework'
  s.platform = :ios, '13.0'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'BUILD_LIBRARY_FOR_DISTRIBUTION' => 'YES',
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'arm64 i386'
  }
end
