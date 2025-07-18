// Quick diagnostic for Safe WhatsApp Bot
const fetch = require('node-fetch');

async function diagnoseBot() {
    console.log('🔍 Diagnosing Safe WhatsApp Bot...\n');
    
    try {
        // Check if server is responding
        const response = await fetch('http://localhost:3001/api/status');
        
        if (!response.ok) {
            console.log('❌ Bot server not responding properly');
            return;
        }
        
        const status = await response.json();
        
        console.log('📊 Current Bot Status:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`🔗 Connected: ${status.connected ? '✅ YES' : '❌ NO'}`);
        console.log(`📬 Queue Length: ${status.queueLength}`);
        console.log(`⚙️  Processing: ${status.processing ? '✅ YES' : '❌ NO'}`);
        console.log('');
        
        console.log('📈 Statistics:');
        console.log(`📤 Messages Sent: ${status.stats.messagesSent}`);
        console.log(`📅 Daily Count: ${status.stats.dailyCount}/1000`);
        console.log(`⏱️  Per Minute: ${status.stats.messagesPerMinute}/15`);
        console.log(`📆 Last Reset: ${status.stats.lastReset}`);
        console.log('');
        
        // Diagnose issues
        console.log('🔧 Diagnosis:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        if (!status.connected) {
            console.log('❌ ISSUE: WhatsApp not connected');
            console.log('   🔧 Solution: Scan QR code again in WhatsApp Web browser');
        } else {
            console.log('✅ WhatsApp connection: OK');
        }
        
        if (status.stats.dailyCount >= 1000) {
            console.log('❌ ISSUE: Daily limit reached (1000 messages)');
            console.log('   🔧 Solution: Wait until tomorrow or restart bot to reset');
        } else {
            console.log('✅ Daily limit: OK');
        }
        
        if (status.stats.messagesPerMinute >= 15) {
            console.log('❌ ISSUE: Rate limit reached (15 per minute)');
            console.log('   🔧 Solution: Wait 1 minute before sending more messages');
        } else {
            console.log('✅ Rate limit: OK');
        }
        
        if (!status.processing && status.queueLength > 0) {
            console.log('❌ ISSUE: Queue processor stopped');
            console.log('   🔧 Solution: Restart the bot');
        } else if (status.queueLength === 0) {
            console.log('✅ Queue: Empty (ready for new messages)');
        } else {
            console.log('✅ Queue processor: Running');
        }
        
        console.log('');
        console.log('🚀 Quick Test:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        if (status.connected && status.stats.dailyCount < 1000 && status.stats.messagesPerMinute < 15) {
            console.log('✅ Bot is ready to send messages!');
            console.log('');
            console.log('💡 Try this test:');
            console.log('1. Open http://localhost:3001');
            console.log('2. Enter phone number: +886928316907');
            console.log('3. Click "Validate Number" (should work)');
            console.log('4. Enter message: "Test from Safe Bot"');
            console.log('5. Click "Add to Queue"');
            console.log('');
            console.log('👀 Watch the Activity Logs section for updates');
        } else {
            console.log('⚠️  Bot has issues that need to be resolved first');
        }
        
    } catch (error) {
        console.log('❌ Error connecting to bot:', error.message);
        console.log('');
        console.log('🔧 Possible solutions:');
        console.log('1. Make sure the bot is running: node safe-whatsapp-bot.js');
        console.log('2. Check if port 3001 is accessible');
        console.log('3. Restart the bot if needed');
    }
}

diagnoseBot();
