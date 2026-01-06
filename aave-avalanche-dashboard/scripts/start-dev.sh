#!/bin/bash
# Start Development Environment
# Starts local blockchain and frontend

set -e

echo "🚀 Starting TiltVault Development Environment"

# Check if .env.development exists
if [ ! -f ".env.development" ]; then
    echo "⚠️  .env.development not found"
    echo "Run: ./scripts/env-setup.sh development"
    exit 1
fi

# Load development environment
export $(cat .env.development | grep -v '^#' | xargs)

# Start Hardhat node in background
echo "📡 Starting Hardhat local node..."
cd contracts
npx hardhat node > ../hardhat.log 2>&1 &
HARDHAT_PID=$!
cd ..

# Wait for Hardhat to start
echo "⏳ Waiting for Hardhat node to start..."
sleep 5

# Check if Hardhat is running
if ! curl -s http://localhost:8545 > /dev/null; then
    echo "❌ Failed to start Hardhat node"
    kill $HARDHAT_PID 2>/dev/null || true
    exit 1
fi

echo "✅ Hardhat node running on http://localhost:8545"

# Deploy contracts
echo "📦 Deploying contracts to local network..."
cd contracts
npx hardhat run scripts/deploy.js --network hardhat
cd ..

# Start frontend
echo "🌐 Starting frontend..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ Development environment started!"
echo "📡 Hardhat: http://localhost:8545"
echo "🌐 Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for user interrupt
trap "echo '🛑 Stopping services...'; kill $HARDHAT_PID $FRONTEND_PID 2>/dev/null || true; exit" INT
wait

