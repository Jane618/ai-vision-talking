# AI Talking 一键启动脚本
# 功能：检查 Redis -> 启动 Python 后端 -> 启动前端 -> 监控所有进程
# 按 Ctrl+C 停止所有服务

$ErrorActionPreference = "Continue"

# 配置
$BackendDir = Join-Path $PSScriptRoot "backend-python"
$FrontendDir = Join-Path $PSScriptRoot "frontend"
$BackendPort = 8001
$FrontendPort = 5173

# 颜色输出
function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

# 检查端口是否有 LISTEN 状态
function Test-PortListen($port) {
    $tcp = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return ($tcp -ne $null)
}

# 等待端口 LISTEN 就绪
function Wait-ForPortListen($port, $timeout = 30) {
    $start = Get-Date
    while (-not (Test-PortListen $port)) {
        if (((Get-Date) - $start).TotalSeconds -gt $timeout) {
            return $false
        }
        Start-Sleep -Milliseconds 500
    }
    return $true
}

# 杀掉占用端口的进程
function Clear-Port($port) {
    Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
        ForEach-Object {
            $ownPid = $_.OwningProcess
            if ($ownPid -gt 0) {
                Stop-Process -Id $ownPid -Force -ErrorAction SilentlyContinue 2>$null
            }
        }
    Start-Sleep -Seconds 2
}

# 清理函数
$global:Processes = @()
function Stop-All {
    Write-Warn "正在停止所有服务..."
    foreach ($proc in $global:Processes) {
        if ($proc -and -not $proc.HasExited) {
            try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
    # 清理残留进程（按名称）
    Get-Process -Name "python" -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path -match 'backend-python' } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process -Name "node" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'vite' } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Ok "所有服务已停止"
}

# Ctrl+C 处理
[Console]::TreatControlCAsInput = $false
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Stop-All }

Write-Host @"
========================================
  AI Talking 一键启动
========================================
"@ -ForegroundColor Blue

# 1. 检查 Redis
Write-Info "检查 Redis (端口 6379)..."
if (-not (Test-PortListen 6379)) {
    Write-Warn "Redis 未运行，尝试启动..."
    $redisPath = (Get-Command "redis-server" -ErrorAction SilentlyContinue).Source
    if (-not $redisPath) { $redisPath = "redis-server" }
    $redisProc = Start-Process -FilePath $redisPath -WindowStyle Hidden -PassThru -ErrorAction SilentlyContinue
    if ($redisProc) {
        Start-Sleep -Seconds 2
        if (Test-PortListen 6379) {
            $global:Processes += $redisProc
            Write-Ok "Redis 已启动 (PID: $($redisProc.Id))"
        } else {
            Write-Err "Redis 启动失败。请安装 Redis: https://github.com/tporadowski/redis/releases"
            exit 1
        }
    } else {
        Write-Err "无法找到 redis-server。请安装后加入 PATH"
        exit 1
    }
} else {
    Write-Ok "Redis 已在运行"
}

# 2. 检查后端 .env
$backendEnv = Join-Path $BackendDir ".env"
if (-not (Test-Path $backendEnv)) {
    $envExample = Join-Path $BackendDir ".env.example"
    if (Test-Path $envExample) {
        Copy-Item $envExample $backendEnv
        Write-Warn "已从 .env.example 创建 .env，请编辑填入 ARK_API_KEY 和 ARK_MODEL_ENDPOINT"
    } else {
        Write-Err "后端缺少 .env 配置文件"
        exit 1
    }
}

# 3. 检查后端虚拟环境
$venvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Warn "后端虚拟环境不存在，正在创建..."
    Push-Location $BackendDir
    python -m venv .venv
    & (Join-Path $BackendDir ".venv\Scripts\python.exe") -m pip install uv 2>$null
    & (Join-Path $BackendDir ".venv\Scripts\uv.exe") sync
    Pop-Location
    Write-Ok "虚拟环境创建完成"
}

# 4. 清理并启动后端
Write-Info "启动 Python 后端 (端口 $BackendPort)..."
if (Test-PortListen $BackendPort) {
    Write-Warn "端口 $BackendPort 已被占用，正在清理..."
    Clear-Port $BackendPort
}

$uvicornPath = Join-Path $BackendDir ".venv\Scripts\uvicorn.exe"
$backendProc = Start-Process -FilePath $uvicornPath `
    -ArgumentList "app.main:app", "--host", "0.0.0.0", "--port", $BackendPort `
    -WorkingDirectory $BackendDir -PassThru
$global:Processes += $backendProc
Write-Ok "后端进程已启动 (PID: $($backendProc.Id))"

Write-Info "等待后端就绪..."
if (-not (Wait-ForPortListen $BackendPort 15)) {
    Write-Err "后端启动超时"
    Stop-All
    exit 1
}

try {
    $health = Invoke-RestMethod -Uri "http://localhost:$BackendPort/api/health" -ErrorAction Stop
    if ($health.status -eq "ok") {
        Write-Ok "后端健康检查通过 (会话数: $($health.sessionCount))"
    }
} catch {
    Write-Warn "后端已启动但健康检查请求失败，可能需要几秒初始化"
}

# 5. 检查前端依赖
$nodeModules = Join-Path $FrontendDir "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Warn "前端依赖未安装，正在安装..."
    Push-Location $FrontendDir
    npm install
    Pop-Location
    Write-Ok "前端依赖安装完成"
}

# 6. 启动前端
Write-Info "启动前端开发服务器 (端口 $FrontendPort)..."
if (Test-PortListen $FrontendPort) {
    Write-Warn "端口 $FrontendPort 已被占用，正在清理..."
    Clear-Port $FrontendPort
}

$npmPath = (Get-Command "npm" -ErrorAction SilentlyContinue).Source
if (-not $npmPath) { $npmPath = "npm.cmd" }
# 使用 cmd.exe /c 包装，确保进程在 vite 运行期间不会退出
$frontendCmd = "cd /d `"$FrontendDir`" && npm run dev"
$frontendProc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", $frontendCmd `
    -WorkingDirectory $FrontendDir -PassThru -WindowStyle Hidden
$global:Processes += $frontendProc
Write-Ok "前端进程已启动 (PID: $($frontendProc.Id))"

# 等待前端就绪
Write-Info "等待前端就绪..."
if (-not (Wait-ForPortListen $FrontendPort 15)) {
    Write-Warn "前端启动超时，请检查是否运行: http://localhost:$FrontendPort"
} else {
    Write-Ok "前端已就绪"
}

Write-Host @"

========================================
  AI Talking 所有服务已启动！
========================================
  前端:    http://localhost:$FrontendPort
  后端:    http://localhost:$BackendPort
  API文档: http://localhost:$BackendPort/docs
========================================
  按 Ctrl+C 停止所有服务
========================================

"@ -ForegroundColor Green

# 监控循环
while ($true) {
    Start-Sleep -Seconds 3
    if ($backendProc -and $backendProc.HasExited) {
        Write-Err "后端进程已退出 (ExitCode: $($backendProc.ExitCode))"
        break
    }
    if ($frontendProc -and $frontendProc.HasExited) {
        Write-Err "前端进程已退出 (ExitCode: $($frontendProc.ExitCode))"
        break
    }
}

Stop-All
