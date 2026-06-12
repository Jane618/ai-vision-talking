import { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 配置
 * - iOS/Android 原生工程会在执行 `npx cap add ios` / `npx cap add android` 时生成
 * - `webDir` 指向 `npm run build` 输出目录，打包进原生 App 的就是这个目录
 * - `server.androidScheme` 设置为 `https`，这样 WebView 内的跨域行为更一致
 */
const config: CapacitorConfig = {
  appId: 'com.aitalking.app',
  appName: 'AI Talking',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
