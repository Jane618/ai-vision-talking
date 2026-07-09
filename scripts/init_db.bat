@echo off
REM 初始化 PostgreSQL 数据库 - AI Talking
REM 用法：双节运行，或在 psql 可用的环境下运行

set DB_NAME=ai_talking
set DB_USER=postgres
set DB_PASS=postgres

echo [1/3] 创建数据库 %DB_NAME%...
psql -h localhost -U %DB_USER% -c "CREATE DATABASE %DB_NAME%;" 2>nul
if %ERRORLEVEL% neq 0 (
    echo 数据库已存在或创建失败，继续执行...
)

echo [2/3] 初始化表结构...
set PGPASSWORD=%DB_PASS%
psql -h localhost -U %DB_USER% -d %DB_NAME% -f "%~dp0..\backend-python\scripts\init_db.sql"
if %ERRORLEVEL% neq 0 (
    echo [错误] 建表失败，请检查 PostgreSQL 是否运行、用户名密码是否正确
    pause
    exit /b 1
)

echo [3/3] 完成！数据库 %DB_NAME% 已就绪
pause
