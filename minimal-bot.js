const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

console.log('🚀 Starting Minimal Safe WhatsApp Bot...');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Basic status endpoint
app.get('/api/status', (req, res) => {
    console.log('📊 Status requested');
    res.json({
        connected: false,
        status: 'Bot is running but WhatsApp not connected yet',
        timestamp: new Date().toISOString()
    });
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('🔗 Client connected to web interface');
    
    socket.emit('status', {
        connected: false,
        message: 'Bot is running, WhatsApp not connected yet'
    });

    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected from web interface');
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, (err) => {
    if (err) {
        console.error('❌ Error starting server:', err);
        process.exit(1);
    }
    console.log(`🌐 Web interface running on http://localhost:${PORT}`);
    console.log('📱 Open your browser and go to the URL above');
    console.log('');
    console.log('🎯 Next steps:');
    console.log('1. Open http://localhost:3001 in your browser');
    console.log('2. You should see "Connecting to bot..." change to connected');
    console.log('3. WhatsApp integration will be added once this works');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down bot...');
    server.close();
    process.exit(0);
});
