export const PILL_DISPENSER_VENDOR_HOSTS = {
  testing: 'https://api-en-test.zoomcare.tech',
  production: 'https://api-en.zoomcare.tech',
} as const;

export const PILL_DISPENSER_VENDOR_CONFIG = {
  host: PILL_DISPENSER_VENDOR_HOSTS.production,
  companyCode: '35600001000000018',
  companySecret: '9be0945240bd47e1585f0c9b',
} as const;
