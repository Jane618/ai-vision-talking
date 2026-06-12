import type { MultimodalSettings } from '../api/client';

interface SettingsPanelProps {
  settings: MultimodalSettings;
  onChange: (next: MultimodalSettings) => void;
  isRunning: boolean;
  onToggleRunning: () => void;
}

/**
 * 画面设置面板：抽帧频率 / 画质 / 分辨率滑块 + 开始/暂停传输按钮。
 * 清空对话/重置会话已移到对话模块。
 */
export function SettingsPanel({ settings, onChange, isRunning, onToggleRunning }: SettingsPanelProps) {
  const update = (patch: Partial<MultimodalSettings>) => onChange({ ...settings, ...patch });

  return (
    <div className="card settings-panel">
      <div className="settings-panel__header">
        <span className="settings-panel__title">画面设置</span>
        <span className={`badge ${isRunning ? 'badge--ok' : 'badge--off'}`}>
          {isRunning ? '画面传输中' : '已暂停'}
        </span>
      </div>

      <div className="field">
        <label>
          抽帧频率：
          <strong>{(settings.frameIntervalMs / 1000).toFixed(1)} 秒</strong>
        </label>
        <input
          type="range"
          min={1000}
          max={10000}
          step={500}
          value={settings.frameIntervalMs}
          onChange={(e) => update({ frameIntervalMs: Number(e.target.value) })}
        />
        <span className="field__hint">1s ~ 10s，数值越小发送越频繁，成本越高。</span>
      </div>

      <div className="field">
        <label>
          图像质量：
          <strong>{settings.imageQuality.toFixed(2)}</strong>
        </label>
        <input
          type="range"
          min={0.3}
          max={1}
          step={0.05}
          value={settings.imageQuality}
          onChange={(e) => update({ imageQuality: Number(e.target.value) })}
        />
        <span className="field__hint">0.3 低画质省流量 / 1.0 最高画质。</span>
      </div>

      <div className="field">
        <label>
          图像分辨率：
          <strong>{settings.imageSize} px</strong>
        </label>
        <input
          type="range"
          min={256}
          max={1024}
          step={32}
          value={settings.imageSize}
          onChange={(e) => update({ imageSize: Number(e.target.value) })}
        />
        <span className="field__hint">最长边像素，保持画面比例缩放。</span>
      </div>

      <div className="settings-panel__actions">
        <button
          type="button"
          className={`btn ${isRunning ? 'btn--warning' : 'btn--primary'}`}
          onClick={onToggleRunning}
        >
          {isRunning ? '暂停传输' : '开始传输画面'}
        </button>
      </div>
    </div>
  );
}
