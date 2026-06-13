import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aitalking.app',
  appName: 'AI Talking',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SpeechRecognition: {
      voiceParamAudio: 'zh-CN',
    },
  },
};

export default config;
