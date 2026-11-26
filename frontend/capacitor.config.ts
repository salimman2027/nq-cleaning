import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nqcleaning.app',
  appName: 'NQ Cleaning',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;
