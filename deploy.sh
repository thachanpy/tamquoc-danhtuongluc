#!/bin/bash

set -e

SERVER="app@tamquoc-gacha"
SSH_PORT="22000"

echo "🚀 Starting deployment..."

ssh -p "$SSH_PORT" "$SERVER" <<'REMOTE'
set -e

cd ~/game/tamquoc-vosong

echo "📥 Pulling latest code..."
git pull

echo "📦 Installing dependencies..."
pnpm install

echo "🏗️ Building application..."
pnpm run build

echo "♻️ Restarting PM2..."
pm2 restart pm2.config.json

echo "✅ Deployment completed successfully!"
REMOTE
