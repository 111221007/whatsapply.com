const { Client, LocalAuth } = require('./index');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

class SafeWhatsAppBot {
    constructor() {
        console.log('🔧 Initializing SafeWhatsAppBot...');
        
        this.client = null;
        this.isConnected = false;
        this.messageQueue = [];
        this.isProcessing = false;
        this.stats = {
            messagesSent: 0,
            messagesPerMinute: 0,
            dailyCount: 0,
            lastReset: new Date().toDateString()
        };
        this.rateLimiter = {
            maxPerMinute: 15,
            maxPerDay: 1000,
            minDelay: 6000, // 6 seconds
            maxDelay: 10000, // 10 seconds
            breakAfter: 10, // Take break after 10 messages
            breakDuration: 300000 // 5 minutes
        };
        
        console.log('📊 Configuration loaded');
        console.log('🌐 Setting up web server...');
        this.setupWebServer();
        console.log('📱 Starting WhatsApp initialization in background...');
        // Start WhatsApp initialization asynchronously without blocking server startup
        this.initializeWhatsApp().catch(error => {
            console.error('❌ Failed to initialize WhatsApp:', error);
        });
        console.log('✅ SafeWhatsAppBot constructor completed');
    }

    async initializeWhatsApp() {
        try {
            console.log('📱 Creating WhatsApp client...');
            this.client = new Client({
                authStrategy: new LocalAuth({ clientId: 'safe-bot' }),
                puppeteer: { 
                    headless: process.env.NODE_ENV === 'production' ? true : false,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--single-process',
                        '--disable-gpu'
                    ]
                }
            });

            console.log('🔧 Setting up event handlers...');
            this.setupEventHandlers();
            console.log('🚀 Initializing WhatsApp client...');
            
            // Set a timeout to prevent Heroku from timing out
            const initTimeout = setTimeout(() => {
                console.log('⏰ WhatsApp initialization taking longer than expected...');
                this.broadcastToClients('status', { 
                    message: 'WhatsApp initialization in progress...',
                    status: 'initializing'
                });
            }, 30000); // 30 seconds
            
            await this.client.initialize();
            clearTimeout(initTimeout);
            console.log('✅ WhatsApp client initialization completed');
        } catch (error) {
            console.error('❌ WhatsApp initialization error:', error);
            // Don't crash the app, just log the error and continue
            this.broadcastToClients('error', { 
                message: 'Failed to initialize WhatsApp client',
                error: error.message,
                timestamp: new Date().toISOString()
            });
            // Keep the server running even if WhatsApp fails
            console.log('🔄 Server continues running despite WhatsApp error');
        }
    }

    setupEventHandlers() {
        this.client.on('qr', (qr) => {
            console.log('QR Code received');
            this.broadcastToClients('qr', { qr });
        });

        this.client.on('authenticated', () => {
            console.log('WhatsApp authenticated successfully');
            this.broadcastToClients('authenticated', { status: 'authenticated' });
        });

        this.client.on('ready', async () => {
            console.log('WhatsApp client is ready');
            this.isConnected = true;
            const info = this.client.info;
            this.broadcastToClients('ready', { 
                status: 'ready', 
                info: {
                    name: info.pushname,
                    number: info.wid.user,
                    platform: info.platform
                }
            });
            this.startMessageProcessor();
        });

        this.client.on('disconnected', (reason) => {
            console.log('WhatsApp disconnected:', reason);
            this.isConnected = false;
            this.broadcastToClients('disconnected', { reason });
        });

        this.client.on('message', (message) => {
            this.broadcastToClients('message_received', {
                from: message.from,
                body: message.body,
                timestamp: message.timestamp
            });
        });
    }

    setupWebServer() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server);

        this.app.use(express.static(path.join(__dirname, 'public')));
        this.app.use(express.json());

        // API Routes
        this.app.get('/api/status', (req, res) => {
            res.json({
                connected: this.isConnected,
                stats: this.stats,
                queueLength: this.messageQueue.length,
                processing: this.isProcessing
            });
        });

        this.app.post('/api/send-message', async (req, res) => {
            try {
                const { number, message, priority = 'normal' } = req.body;
                
                if (!number || !message) {
                    return res.status(400).json({ error: 'Number and message are required' });
                }

                const result = await this.queueMessage(number, message, priority);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/validate-number', async (req, res) => {
            try {
                const { number } = req.body;
                const isValid = await this.isValidWhatsAppUser(number);
                res.json({ valid: isValid });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.get('/api/contacts', async (req, res) => {
            try {
                if (!this.isConnected) {
                    return res.status(400).json({ error: 'WhatsApp not connected' });
                }
                const contacts = await this.client.getContacts();
                res.json(contacts.slice(0, 100)); // Limit to first 100
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Force start message processing
        this.app.post('/api/start-processing', (req, res) => {
            if (!this.isConnected) {
                return res.status(400).json({ error: 'WhatsApp not connected' });
            }
            
            if (this.messageQueue.length === 0) {
                return res.json({ message: 'No messages in queue' });
            }
            
            if (this.isProcessing) {
                return res.json({ message: 'Already processing messages' });
            }
            
            console.log('🚀 Manually starting message processor...');
            this.startMessageProcessor();
            res.json({ success: true, message: 'Message processing started' });
        });

        // Debug endpoint for real-time monitoring
        this.app.get('/api/debug-status', async (req, res) => {
            try {
                let clientState = 'unknown';
                try {
                    clientState = this.client ? await this.client.getState() : 'not initialized';
                } catch (error) {
                    clientState = 'error: ' + error.message;
                }
                
                const response = {
                    timestamp: new Date().toISOString(),
                    connection: {
                        isConnected: this.isConnected,
                        clientState: clientState
                    },
                    processing: {
                        isProcessing: this.isProcessing,
                        queueLength: this.messageQueue.length,
                        messagesInQueue: this.messageQueue.map(m => ({
                            number: m.number,
                            message: m.message ? m.message.substring(0, 50) + '...' : 'no message',
                            status: m.status,
                            retries: m.retries,
                            queuedAt: m.queuedAt
                        }))
                    },
                    stats: this.stats,
                    rateLimiter: this.rateLimiter
                };
                
                res.json(response);
            } catch (error) {
                console.error('Debug status error:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Quick test endpoint
        this.app.get('/api/test-message/:number/:message', async (req, res) => {
            const number = req.params.number;
            const message = decodeURIComponent(req.params.message);
            
            console.log(`🌐 HTTP test message request: ${number} -> ${message}`);
            
            try {
                await this.queueMessage(number, message);
                res.json({ success: true, message: 'Message queued for testing' });
            } catch (error) {
                console.error('❌ HTTP queue error:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Socket.IO for real-time updates
        console.log('🔌 Setting up Socket.IO...');
        this.io.on('connection', (socket) => {
            console.log('🔗 Client connected to web interface');
            
            // Send current status immediately
            socket.emit('status', {
                connected: this.isConnected,
                stats: this.stats,
                queueLength: this.messageQueue.length,
                processing: this.isProcessing
            });

            socket.on('disconnect', () => {
                console.log('🔌 Client disconnected from web interface');
            });

            socket.on('error', (error) => {
                console.error('❌ Socket error:', error);
            });
        });

        this.io.on('error', (error) => {
            console.error('❌ Socket.IO server error:', error);
        });

        const PORT = process.env.PORT || 3001;
        
        // Add health check endpoint before starting WhatsApp client
        this.app.get('/health', (req, res) => {
            res.status(200).json({ 
                status: 'ok', 
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });

        this.server.listen(PORT, '0.0.0.0', () => {
            console.log(`🌐 Web interface running on port ${PORT}`);
            console.log(`🔌 Socket.IO ready for connections`);
            console.log(`📱 Health check available at /health`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        });

        this.server.on('error', (error) => {
            console.error('❌ Server error:', error);
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Port ${PORT} is already in use. Try a different port.`);
                process.exit(1);
            }
        });
    }

    async queueMessage(number, message, priority = 'normal') {
        const queueTime = new Date().toLocaleTimeString();
        console.log(`📥 [QUEUE] queueMessage called at ${queueTime} for ${number}, priority: ${priority}`);
        
        // Validate number format
        const formattedNumber = this.formatPhoneNumber(number);
        console.log(`📞 [QUEUE] Formatted number: ${formattedNumber} at ${queueTime}`);
        if (!formattedNumber) {
            console.log(`❌ [QUEUE] Invalid phone number format at ${queueTime}`);
            throw new Error('Invalid phone number format');
        }

        // Check daily limit
        console.log(`📊 [QUEUE] Daily count check at ${queueTime}: ${this.stats.dailyCount}/${this.rateLimiter.maxPerDay}`);
        if (this.stats.dailyCount >= this.rateLimiter.maxPerDay) {
            console.log(`❌ [QUEUE] Daily message limit reached at ${queueTime}`);
            throw new Error('Daily message limit reached');
        }

        // Validate WhatsApp user
        console.log(`🔍 [QUEUE] Validating WhatsApp user: ${formattedNumber} at ${queueTime}`);
        console.log(`🔗 [QUEUE] WhatsApp connected: ${this.isConnected} at ${queueTime}`);
        
        const isValid = await this.isValidWhatsAppUser(formattedNumber);
        console.log(`✅ [QUEUE] Number validation result: ${isValid} at ${new Date().toLocaleTimeString()}`);
        
        if (!isValid && this.isConnected) {
            // Only strict validation when WhatsApp is connected
            console.log(`❌ [QUEUE] Number is not a valid WhatsApp user at ${new Date().toLocaleTimeString()}`);
            throw new Error('Number is not a valid WhatsApp user. Please check the number and try again.');
        } else if (!isValid && !this.isConnected) {
            // When not connected, allow format-valid numbers but warn
            console.log(`⚠️ [QUEUE] Cannot verify WhatsApp user (not connected), allowing number at ${new Date().toLocaleTimeString()}`);
        }

        const messageObj = {
            id: Date.now() + Math.random(),
            number: formattedNumber,
            message,
            priority,
            timestamp: Date.now(),
            queuedAt: new Date().toLocaleTimeString(),
            status: 'queued',
            retries: 0
        };

        console.log(`📝 [QUEUE] Created message object at ${new Date().toLocaleTimeString()}:`, {
            id: messageObj.id,
            number: messageObj.number,
            message: messageObj.message.substring(0, 50) + '...',
            priority: messageObj.priority,
            queuedAt: messageObj.queuedAt
        });

        // Add to queue based on priority
        if (priority === 'high') {
            this.messageQueue.unshift(messageObj);
            console.log(`⚡ [QUEUE] Added HIGH PRIORITY message to front of queue at ${new Date().toLocaleTimeString()}`);
        } else {
            this.messageQueue.push(messageObj);
            console.log(`📬 [QUEUE] Added NORMAL priority message to end of queue at ${new Date().toLocaleTimeString()}`);
        }

        console.log(`� [QUEUE] Queue status at ${new Date().toLocaleTimeString()}: Length=${this.messageQueue.length}, Processing=${this.isProcessing}, Connected=${this.isConnected}`);

        this.broadcastToClients('message_queued', messageObj);
        
        // Start message processor if not already running
        if (!this.isProcessing && this.isConnected) {
            console.log(`🚀 [QUEUE] Starting message processor at ${new Date().toLocaleTimeString()}...`);
            this.startMessageProcessor();
        } else {
            console.log(`⚠️ [QUEUE] Not starting processor at ${new Date().toLocaleTimeString()}: processing=${this.isProcessing}, connected=${this.isConnected}`);
            if (!this.isConnected) {
                console.log(`🔌 [QUEUE] WhatsApp not connected - message will wait in queue`);
            }
            if (this.isProcessing) {
                console.log(`⚙️ [QUEUE] Processor already running - message added to queue`);
            }
        }
        
        const result = {
            success: true,
            messageId: messageObj.id,
            queuePosition: this.messageQueue.length,
            queuedAt: messageObj.queuedAt
        };
        
        console.log(`✅ [QUEUE] Message queued successfully at ${new Date().toLocaleTimeString()}: Position ${result.queuePosition} in queue`);
        return result;
    }

    async startMessageProcessor() {
        console.log('🔄 [PROCESSOR] startMessageProcessor called at', new Date().toLocaleTimeString());
        
        if (this.isProcessing) {
            console.log('⚠️ [PROCESSOR] Already processing, returning at', new Date().toLocaleTimeString());
            return;
        }
        
        console.log('✅ [PROCESSOR] Setting isProcessing = true at', new Date().toLocaleTimeString());
        this.isProcessing = true;
        
        console.log(`📬 [PROCESSOR] Queue length: ${this.messageQueue.length} at`, new Date().toLocaleTimeString());
        console.log(`🔗 [PROCESSOR] Connected: ${this.isConnected} at`, new Date().toLocaleTimeString());
        
        while (this.messageQueue.length > 0 && this.isConnected) {
            const message = this.messageQueue.shift();
            const processingTime = new Date().toLocaleTimeString();
            console.log(`📤 [PROCESSOR] Processing message at ${processingTime}:`, {
                number: message.number,
                message: message.message.substring(0, 50) + '...',
                queuedAt: new Date(message.timestamp).toLocaleTimeString()
            });
            
            try {
                console.log(`🚀 [PROCESSOR] Calling sendMessageSafely at ${new Date().toLocaleTimeString()}...`);
                const startTime = Date.now();
                await this.sendMessageSafely(message);
                const endTime = Date.now();
                const duration = ((endTime - startTime) / 1000).toFixed(2);
                console.log(`✅ [PROCESSOR] sendMessageSafely completed in ${duration}s at ${new Date().toLocaleTimeString()}`);
                
                this.updateStats();
                
                // Take break after certain number of messages
                if (this.stats.messagesSent % this.rateLimiter.breakAfter === 0) {
                    const breakTime = new Date().toLocaleTimeString();
                    console.log(`😴 [PROCESSOR] Taking a longer break at ${breakTime}...`);
                    this.broadcastToClients('status_update', { 
                        message: `Taking a ${this.rateLimiter.breakDuration/1000/60} minute break` 
                    });
                    await this.delay(this.rateLimiter.breakDuration);
                }
                
            } catch (error) {
                const errorTime = new Date().toLocaleTimeString();
                console.error(`❌ [PROCESSOR] Error sending message at ${errorTime}:`, error.message);
                message.status = 'failed';
                message.error = error.message;
                this.broadcastToClients('message_failed', message);
            }
            
            // Random delay between messages with countdown
            const delay = Math.random() * (this.rateLimiter.maxDelay - this.rateLimiter.minDelay) + this.rateLimiter.minDelay;
            const delaySeconds = Math.round(delay/1000);
            console.log(`⏱️ [PROCESSOR] Waiting ${delaySeconds} seconds before next message (started at ${new Date().toLocaleTimeString()})...`);
            
            // Show countdown timer
            for (let i = delaySeconds; i > 0; i--) {
                if (i <= 5 || i % 5 === 0) {
                    console.log(`⏰ [TIMER] ${i} seconds remaining...`);
                }
                await this.delay(1000);
            }
            console.log(`✅ [TIMER] Delay completed at ${new Date().toLocaleTimeString()}`);
        }
        
        console.log(`🏁 [PROCESSOR] Message processor finished at ${new Date().toLocaleTimeString()}`);
        this.isProcessing = false;
    }

    async sendMessageSafely(messageObj) {
        const sendTime = new Date().toLocaleTimeString();
        console.log(`🚀 [SEND] sendMessageSafely called at ${sendTime} for ${messageObj.number}`);
        console.log(`📋 [SEND] Message details:`, {
            number: messageObj.number,
            message: messageObj.message,
            retries: messageObj.retries,
            queuedAt: new Date(messageObj.timestamp).toLocaleTimeString()
        });
        
        try {
            // Check rate limits
            console.log(`📊 [SEND] Rate check at ${new Date().toLocaleTimeString()}: ${this.stats.messagesPerMinute}/${this.rateLimiter.maxPerMinute} per minute`);
            if (this.stats.messagesPerMinute >= this.rateLimiter.maxPerMinute) {
                console.log(`⚠️ [SEND] Rate limit reached at ${new Date().toLocaleTimeString()}, waiting 1 minute...`);
                await this.delay(60000); // Wait 1 minute
                this.stats.messagesPerMinute = 0;
                console.log(`✅ [SEND] Rate limit wait completed at ${new Date().toLocaleTimeString()}`);
            }

            // Check if client is connected
            console.log(`🔗 [SEND] Checking client connection state at ${new Date().toLocaleTimeString()}...`);
            const clientState = await this.client.getState();
            console.log(`📱 [SEND] Client state at ${new Date().toLocaleTimeString()}:`, clientState);
            
            if (clientState !== 'CONNECTED') {
                throw new Error(`Client not connected. State: ${clientState}`);
            }

            console.log(`📞 [SEND] Sending message to WhatsApp API at ${new Date().toLocaleTimeString()}...`);
            console.log(`📧 [SEND] Target: ${messageObj.number}`);
            console.log(`💬 [SEND] Content: ${messageObj.message}`);
            
            const apiStartTime = Date.now();
            const result = await this.client.sendMessage(messageObj.number, messageObj.message);
            const apiEndTime = Date.now();
            const apiDuration = ((apiEndTime - apiStartTime) / 1000).toFixed(2);
            
            console.log(`✅ [SEND] WhatsApp API responded in ${apiDuration}s at ${new Date().toLocaleTimeString()}`);
            console.log(`📨 [SEND] Message ID: ${result.id?.id || 'unknown'}`);
            
            messageObj.status = 'sent';
            messageObj.messageId = result.id?.id || 'unknown';
            messageObj.sentAt = Date.now();

            this.broadcastToClients('message_sent', messageObj);
            console.log(`📺 [SEND] Broadcasted message_sent event at ${new Date().toLocaleTimeString()}`);
            
            console.log(`🎉 [SUCCESS] Message successfully sent to ${messageObj.number} at ${new Date().toLocaleTimeString()}`);
            console.log(`📊 [SUCCESS] Total processing time: ${((Date.now() - messageObj.timestamp) / 1000).toFixed(2)}s`);
            
            return result;
        } catch (error) {
            const errorTime = new Date().toLocaleTimeString();
            console.error(`❌ [ERROR] sendMessageSafely failed at ${errorTime}:`, error.message);
            console.error(`📋 [ERROR] Error details:`, {
                number: messageObj.number,
                attempt: messageObj.retries + 1,
                error: error.message
            });
            
            messageObj.retries++;
            
            if (messageObj.retries < 3) {
                // Retry after delay
                console.log(`🔄 [RETRY] Scheduling retry ${messageObj.retries}/3 for ${messageObj.number} at ${new Date().toLocaleTimeString()}`);
                console.log(`⏱️ [RETRY] Will retry in 30 seconds...`);
                await this.delay(30000); // Wait 30 seconds before retry
                this.messageQueue.unshift(messageObj); // Add back to front of queue
                console.log(`📬 [RETRY] Message re-queued for retry at ${new Date().toLocaleTimeString()}`);
            } else {
                console.error(`💥 [FAILED] All retry attempts (3/3) failed for ${messageObj.number} at ${new Date().toLocaleTimeString()}`);
                throw error;
            }
        }
    }

    async isValidWhatsAppUser(number) {
        try {
            // If not connected, skip WhatsApp validation and just validate format
            if (!this.isConnected) {
                console.log(`⚠️ [VALIDATION] WhatsApp not connected, skipping user validation for ${number}`);
                return true; // Allow format-valid numbers when not connected
            }
            
            const numberId = await this.client.getNumberId(number);
            const isValid = numberId !== null;
            console.log(`🔍 [VALIDATION] WhatsApp user check for ${number}: ${isValid ? 'Valid' : 'Invalid'}`);
            return isValid;
        } catch (error) {
            console.error('Error validating number:', error);
            // If validation fails due to error, be lenient and allow the number
            console.log(`⚠️ [VALIDATION] Validation error for ${number}, allowing due to error: ${error.message}`);
            return true;
        }
    }

    formatPhoneNumber(number) {
        // Remove all non-numeric characters
        const cleaned = number.replace(/\D/g, '');
        
        // Basic validation
        if (cleaned.length < 10 || cleaned.length > 15) {
            return null;
        }
        
        return cleaned + '@c.us';
    }

    updateStats() {
        const today = new Date().toDateString();
        
        // Reset daily count if new day
        if (this.stats.lastReset !== today) {
            this.stats.dailyCount = 0;
            this.stats.lastReset = today;
        }
        
        this.stats.messagesSent++;
        this.stats.dailyCount++;
        this.stats.messagesPerMinute++;
        
        // Reset per-minute counter every minute
        setTimeout(() => {
            this.stats.messagesPerMinute = Math.max(0, this.stats.messagesPerMinute - 1);
        }, 60000);
        
        this.broadcastToClients('stats_update', this.stats);
    }

    broadcastToClients(event, data) {
        if (this.io) {
            this.io.emit(event, data);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async shutdown() {
        console.log('Shutting down WhatsApp bot...');
        this.isProcessing = false;
        
        if (this.client) {
            await this.client.destroy();
        }
        
        if (this.server) {
            this.server.close();
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    if (global.bot) {
        await global.bot.shutdown();
    }
    process.exit(0);
});

// Start the bot
console.log('🚀 Starting Safe WhatsApp Bot...');
console.log(`📅 Time: ${new Date().toLocaleString()}`);
console.log(`📁 Directory: ${process.cwd()}`);
console.log(`📦 Node Version: ${process.version}`);
console.log('');

try {
    global.bot = new SafeWhatsAppBot();
    console.log('✅ Bot instance created successfully!');
} catch (error) {
    console.error('❌ Error creating bot:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
}

module.exports = SafeWhatsAppBot;
