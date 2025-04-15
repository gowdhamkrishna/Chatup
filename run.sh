#!/bin/bash

# Kill any existing node processes running the server
pkill -f "node server.js" || echo "No server running"

# Clean up any problematic socket files
rm -f /tmp/vscode-typescript*/*/tscancellation-*.tmp* 2>/dev/null || true

# Run with more memory and optimized settings
NODE_ENV=production node \
  --max-old-space-size=2048 \
  --optimize-for-size \
  --trace-warnings \
  --unhandled-rejections=strict \
  server.js &

# Wait a moment for the server to start
sleep 2

# Start the Next.js client
cd ~/chatib/chat && npm run dev 