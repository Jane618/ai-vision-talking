import type { MultimodalSettings } from '../api/client';
import { SCENE_PRESETS } from '../presets/scenePresets';

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
  const enableSummary = settings.enableSummary !== false;
  const applyPreset = (presetId: string) => {
    const preset = SCENE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    onChange({
      ...settings,
      ...preset.settings,
      scenePresetId: preset.id,
    });
  };

  return (
    <div className="card settings-panel">
      <div className="settings-panel__header">
        <span className="settings-panel__title">场景预设</span>
        <span className="badge badge--ok">一键应用</span>
      </div>

      <div className="preset-grid">
        {SCENE_PRESETS.map((preset) => {
          const active = settings.scenePresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              className={`preset-card ${active ? 'preset-card--active' : ''}`}
              onClick={() => applyPreset(preset.id)}
              aria-pressed={active}
            >
              <span className="preset-card__icon" aria-hidden="true">
                {preset.icon}
              </span>
              <span className="preset-card__body">
                <span className="preset-card__title">{preset.name}</span>
                <span className="preset-card__desc">{preset.description}</span>
                <span className="preset-card__tone">{preset.tone}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="settings-panel__divider" />

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

      <div className="settings-panel__divider" />

      {/* 🆕 对话摘要设置区 */}
      <div className="settings-panel__header">
        <span className="settings-panel__title">对话摘要</span>
        <span className={`badge ${enableSummary ? 'badge--ok' : 'badge--off'}`}>
          {enableSummary ? '已启用' : '已关闭'}
        </span>
      </div>

      <label className="field field--switch">
        <input
          type="checkbox"
          checked={enableSummary}
          onChange={(e) => update({ enableSummary: e.target.checked })}
        />
        <span>
          启用对话摘要 — 历史对话达到阈值时自动压缩为摘要，降低 token 消耗。
        </span>
      </label>

      {enableSummary && (
        <div className="field">
          <label>
            摘要触发阈值：
            <strong>{(settings.summaryThresholdTokens || 8192).toLocaleString()} tokens</strong>
          </label>
          <input
            type="range"
            min={2048}
            max={16384}
            step={1024}
            value={settings.summaryThresholdTokens || 8192}
            onChange={(e) => update({ summaryThresholdTokens: Number(e.target.value) })}
          />
          <span className="field__hint">
            2K ~ 16K tokens。阈值越小越频繁，更省 tokens；阈值越大越保留完整上下文。
          </span>
        </div>
      )}

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
