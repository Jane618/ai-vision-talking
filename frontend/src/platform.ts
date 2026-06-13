/**
 * 运行平台检测 & Capacitor 原生插件访问。
 *
 * 设计目标：
 *  - 在纯浏览器里运行时，不依赖任何 Capacitor 代码（通过运行时检查 window.Capacitor）；
 *  - 在 Capacitor 壳（iOS / Android WebView）里，优先调用原生插件以获得：
 *      * 更稳定的摄像头 / 麦克风权限流程
 *      * 离线可用的语音识别与 TTS
 *      * 更好的系统集成（状态栏、键盘、振动等）
 */

// ------- 平台检测 -------

export function isCapacitor(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    Capacitor?: { Plugins?: Record<string, unknown> };
    webkit?: { messageHandlers?: { bridge?: unknown } };
    AndroidBridge?: unknown;
  };
  // 1) 标准 Capacitor 注入
  if (w.Capacitor && w.Capacitor.Plugins) return true;
  // 2) iOS bridge fallback
  if (w.webkit?.messageHandlers?.bridge) return true;
  // 3) Android bridge fallback
  if (w.AndroidBridge) return true;
  return false;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

// ------- 原生插件访问 -------
//
// 这里故意用 `any`：不同版本 / 平台的 Capacitor 社区插件接口略有差异，
// 在调用处使用 try/catch 兜底，失败时回退到浏览器 API。

function getPlugin(name: string): any | null {
  if (!isCapacitor()) return null;
  const w = window as unknown as {
    Capacitor?: { Plugins?: Record<string, unknown> };
  };
  return (w.Capacitor?.Plugins?.[name] as any | null) ?? null;
}

/**
 * 获取原生文本转语音（TTS）插件。
 * 接口：
 *   speak({ text: string, lang?: string, rate?: number, pitch?: number })
 *   stop()
 */
export function getCapacitorTTS(): any | null {
  return getPlugin('TextToSpeech');
}

/**
 * 获取原生语音识别（ASR）插件。
 * 接口：
 *   start({ language?: string, partialResults?: boolean, maxResults?: number })
 *   stop()
 *   addListener('partialResults', (ev: { matches: string[] }) => void)
 *   addListener('results', (ev: { matches: string[] }) => void)
 *   addListener('listeningState', (ev: { status: 'started' | 'stopped' }) => void)
 *   checkPermissions() / requestPermissions()
 */
export function getCapacitorASR(): any | null {
  return getPlugin('SpeechRecognition');
}
