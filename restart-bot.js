#!/usr/bin/env node

console.log('🔄 Restarting WhatsApp Bot...');

// Kill any existing processes
const { exec } = require('child_process');

exec('lsof -ti:3001', (error, stdout, stderr) => {
    if (stdout.trim()) {
        console.log('🔪 Killing existing process on port 3001...');
        exec(`kill -9 ${stdout.trim()}`, (err) => {
            if (err) console.log('Note: Could not kill process');
            startBot();
        });
    } else {
        startBot();
    }
});

function startBot() {
    console.log('🚀 Starting fresh bot instance...');
    
    try {
        const SafeWhatsAppBot = require('./safe-whatsapp-bot.js');
        global.bot = new SafeWhatsAppBot();
        console.log('✅ Bot started successfully!');
        console.log('🌐 Visit: http://localhost:3001');
    } catch (error) {
        console.error('❌ Failed to start bot:', error.message);
        console.error('Stack:', error.stack);
    }
}
