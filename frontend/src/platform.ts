/**
 * 平台检测 & Capacitor 原生插件访问
 *
 * 在 Capacitor 原生 App 里，插件对象会挂到 window.Capacitor.Plugins 上；
 * 为避免打包时依赖具体版本的 TypeScript 类型，我们用 any 兜底、
 * 只在运行时检测是否存在。
 */

export function isCapacitor(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return !!(w.Capacitor && w.Capacitor.Plugins);
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

/** 原生 HTTP 插件（@capacitor-community/http） */
export function getCapacitorHttp(): any | null {
  if (!isCapacitor()) return null;
  const w = window as any;
  return w.Capacitor?.Plugins?.Http ?? null;
}

/** 原生文本转语音（@capacitor-community/text-to-speech） */
export function getCapacitorTTS(): any | null {
  if (!isCapacitor()) return null;
  const w = window as any;
  return w.Capacitor?.Plugins?.TextToSpeech ?? null;
}

/** 原生语音识别（@capacitor-community/speech-recognition） */
export function getCapacitorASR(): any | null {
  if (!isCapacitor()) return null;
  const w = window as any;
  return w.Capacitor?.Plugins?.SpeechRecognition ?? null;
}
