# AI Talking · 移动端（Capacitor）打包与运行指南

> 将 AI Talking 前端打包为 iOS / Android 原生 App，调用系统摄像头、
> 麦克风、原生语音识别与 TTS。同时也支持用手机浏览器直接访问 HTTPS 部署。

---

## 1. 架构总览

```
┌───────────────────────────────────────────────────────┐
│                      手机端                             │
│  ┌──────────────────┐     ┌──────────────────────────┐ │
│  │ iOS / Android    │     │  手机浏览器（Safari/Chrome）│
│  │ WebView (前端)   │◀────┼──────────────────────────┘ │
│  └─────────┬────────┘     │  HTTPS                      │
│            │                │                             │
│  ┌─────────▼────────┐     │  VITE_API_BASE_URL          │
│  │ Capacitor 原生层  │     │  https://192.168.1.10:3001/api
│  │ Camera / Mic     │     └────────────┬─────────────────┘
│  │ ASR / TTS 插件   │                  │
│  └─────────┬────────┘                 │
└────────────┼───────────────────────────┘
             │  HTTPS 请求
             ▼
   ┌─────────────────────┐
   │ 后端 Express Server │
   │ (监听 0.0.0.0:3001) │
   └─────────┬───────────┘
             │ HTTPS 访问豆包多模态
             ▼
   豆包多模态模型 + 火山引擎 TTS
```

## 2. 两条路径

### 路径 A：手机浏览器直接访问（轻量）

只需：

1. 按「第 4 节」启动后端（推荐 HTTPS）；
2. `cd frontend && npm run build`；
3. 将 `frontend/dist/` 以 HTTPS 方式部署（Caddy / Nginx 最简单）；
4. 手机浏览器访问部署后的地址即可。

### 路径 B：Capacitor 原生壳（本指南重点）

可以安装到手机桌面、全屏运行、调用原生权限弹窗、原生 ASR/TTS。
按「第 3～7 节」操作。

---

## 3. 环境要求

- Node.js ≥ 18
- iOS 开发：Xcode 15+（macOS 必需）
- Android 开发：Android Studio Hedgehog 或更新版本，Android SDK 33+
- 本地代码位于仓库根目录 `./`

---

## 4. 先启动后端（手机端需要一个可访问的后端）

```bash
cd backend

# 首次：复制示例配置
cp .env.example .env

# 在 .env 中填入：
#   SERVER_HOST=0.0.0.0
#   SERVER_PORT=3001
#   ARK_API_KEY=xxx
#   ARK_MODEL_ENDPOINT=xxx
#   (可选) SERVER_CERT_FILE / SERVER_KEY_FILE

# 安装依赖
npm install

# 启动
npm run dev
# 或生产：npm run build && npm start
```

### 4.1 用自签名证书启用 HTTPS（手机端必需）

```bash
# 安装 mkcert（macOS）：
brew install mkcert
mkcert -install

# 为你的局域网 IP 生成证书（把 192.168.1.10 换成真实 IP）
mkdir -p certs
mkcert -cert-file certs/localhost.pem \
       -key-file certs/localhost-key.pem \
       localhost 127.0.0.1 192.168.1.10

# 在 backend/.env 中填入：
#   SERVER_CERT_FILE=./certs/localhost.pem
#   SERVER_KEY_FILE=./certs/localhost-key.pem
```

重启后端，日志应显示：

```
[server] AI Talking backend 启动成功：https://0.0.0.0:3001
```

### 4.2 验证手机可达

手机连接到与后端同一 Wi-Fi，浏览器访问：

```
https://192.168.1.10:3001/api/health
```

（首次会提示「不受信任」，在 iOS「设置 → 通用 → VPN 与设备管理 / 证书信任设置」里信任根证书即可。）

---

## 5. 前端构建 & Capacitor 原生壳初始化

