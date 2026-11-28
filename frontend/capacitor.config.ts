import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // CAP_APP_ID / CAP_APP_NAME let the same code build two apps: the customer app and the field supervisor app.
  appId: process.env.CAP_APP_ID ?? 'com.faz3tak.app',
  appName: process.env.CAP_APP_NAME ?? 'فزعتك',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;
