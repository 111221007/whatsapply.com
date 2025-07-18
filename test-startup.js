// Simple test to check bot startup
console.log('🔍 Testing Safe WhatsApp Bot startup...');

try {
    console.log('📦 Checking dependencies...');
    const express = require('express');
    const socketIo = require('socket.io');
    const { Client, LocalAuth } = require('./index');
    console.log('✅ All dependencies found');
    
    console.log('🚀 Starting minimal server test...');
    const app = express();
    const http = require('http');
    const server = http.createServer(app);
    
    const PORT = 3001;
    server.listen(PORT, () => {
        console.log(`✅ Server started successfully on port ${PORT}`);
        console.log(`🌐 Test URL: http://localhost:${PORT}`);
        
        // Close after 2 seconds for testing
        setTimeout(() => {
            server.close();
            console.log('✅ Test completed successfully');
            process.exit(0);
        }, 2000);
    });
    
} catch (error) {
    console.error('❌ Error during startup test:', error.message);
    process.exit(1);
}
