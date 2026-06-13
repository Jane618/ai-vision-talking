# 🎙️ 多模态 AI 对话应用（国产模型 · 端云协同）

一款基于浏览器的多模态 AI 对话应用。打开摄像头与麦克风，AI 即可看到画面内容、听到用户说话，并以语音+文字形式给予中文回应。

- **视觉理解**：豆包多模态大模型（字节跳动 · 火山引擎 Ark）
- **对话推理**：豆包大模型（同 Ark API 调用）
- **语音识别**：浏览器端本地识别（零云端 ASR 成本）
- **语音合成**：火山引擎 TTS（有凭证时）或浏览器内置 TTS 回退

---

## 📁 项目结构

```
ai-talking/
├── docs/
│   └── design.md           # 设计文档：用户故事、架构、成本策略
├── backend/                # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── index.ts        # Express 入口 & 路由
│   │   ├── services/
│   │   │   ├── doubao.ts   # 豆包多模态 API（Ark OpenAI 兼容格式）
│   │   │   ├── tts.ts      # 火山引擎 TTS（可选，无凭证回退）
│   │   │   └── conversation.ts  # 会话管理、历史压缩、成本追踪
│   │   └── types.ts
│   └── package.json
└── frontend/               # Vite + React + TypeScript
    ├── src/
    │   ├── components/     # VideoPreview / ChatHistory / SettingsPanel / CostStats
    │   ├── hooks/          # useCamera / useMicrophone / useASR / useConversation
    │   ├── video/          # 智能抽帧（帧差检测 + JPEG 压缩）
    │   ├── api/            # fetch 客户端
    │   ├── App.tsx
    │   └── index.css       # 深色主题，纯 CSS
    └── package.json
```

详细设计与架构说明，请见 [docs/design.md](./docs/design.md)。

---

## 🚀 快速开始

### 1. 准备火山引擎 API Key

1. 登录 [火山引擎方舟控制台](https://console.volcengine.com/ark)
2. 创建一个「多模态模型推理」接入点（推荐 `doubao-vision-pro-32k` 或同级视觉模型）
3. 获取 `ARK_API_KEY` 和 `ARK_MODEL_ENDPOINT`（即接入点 Endpoint ID）
4. （可选）开通火山引擎 TTS，获取 `VOLC_TTS_APP_ID` 和 `VOLC_TTS_ACCESS_TOKEN`

> 不配置 TTS 也能跑：前端会自动用浏览器内置 TTS 朗读 AI 回复。

### 2. 安装依赖 & 配置

```bash
# 后端
cd backend
npm install
cp .env.example .env
# 编辑 .env，填入 ARK_API_KEY 和 ARK_MODEL_ENDPOINT

# 前端（另一个终端）
cd frontend
npm install
```

### 3. 启动

```bash
# 后端（终端 1）
cd backend
npm run dev
# ✅ 监听 http://localhost:3001

# 前端（终端 2）
cd frontend
npm run dev
# ✅ 打开 http://localhost:5173
```

浏览器打开 <http://localhost:5173>，允许摄像头和麦克风权限，即可开始对话。

---

## 💰 成本控制一览

| 技巧 | 实现 | 节省 |
|------|------|------|
| 本地语音识别（不调用云端 ASR） | ✅ 浏览器内完成 | ~80% 语音成本 |
| 智能抽帧（帧差检测跳过静态画面） | ✅ frontend/video/frameSampler.ts | 50-70% 视觉成本 |
| 图像压缩（512×512, JPEG q=0.7） | ✅ 同上，用户可调 | 60% 视觉成本 |
| 对话历史压缩（8 轮上限） | ✅ backend/services/conversation.ts | 30-50% token |
| 按需调用（用户停 1.2s 才触发） | ✅ frontend/hooks/useASR.ts | ~50% 总体 |
| max_tokens 上限 | ✅ backend/services/doubao.ts | ~10% 对话成本 |
| 会话自动超时清理（10min） | ✅ backend/services/conversation.ts | 防僵尸会话 |
| 用户可配置（滑块调参数） | ✅ frontend/components/SettingsPanel.tsx | 用户自主控本 |

**预估每小时成本**：低活跃 ¥0.3~¥0.8，中等 ¥1.0~¥2.5，高活跃 ¥2.5~¥5.0（以官方定价为准）。

---

## ⚠️ 注意事项

- `getUserMedia` 仅在 **HTTPS 或 localhost** 下可用，生产部署必须配 HTTPS
- 前端所有音频数据在浏览器本地识别，不上传，隐私友好
- 后端 API Key 仅在服务端读取，前端代码无法获取
- 浏览器建议：**Chrome 或 Edge**（Web Speech API 语音识别支持最佳）

---

## 📖 更多内容

完整设计文档：[docs/design.md](./docs/design.md)
