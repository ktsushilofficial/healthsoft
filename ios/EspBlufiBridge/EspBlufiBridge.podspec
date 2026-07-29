Pod::Spec.new do |s|
  s.name         = 'EspBlufiBridge'
  s.version      = '1.0.0'
  s.summary      = 'React Native bridge for Espressif BluFi'
  s.description  = 'Isolated React Native bridge used to provision Healthsoft pill dispensers over BluFi.'
  s.homepage     = 'https://healthsoft.internal'
  s.license      = { :type => 'Proprietary' }
  s.author       = { 'Healthsoft' => 'dev@healthsoft.invalid' }
  s.platform     = :ios, '13.0'
  s.source       = { :path => '.' }
  s.source_files = '*.{h,m}'
  s.requires_arc = true
  s.dependency 'React-Core'
  s.dependency 'EspBlufi'
end
