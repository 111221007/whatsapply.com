#!/bin/bash

# Safe WhatsApp Bot Startup Script
echo "🚀 Starting Safe WhatsApp Bot with Web Interface..."
echo ""

# Check if dependencies are installed
if [ ! -d "node_modules/express" ] || [ ! -d "node_modules/socket.io" ]; then
    echo "📦 Installing required dependencies..."
    npm install express socket.io
    echo "✅ Dependencies installed!"
    echo ""
fi

# Start the bot
echo "🌐 Starting Safe WhatsApp Bot..."
echo "📱 Web interface will be available at: http://localhost:3000"
echo "🔗 Browser will open automatically for WhatsApp authentication"
echo ""
echo "📋 What happens next:"
echo "1. A browser window will open for WhatsApp Web"
echo "2. Scan the QR code with your WhatsApp mobile app"
echo "3. Open http://localhost:3000 in another tab for the control panel"
echo ""
echo "Press Ctrl+C to stop the bot"
echo "----------------------------------------"

node safe-whatsapp-bot.js
