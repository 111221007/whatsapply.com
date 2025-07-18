const express = require('express');
const path = require('path');

console.log('🔧 Starting minimal debug server...');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/debug-status', (req, res) => {
    console.log('Debug status requested');
    res.json({
        timestamp: new Date().toISOString(),
        connection: {
            isConnected: false,
            clientState: 'debug mode'
        },
        processing: {
            isProcessing: false,
            queueLength: 0,
            messagesInQueue: []
        },
        stats: {
            messagesSent: 0,
            messagesPerMinute: 0,
            dailyCount: 0
        },
        rateLimiter: {
            maxPerMinute: 15,
            maxPerDay: 1000,
            minDelay: 6000, // 6 seconds
            maxDelay: 10000 // 10 seconds
        }
    });
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`🌐 Debug server running on http://localhost:${PORT}`);
});
