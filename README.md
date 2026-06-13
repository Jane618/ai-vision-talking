# AI Talking 多模态语音对话应用

AI Talking 是一款基于 Web 的多模态 AI 对话应用。用户打开摄像头与麦克风后，可以通过文字或语音向 AI 提问，AI 会结合当前摄像头画面进行理解，并以流式文字和语音播报回应。

项目重点覆盖三件事：视觉内容理解、自然语音交互、端云协同成本控制。前端负责摄像头预览、抽帧、压缩、语音输入、流式展示和播报；后端负责会话管理、对话摘要、成本统计和豆包多模态模型调用。

## 当前能力

| 能力 | 当前实现 |
|---|---|
| 摄像头预览 | 支持启用/停用摄像头，页面左侧实时显示画面 |
| 本地抽帧缩略图 | 摄像头开启后持续更新右下角缩略图，未传输时也能测试抽帧效果 |
| 画面传输控制 | “开始传输画面/暂停传输”按钮与摄像头控制按钮并排展示 |
| 画面变化检测 | 使用 `64x64` 采样，结合平均差、变化像素比例、边缘变化和局部块变化捕捉细节 |
| 图片质量自适应 | 根据 Laplacian 方差和边缘比例判断复杂度，在用户设置的质量下限/上限之间动态调整 JPEG quality |
| 场景预设 | 支持日常对话、日常陪聊、看图讲解、文本识别/讲题、操作指导、绘本陪读、物体识别、学习辅导、低成本模式 |
| 语音输入 | 支持浏览器语音识别，识别文本回填输入框，并在句子结束后发送 |
| 流式回复 | 后端通过 SSE 返回 AI 文本片段，前端逐步展示回复 |
| 语音播报 | AI 回复按句切分并加入播报队列，支持边生成边播 |
| 播报打断 | 用户输入文字、开启语音输入或说出停止类关键词时，中断当前播报 |
| 对话摘要 | 历史上下文达到 token 阈值后自动摘要，降低长对话成本 |
| token 状态栏 | 页面右上角展示调用次数、输入/输出 token、总 token、节省 token 和估算费用 |
| 移动端支持 | 支持手机浏览器 HTTPS 访问，也保留 Capacitor 打包能力 |

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vite、React、TypeScript、原生 CSS |
| 摄像头 | `navigator.mediaDevices.getUserMedia` + Canvas 抽帧 |
| 语音输入 | Web Speech API / Capacitor Speech Recognition |
| 语音播报 | 浏览器 TTS / Capacitor Text to Speech |
| 后端 | Node.js、Express、TypeScript |
| 模型 | 火山引擎 Ark / 豆包多模态模型 |
| 流式响应 | Server-Sent Events |
| 会话管理 | 后端内存会话，生产可替换为 Redis |

## 项目结构

```text
ai-talking/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express 入口、API 路由、静态资源托管、SSE 流式接口
│   │   ├── types.ts              # 后端请求/响应与会话类型
│   │   └── services/
│   │       ├── conversation.ts   # 会话历史、摘要、token 拆解、成本统计
│   │       ├── doubao.ts         # 豆包多模态模型调用与流式输出
│   │       └── tts.ts            # 火山引擎 TTS，可选
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # 页面主状态与摄像头/对话流程编排
│   │   ├── api/client.ts         # API 类型与 fetch/SSE 客户端
│   │   ├── components/
│   │   │   ├── VideoPreview.tsx  # 摄像头、画面设置浮层、场景预设、缩略图
│   │   │   ├── ChatHistory.tsx   # 对话历史、摘要设置、输入栏
│   │   │   ├── CostStats.tsx     # 右上角 token 状态栏
│   │   │   └── ThemeToggle.tsx   # 深浅色主题切换
│   │   ├── hooks/
│   │   │   ├── useASR.ts         # 语音识别
│   │   │   ├── useCamera.ts      # 摄像头控制
│   │   │   └── useConversation.ts # 流式对话、播报队列、输入锁定
│   │   ├── presets/scenePresets.ts
│   │   ├── video/frameSampler.ts # 抽帧、变化检测、复杂度分析、自适应压缩
│   │   └── platform.ts           # Web / Capacitor 平台适配
│   ├── .env.example
│   ├── capacitor.config.ts
│   └── package.json
└── docs/
    ├── technical-solution.md
    ├── product-prd.md
    ├── user-stories-cost-control.md
    ├── mobile-capacitor.md
    └── design.md
```

## 快速开始

### 准备模型配置

在火山引擎方舟控制台准备多模态模型接入点，并获取：

