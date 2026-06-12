/**
 * API Key 本地持久化
 *
 * 在原生 App 场景下，用户把 API Key / Endpoint 直接输入到界面上，
 * 保存在 localStorage 中，下次启动自动恢复。
 *
 * 在浏览器 + 远程后端模式下，这些字段可能是空的，
 * `sendMultimodal` 会根据 `VITE_API_BASE_URL` 是否配置来决定是走远程还是本地。
 */

export interface ApiConfig {
  apiKey: string;
  endpoint: string;
}

const STORAGE_KEY = 'ai-talking.api-key.v1';

export function loadApiConfig(): ApiConfig {
  try {
    if (typeof localStorage === 'undefined') return { apiKey: '', endpoint: '' };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { apiKey: '', endpoint: '' };
    const obj = JSON.parse(raw) as ApiConfig;
    return { apiKey: obj.apiKey || '', endpoint: obj.endpoint || '' };
  } catch {
    return { apiKey: '', endpoint: '' };
  }
}

export function saveApiConfig(cfg: ApiConfig): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    // 把配置注入到 import.meta.env 可读取的位置
    // 注意：import.meta.env 在构建时固定，运行时无法修改；
    // 但我们可以通过保存到 sessionStorage 供 doubao.ts 读取
    sessionStorage.setItem('VITE_ARK_API_KEY', cfg.apiKey || '');
    sessionStorage.setItem('VITE_ARK_MODEL_ENDPOINT', cfg.endpoint || '');
  } catch { /* ignore */ }
}

export function clearApiConfig(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem('VITE_ARK_API_KEY');
    sessionStorage.removeItem('VITE_ARK_MODEL_ENDPOINT');
  } catch { /* ignore */ }
}
