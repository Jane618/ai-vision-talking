import React from 'react';

interface VideoPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isReady: boolean;
  error?: string | null;
  isRecording: boolean;
  currentFrame?: string | null; // base64 JPEG
  cameraDisabled?: boolean;
  onToggleCamera?: () => void;
}

/**
 * 左侧视频预览：显示摄像头实时画面，右下角显示当前抽帧缩略图，
 * 右上角红色指示灯表示是否正在录音。
 */
export function VideoPreview({
  videoRef,
  isReady,
  error,
  isRecording,
  currentFrame,
  cameraDisabled,
  onToggleCamera,
}: VideoPreviewProps) {
  return (
    <div className="card video-preview">
      <div className="video-preview__header">
        <span className="video-preview__title">摄像头</span>
        <div className="video-preview__indicators">
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
    </div>
  );
}
