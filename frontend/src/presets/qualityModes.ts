import type { MultimodalSettings } from '../api/client';

export type QualityModeId = NonNullable<MultimodalSettings['qualityMode']>;

export interface QualityModePreset {
  id: QualityModeId;
  name: string;
  description: string;
  costHint: string;
  settings: Pick<
    MultimodalSettings,
    | 'frameIntervalMs'
    | 'imageQuality'
    | 'imageQualityMin'
    | 'imageSize'
    | 'adaptiveImageQuality'
    | 'summaryThresholdTokens'
  >;
}

export const QUALITY_MODE_PRESETS: QualityModePreset[] = [
  {
    id: 'budget',
    name: '省钱模式',
    description: '低频抽帧、小图、低质量下限，适合长时间陪聊。',
    costHint: '成本最低',
    settings: {
      frameIntervalMs: 6000,
      imageQuality: 0.62,
      imageQualityMin: 0.35,
      imageSize: 384,
      adaptiveImageQuality: true,
      summaryThresholdTokens: 4096,
    },
  },
  {
    id: 'balanced',
    name: '均衡模式',
    description: '兼顾识别质量和 token 成本，适合大多数场景。',
    costHint: '默认推荐',
    settings: {
      frameIntervalMs: 3000,
      imageQuality: 0.8,
      imageQualityMin: 0.45,
      imageSize: 512,
      adaptiveImageQuality: true,
      summaryThresholdTokens: 8192,
    },
  },
  {
    id: 'quality',
    name: '高清识别',
    description: '高分辨率和高质量范围，适合文字、题目和细节识别。',
    costHint: '质量优先',
    settings: {
      frameIntervalMs: 1500,
      imageQuality: 0.95,
      imageQualityMin: 0.68,
      imageSize: 960,
      adaptiveImageQuality: true,
      summaryThresholdTokens: 12288,
    },
  },
];

export function getQualityModePreset(id?: string): QualityModePreset {
  return (
    QUALITY_MODE_PRESETS.find((preset) => preset.id === id) ||
    QUALITY_MODE_PRESETS.find((preset) => preset.id === 'balanced') ||
    QUALITY_MODE_PRESETS[0]
  );
}