- `ARK_API_KEY`
- `ARK_MODEL_ENDPOINT`

如果要使用服务端 TTS，再配置火山引擎 TTS 相关变量。未配置 TTS 时，前端会使用浏览器或原生 TTS 回退。

### 安装依赖

```powershell
cd backend
npm install

cd ..\frontend
npm install
```

### 配置环境变量

复制示例环境变量文件：

```powershell
cd backend
Copy-Item .env.example .env

cd ..\frontend
Copy-Item .env.example .env
```

后端 `backend/.env` 至少需要填写：

```env
SERVER_PORT=3001
SERVER_HOST=0.0.0.0
ARK_API_KEY=your_ark_api_key_here
ARK_MODEL_ENDPOINT=your_ark_model_endpoint_here
```

前端开发模式通常可以保持 `VITE_API_BASE_URL=` 为空，由 Vite 代理转发到后端。手机浏览器或 Capacitor App 访问时，需要填写可从手机访问的 HTTPS 地址，例如：

```env
VITE_API_BASE_URL=https://192.168.1.10:3001/api
```

### 本地开发启动

终端 1 启动后端：

```powershell
cd backend
npm run dev
```

终端 2 启动前端：

```powershell
cd frontend
npm run dev
```

桌面浏览器打开 `http://localhost:5173`，允许摄像头和麦克风权限后即可使用。

## 后端托管前端

后端可以托管 `frontend/dist`，适合手机或局域网演示时只暴露一个 HTTPS 入口。

```powershell
cd frontend
npm run build

cd ..\backend
npm run build
npm start
```

如需手机访问摄像头和麦克风，请使用 HTTPS。后端支持通过以下变量配置证书：

```env
SERVER_CERT_FILE=./certs/localhost.pem
SERVER_KEY_FILE=./certs/localhost-key.pem
```

## 成本控制策略

| 策略 | 状态 | 说明 |
|---|---|---|
| 浏览器侧语音识别 | 已实现 | 不调用云端 ASR，减少语音输入成本 |
| 抽帧替代视频流 | 已实现 | 不持续上传视频，只发送必要图片帧 |
| 本地预览帧与发送帧分离 | 已实现 | 未传输时只更新缩略图，不更新对话发送帧 |
| 发送即取帧 | 已实现 | 文本发送或语音句子结束时立即抓取最新摄像头帧 |
| 细节敏感变化检测 | 已实现 | 静态画面不重复更新发送帧，同时捕捉文字和小物体变化 |
| 图片尺寸控制 | 已实现 | 限制最长边像素，降低图片体积和图像 token |
| 图片质量自适应 | 已实现 | 复杂画面提高质量，简单画面降低质量 |
| 对话摘要 | 已实现 | 历史 token 达到阈值后压缩上下文 |
| token 状态栏 | 已实现 | 展示调用次数、token、节省 token 和估算费用 |
| 场景预设 | 已实现 | 不同场景使用不同抽帧和提示词参数 |
| 成本/质量模式 | 已实现 | 省钱、均衡、高清识别三档一键调整视觉与摘要参数 |

## 文档

| 文档 | 说明 |
|---|---|
| [技术方案](./docs/technical-solution.md) | 系统架构、视觉理解、语音交互、后端方案、成本控制 |
| [产品 PRD](./docs/product-prd.md) | 产品目标、功能范围、准备实现功能、埋点方案、验收标准 |
| [用户故事与成本控制说明](./docs/user-stories-cost-control.md) | 用户故事实现情况、已采用和未实现的成本技巧 |
| [移动端打包指南](./docs/mobile-capacitor.md) | 手机浏览器访问和 Capacitor 原生壳打包 |
| [旧版设计文档](./docs/design.md) | 早期设计说明，部分内容可能与当前实现不完全一致 |

## 常用命令

```powershell
# 前端构建
cd frontend
npm run build

# 后端构建
cd backend
npm run build

# 后端生产启动
npm start
```

## 注意事项

- 摄像头和麦克风在桌面本地 `localhost` 可用；手机或生产环境必须使用 HTTPS。
- 后端 API Key 只放在 `backend/.env`，不要暴露到前端代码。
- 前端发送给模型的是抽帧后的 JPEG 图片，不是连续视频流。
- 右下角缩略图是本地抽帧预览；开启画面传输时会按变化检测更新发送帧，用户发送文本或语音句子结束时会再抓取最新帧用于本轮对话。
- 当前会话状态存储在后端内存中，生产多实例部署建议替换为 Redis。
