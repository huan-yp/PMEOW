import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.pmeow.app',
  appName: 'PMEOW',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: ['*'],
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
