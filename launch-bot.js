#!/usr/bin/env node

console.log('🚀 Safe WhatsApp Bot Launcher');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📅 Date: ${new Date().toLocaleString()}`);
console.log(`📁 Directory: ${process.cwd()}`);
console.log(`📦 Node Version: ${process.version}`);
console.log('');

console.log('🔍 Checking dependencies...');
try {
    require('express');
    console.log('✅ express - OK');
} catch (e) {
    console.log('❌ express - MISSING');
    process.exit(1);
}

try {
    require('socket.io');
    console.log('✅ socket.io - OK');
} catch (e) {
    console.log('❌ socket.io - MISSING');
    process.exit(1);
}

try {
    require('./index');
    console.log('✅ whatsapp-web.js - OK');
} catch (e) {
    console.log('❌ whatsapp-web.js - ERROR:', e.message);
    process.exit(1);
}

console.log('');
console.log('🚀 Starting Safe WhatsApp Bot...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Import and start the bot
try {
    const SafeWhatsAppBot = require('./safe-whatsapp-bot.js');
    console.log('✅ Bot loaded successfully!');
} catch (error) {
    console.error('❌ Error loading bot:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
}
