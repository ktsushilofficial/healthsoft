Pod::Spec.new do |s|
  s.name         = 'V8Bridge'
  s.version      = '1.0.0'
  s.summary      = 'React Native bridge for vendor V8 iOS SDK'
  s.description  = 'Native bridge module for scanning, connection, command and parser integration using vendor V8 SDK.'
  s.homepage     = 'https://healthsoft.internal'
  s.license      = { :type => 'Commercial' }
  s.author       = { 'Healthsoft' => 'dev@healthsoft.invalid' }
  s.platform     = :ios, '13.0'
  s.source       = { :path => '.' }
  s.source_files = '*.{h,m}'
  s.requires_arc = true
  s.dependency 'React-Core'
  s.dependency 'V8SDK'
end
