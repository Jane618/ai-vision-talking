import type { MultimodalSettings } from '../api/client';

export interface ScenePreset {
  id: string;
  name: string;
  icon: string;
  description: string;
  tone: string;
  settings: Pick<
    MultimodalSettings,
    | 'frameIntervalMs'
    | 'imageQuality'
    | 'imageSize'
    | 'systemPrompt'
    | 'summaryThresholdTokens'
  >;
}

export const SCENE_PRESETS: ScenePreset[] = [
  {
    id: 'daily',
    name: '日常对话',
    icon: '💬',
    description: '普通看图聊天、临时提问和生活陪伴。',
    tone: '自然、简洁',
    settings: {
      frameIntervalMs: 3000,
      imageQuality: 0.8,
      imageSize: 512,
      summaryThresholdTokens: 8192,
      systemPrompt:
        '你是一个友善的中文 AI 助手，可以看到摄像头画面并听到用户说话。请结合画面和用户问题，用自然、简洁的中文回答。不要使用 markdown 格式。',
    },
  },
  {
    id: 'casual-companion',
    name: '日常陪聊',
    icon: '☕',
    description: '边做事边聊天、轻松陪伴、生活建议。',
    tone: '轻松、有陪伴感',
    settings: {
      frameIntervalMs: 4500,
      imageQuality: 0.72,
      imageSize: 480,
      summaryThresholdTokens: 6144,
      systemPrompt:
        '你是一个轻松、有陪伴感的中文 AI 伙伴。你可以看到摄像头画面并听到用户说话。请优先回应用户的情绪和当下问题，必要时简短提到画面里的关键信息。回答要自然、温和、简短，不要过度分析，不要使用 markdown 格式。',
    },
  },
  {
    id: 'visual-explain',
    name: '看图讲解',
    icon: '🖼️',
    description: '解释图片、画面内容、物体关系和细节。',
    tone: '清楚、会观察',
    settings: {
      frameIntervalMs: 1800,
      imageQuality: 0.9,
      imageSize: 768,
      summaryThresholdTokens: 8192,
      systemPrompt:
        '你是一个中文看图讲解助手。请仔细观察摄像头画面中的主体、背景、文字、动作和细节关系，再结合用户问题回答。先说最确定的观察结果，再说明可能的含义；如果画面不清楚，请直接说明需要用户靠近、补光或换角度。回答要清楚、简短，不要使用 markdown 格式。',
    },
  },
  {
    id: 'text-solve',
    name: '文本识别/讲题',
    icon: '🧮',
    description: '识别题目、书页、屏幕文字并讲解。',
    tone: '准确、分步骤',
    settings: {
      frameIntervalMs: 1500,
      imageQuality: 0.95,
      imageSize: 960,
      summaryThresholdTokens: 12288,
      systemPrompt:
        '你是一个中文文本识别和讲题助手。请优先识别摄像头画面中的文字、题目、公式、选项和图表信息，再结合用户问题作答。如果文字不完整或模糊，请先说明无法确定的部分，并提示用户调整距离、角度或光线。讲题时分步骤解释关键思路，避免只给答案。回答不要使用 markdown 格式。',
    },
  },
  {
    id: 'operation-guide',
    name: '操作指导',
    icon: '🛠️',
    description: '根据画面指导步骤、排查问题和纠错。',
    tone: '具体、一步一步',
    settings: {
      frameIntervalMs: 1800,
      imageQuality: 0.88,
      imageSize: 768,
      summaryThresholdTokens: 8192,
      systemPrompt:
        '你是一个中文操作指导助手。请根据摄像头画面判断用户正在操作的物品、工具、界面或步骤，并给出下一步建议。回答时先确认你看到的关键状态，再给出一到三步具体指导；如果存在安全风险或画面不清楚，请先提醒用户暂停或换角度。不要使用 markdown 格式。',
    },
  },
  {
    id: 'picture-book',
    name: '绘本陪读',
    icon: '📖',
    description: '讲绘本、解释画面、引导孩子观察。',
    tone: '温柔、童趣',
    settings: {
      frameIntervalMs: 2500,
      imageQuality: 0.85,
      imageSize: 640,
      summaryThresholdTokens: 8192,
      systemPrompt:
        '你是一个温柔、有耐心的中文绘本陪读助手。请根据摄像头中的绘本画面和用户的话，用适合儿童理解的语言讲解内容，引导孩子观察细节、猜测情节，并适当提出一个简单问题。回答要短，语气亲切，不要使用 markdown 格式。',
    },
  },
  {
    id: 'object-id',
    name: '物体识别',
    icon: '🔎',
    description: '识别物品、植物、设备、环境细节。',
    tone: '准确、直接',
    settings: {
      frameIntervalMs: 2000,
      imageQuality: 0.9,
      imageSize: 768,
      summaryThresholdTokens: 6144,
      systemPrompt:
        '你是一个中文视觉识别助手。请优先观察画面中的主体、文字、颜色、形状和环境线索，尽量准确判断用户询问的物体或场景。如果不确定，请说明可能性和需要补充的观察角度。回答要直接，不要使用 markdown 格式。',
    },
  },
  {
    id: 'study',
    name: '学习辅导',
    icon: '🎓',
    description: '作业讲解、知识问答、步骤化辅导。',
    tone: '清晰、循序渐进',
    settings: {
      frameIntervalMs: 3000,
      imageQuality: 0.85,
      imageSize: 640,
      summaryThresholdTokens: 8192,
      systemPrompt:
        '你是一个中文学习辅导助手。请结合画面和用户问题，先判断题目或知识点，再用循序渐进的方式解释。不要直接给过长答案，优先启发用户理解关键步骤。回答要清晰、简短，不要使用 markdown 格式。',
    },
  },
  {
    id: 'low-cost',
    name: '低成本模式',
    icon: '🌿',
    description: '长时间使用、省流量、省 token。',
    tone: '简短、省成本',
    settings: {
      frameIntervalMs: 6000,
      imageQuality: 0.55,
      imageSize: 384,
      summaryThresholdTokens: 4096,
      systemPrompt:
        '你是一个中文 AI 助手。请用尽量简短的回答解决用户问题，只有在画面信息对回答很重要时才描述画面。避免展开过多背景信息，不要使用 markdown 格式。',
    },
  },
];

export const DEFAULT_SCENE_PRESET_ID = 'daily';

export function getScenePreset(id?: string): ScenePreset {
  return (
    SCENE_PRESETS.find((preset) => preset.id === id) ||
    SCENE_PRESETS.find((preset) => preset.id === DEFAULT_SCENE_PRESET_ID) ||
    SCENE_PRESETS[0]
  );
}
