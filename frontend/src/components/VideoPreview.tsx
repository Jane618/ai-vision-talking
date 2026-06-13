import { useState } from 'react';
import type { MultimodalSettings } from '../api/client';
import { SCENE_PRESETS } from '../presets/scenePresets';

interface VideoPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isReady: boolean;
  error?: string | null;
  isRecording: boolean;
  currentFrame?: string | null;
  cameraDisabled?: boolean;
  onToggleCamera?: () => void;
  settings: MultimodalSettings;
  onSettingsChange: (next: MultimodalSettings) => void;
  isRunning: boolean;
  onToggleRunning: () => void;
}

/**
 * 左侧视频预览模块：
 * - 顶部：标题 + 录音/就绪指示 + 「设置」按钮（点击展开画面设置 + 场景预设）
 * - 中部：摄像头画面 + 右下角抽帧缩略图
 * - 可展开区：画面设置（抽帧频率/画质/分辨率）+ 场景预设
 */
export function VideoPreview({
  videoRef,
  isReady,
  error,
  isRecording,
  currentFrame,
  cameraDisabled,
  onToggleCamera,
  settings,
  onSettingsChange,
  isRunning,
  onToggleRunning,
}: VideoPreviewProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const update = (patch: Partial<MultimodalSettings>) => onSettingsChange({ ...settings, ...patch });

  const applyPreset = (presetId: string) => {
    const preset = SCENE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    onSettingsChange({
      ...settings,
      ...preset.settings,
      scenePresetId: preset.id,
    });
  };

  return (
    <div className="card video-preview video-preview--with-panel">
      <div className="video-preview__header">
        <div className="video-preview__title-left">
          <span className="video-preview__title">摄像头</span>
          <button
            type="button"
            className={`btn btn--ghost btn--sm expand-toggle ${settingsOpen ? 'expand-toggle--on' : ''}`}
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            aria-controls="video-settings-panel"
          >
            {settingsOpen ? '收起设置' : '画面设置'}
          </button>
        </div>
        <div className="video-preview__indicators">
          <span className={`badge ${isRunning ? 'badge--ok' : 'badge--off'}`}>
            {isRunning ? '传输中' : '已暂停'}
          </span>
          {isRecording && (
            <span className="recording-badge" aria-label="正在录音">
              <span className="recording-dot" /> 录音中
            </span>
          )}
          <span className={`status-dot ${isReady ? 'status-dot--ok' : 'status-dot--off'}`} />
        </div>
      </div>

      <div className="video-preview__stage">
        <video
          ref={videoRef}
          className={`video ${cameraDisabled ? 'video--disabled' : ''}`}
          autoPlay
          playsInline
          muted
        />
        {!isReady && !error && (
          <div className="video-preview__overlay">正在获取摄像头权限…</div>
        )}
        {error && <div className="video-preview__overlay video-preview__overlay--error">{error}</div>}
        {currentFrame && (
          <img className="video-preview__thumb" src={currentFrame} alt="当前抽帧" />
        )}
      </div>

      <div className="video-preview__footer">
        {onToggleCamera && (
          <button type="button" className="btn btn--ghost" onClick={onToggleCamera}>
            {cameraDisabled ? '启用摄像头' : '停用摄像头'}
          </button>
        )}
        <span className="hint">画面变化时自动抽取并发送给多模态模型。</span>
      </div>

      <div
        id="video-settings-panel"
        className={`expand-panel ${settingsOpen ? 'expand-panel--open' : ''}`}
        hidden={!settingsOpen}
      >
        {/* —— 场景预设 —— */}
        <div className="expand-panel__section">
          <div className="expand-panel__section-title">场景预设</div>
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
        </div>

        <div className="expand-panel__divider" />

        {/* —— 画面设置 —— */}
        <div className="expand-panel__section">
          <div className="expand-panel__section-title">画面设置</div>
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

          <div className="expand-panel__actions">
            <button
              type="button"
              className={`btn ${isRunning ? 'btn--warning' : 'btn--primary'}`}
              onClick={onToggleRunning}
            >
              {isRunning ? '暂停传输' : '开始传输画面'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