```bash
cd frontend

# 1. 环境变量：告诉前端去哪里请求后端 API
cp .env.example .env
echo "VITE_API_BASE_URL=https://192.168.1.10:3001/api" >> .env

# 2. 安装依赖（含 Capacitor）
npm install

# 3. 构建前端静态资源（产物在 frontend/dist/）
npm run build

# 4. 初始化 Capacitor（首次；若仓库已有 capacitor.config.ts 可跳过）
npx cap init "AI Talking" com.aitalking.app --web-dir=dist

# 5. 添加 iOS / Android 平台工程（按需）
npx cap add ios
npx cap add android

# 6. 同步（每次前端构建 / 插件版本变更后都要执行一次）
npx cap sync
```

---

## 6. 原生平台额外配置

### 6.1 iOS

用 Xcode 打开工程：

```bash
npx cap open ios
```

在 `App/Info.plist` 里需要至少声明：

- `NSCameraUsageDescription` —— 需要访问摄像头以进行多模态对话。
- `NSMicrophoneUsageDescription` —— 需要访问麦克风以进行语音输入。
- `NSSpeechRecognitionUsageDescription` —— 需要语音识别能力将语音转为文字。

**签名（Signing & Capabilities）**：在 Xcode 中选择一个 Team（个人免费账号即可在真机上运行 7 天），Signing Certificate 选「Apple Development」。

运行：在 Xcode 顶部选择模拟器或连接的真机，按 ▶ 运行。

也可命令行直接运行：

```bash
npx cap run ios
```

### 6.2 Android

用 Android Studio 打开工程：

```bash
npx cap open android
```

首次打开会同步 Gradle，等索引完成后，选择模拟器或连接的真机并运行。

`AndroidManifest.xml` 中通常已包含：

- `android.permission.CAMERA`
- `android.permission.RECORD_AUDIO`
- `android.permission.INTERNET`
- `android.permission.MODIFY_AUDIO_SETTINGS`

如果缺失请在 `android/app/src/main/AndroidManifest.xml` 中补上。

命令行运行：

```bash
npx cap run android
```

---

## 7. 日常开发工作流

前端代码变更后：

```bash
cd frontend
npm run build       # 重新打包 dist/
npx cap sync        # 同步 dist 与插件依赖到 iOS / Android 原生工程
npx cap open ios    # 或 open android，然后在 IDE 中重新 Run
```

---

## 8. 常见问题

**Q1. 真机运行首次打开时，摄像头 / 麦克风按钮无响应？**

A1. 首次点击会触发原生系统权限弹窗，选择「允许」。
    若点击「不允许」后可在系统设置 → 对应 App → 权限里重新打开。

**Q2. 语音转文字无反应？**

A2. 检查两点：
    - 原生语音识别权限（iOS Speech Recognition；Android 麦克风 + Google App 语音服务）。
    - 设备是否联网：iOS / Android 原生识别在离线模式下有限制。

**Q3. AI 回复无声音？**

A3. 可能原因：
    - 设备静音或音量为 0；
    - 后端未配置 TTS 且浏览器语音合成接口不可用；
    - Capacitor Text-to-Speech 插件未正确同步（重新执行 `npx cap sync`）。

**Q4. HTTP / HTTPS 混合访问报「不安全」？**

A4. 手机端浏览器与 WebView 会阻止在 HTTP 页面访问摄像头 / 麦克风。
    务必通过 HTTPS 提供前端页面与后端 API。

**Q5. 在同一个局域网下，手机还是访问不到后端？**

A5. 检查：
    - 电脑防火墙是否开放 3001 端口；
    - 后端 `SERVER_HOST` 是否确实为 `0.0.0.0`（不是 `localhost`）；
    - 手机与电脑是否在同一个子网。

---

## 9. 目录引用

- 前端入口：`frontend/index.html`
- 前端构建配置：`frontend/vite.config.ts`
- Capacitor 配置：`frontend/capacitor.config.ts`
- PWA 清单：`frontend/public/manifest.json`
- API 客户端：`frontend/src/api/client.ts`
- 平台检测 / 插件：`frontend/src/platform.ts`
- 语音识别 Hook：`frontend/src/hooks/useASR.ts`
- 对话 + TTS Hook：`frontend/src/hooks/useConversation.ts`
- 移动端 CSS：`frontend/src/index.css`（末尾 `@media` 块）
- 后端入口：`backend/src/index.ts`
- 后端配置示例：`backend/.env.example`
