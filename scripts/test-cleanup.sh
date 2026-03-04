#!/bin/bash

# 测试退出时清理功能的脚本

echo "=== OpenCowork 清理功能测试 ==="
echo ""

# 1. 检查端口是否被占用
check_port() {
    local port=$1
    if command -v lsof &> /dev/null; then
        # macOS/Linux
        if lsof -ti :$port &> /dev/null; then
            echo "✅ 端口 $port 被占用"
            return 0
        else
            echo "❌ 端口 $port 未被占用"
            return 1
        fi
    elif command -v netstat &> /dev/null; then
        # Windows (Git Bash)
        if netstat -ano | findstr ":$port" | findstr "LISTENING" &> /dev/null; then
            echo "✅ 端口 $port 被占用"
            return 0
        else
            echo "❌ 端口 $port 未被占用"
            return 1
        fi
    else
        echo "⚠️  无法检测端口状态（缺少 lsof 或 netstat）"
        return 2
    fi
}

# 2. 启动测试服务器
echo "步骤 1: 启动测试服务器在端口 3000..."
if command -v python3 &> /dev/null; then
    # 使用 Python 启动简单的 HTTP 服务器
    python3 -m http.server 3000 &
    TEST_PID=$!
    echo "测试服务器已启动 (PID: $TEST_PID)"
    sleep 2
elif command -v node &> /dev/null; then
    # 使用 Node.js 启动简单的服务器
    node -e "require('http').createServer((req, res) => res.end('Test')).listen(3000)" &
    TEST_PID=$!
    echo "测试服务器已启动 (PID: $TEST_PID)"
    sleep 2
else
    echo "❌ 未找到 Python 或 Node.js，无法启动测试服务器"
    exit 1
fi

# 3. 检查端口是否被占用
echo ""
echo "步骤 2: 检查端口 3000 状态..."
check_port 3000

# 4. 提示用户
echo ""
echo "步骤 3: 请执行以下操作："
echo "  1. 启动 OpenCowork 应用"
echo "  2. 在应用中打开 http://localhost:3000"
echo "  3. 退出 OpenCowork 应用"
echo "  4. 按回车键继续测试..."
read -r

# 5. 检查端口是否被释放
echo ""
echo "步骤 4: 检查端口 3000 是否已被释放..."
if check_port 3000; then
    echo "❌ 测试失败：端口 3000 仍被占用"
    echo "   清理功能可能未正常工作"
    
    # 手动清理
    echo ""
    echo "正在手动清理测试服务器..."
    if [ ! -z "$TEST_PID" ]; then
        kill -9 $TEST_PID 2>/dev/null || true
    fi
    
    # 强制清理端口
    if command -v lsof &> /dev/null; then
        lsof -ti :3000 | xargs kill -9 2>/dev/null || true
    fi
    
    exit 1
else
    echo "✅ 测试成功：端口 3000 已被释放"
    echo "   清理功能正常工作"
fi

# 6. 清理测试进程
if [ ! -z "$TEST_PID" ]; then
    kill -9 $TEST_PID 2>/dev/null || true
fi

echo ""
echo "=== 测试完成 ==="
