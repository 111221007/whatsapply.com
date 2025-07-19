const { Client, LocalAuth, RemoteAuth } = require('./index');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { MongoStore } = require('wwebjs-mongo');

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
            
            // Check for existing session
            const sessionPath = './.wwebjs_auth/session-safe-bot';
            const fs = require('fs');
            const sessionExists = fs.existsSync(sessionPath);
            
            if (sessionExists) {
                console.log('🔑 Found existing bot session - attempting to restore...');
                this.broadcastToClients('session_restore', { 
                    message: 'Found existing bot session, attempting to restore connection...',
                    status: 'restoring'
                });
            } else {
                console.log('🆕 No bot session found - bot will need authentication');
                this.broadcastToClients('session_required', { 
                    message: 'Bot needs authentication. The bot will open its own WhatsApp Web instance.',
                    status: 'session_required'
                });
            }
            
            // Special Heroku configuration
            const isProduction = process.env.NODE_ENV === 'production' || process.env.HEROKU;
            console.log(`🌍 Environment: ${isProduction ? 'Production' : 'Development'}`);
            
            // Use different auth strategy based on environment
            let authStrategy;
            
            // Check if we're running on Heroku and have a MongoDB URL
            if (process.env.MONGODB_URI && (isProduction || process.env.HEROKU)) {
                console.log('🗄️ Using RemoteAuth with MongoDB for persistent sessions');
                try {
                    const mongoose = require('mongoose');
                    mongoose.connect(process.env.MONGODB_URI).then(() => {
                        console.log('📦 MongoDB connected successfully');
                    });
                    const store = new MongoStore({ mongoose: mongoose });
                    authStrategy = new RemoteAuth({
                        clientId: 'safe-bot-heroku',
                        store: store,
                        backupSyncIntervalMs: 300000
                    });
                } catch (error) {
                    console.error('❌ Failed to setup RemoteAuth:', error);
                    console.log('⚠️ Falling back to LocalAuth');
                    authStrategy = new LocalAuth({ 
                        clientId: 'safe-bot',
                        dataPath: './.wwebjs_auth/'
                    });
                }
            } else {
                console.log('📂 Using LocalAuth for local development');
                authStrategy = new LocalAuth({ 
                    clientId: 'safe-bot',
                    dataPath: './.wwebjs_auth/'
                });
            }
            
            this.client = new Client({
                authStrategy: authStrategy,
                puppeteer: { 
                    headless: isProduction ? true : false,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu',
                        '--disable-web-security',
                        '--disable-features=VizDisplayCompositor',
                        '--disable-background-timer-throttling',
                        '--disable-backgrounding-occluded-windows',
                        '--disable-renderer-backgrounding'
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
            console.log('[STATUS] QR code received. Bot needs authentication.');
            this.broadcastToClients('qr', { qr });
        });
        
        this.client.on('loading_screen', (percent, message) => {
            console.log(`[STATUS] Loading screen: ${percent}% - ${message}`);
            this.broadcastToClients('loading', { percent, message });
        });
        
        this.client.on('authenticated', () => {
            console.log('[STATUS] WhatsApp authenticated successfully.');
            this.broadcastToClients('authenticated', { 
                status: 'authenticated',
                message: 'Session authenticated - connecting to WhatsApp...'
            });
        });
        
        this.client.on('auth_failure', (msg) => {
            console.log('[STATUS] Authentication failed:', msg);
            this.broadcastToClients('auth_failure', { 
                message: 'Authentication failed - will need to scan QR code again',
                error: msg,
                timestamp: new Date().toISOString()
            });
        });
        
        this.client.on('ready', async () => {
            this.isConnected = true;
            const info = this.client.info;
            console.log('[STATUS] WhatsApp connected and ready.');
            console.log(`[INFO] Connected as: ${info.pushname} (${info.wid.user})`);
            this.broadcastToClients('ready', { 
                status: 'ready', 
                message: 'Successfully connected to WhatsApp',
                info: {
                    name: info.pushname,
                    number: info.wid.user,
                    platform: info.platform
                }
            });
            this.startMessageProcessor();
        });
        
        this.client.on('disconnected', (reason) => {
            this.isConnected = false;
            console.log('[STATUS] WhatsApp disconnected. Reason:', reason);
            this.broadcastToClients('disconnected', { 
                reason,
                message: 'WhatsApp disconnected - attempting to reconnect...',
                timestamp: new Date().toISOString()
            });
            
            // Attempt to reconnect after a short delay
            setTimeout(() => {
                if (!this.isConnected) {
                    console.log('[STATUS] Attempting to reconnect...');
                    this.initializeWhatsApp().catch(error => {
                        console.error('❌ Reconnection failed:', error);
                    });
                }
            }, 5000);
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

        // API endpoints
        this.app.post('/api/send-message', async (req, res) => {
            try {
                console.log(`📮 [API] send-message request received:`, {
                    body: req.body,
                    numberType: typeof req.body?.number,
                    messageType: typeof req.body?.message,
                    timestamp: new Date().toISOString()
                });
                
                const { number, message, priority } = req.body;
                
                if (!number || !message || number === 'undefined' || message === 'undefined') {
                    console.error(`❌ [API] Invalid request data:`, { number, message, priority });
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Number and message are required and cannot be undefined' 
                    });
                }

                const result = await this.queueMessage(number, message, priority);
                res.json(result);
            } catch (error) {
                console.error(`❌ [API] send-message error:`, error.message);
                res.status(500).json({ 
                    success: false, 
                    error: error.message 
                });
            }
        });

        this.app.post('/api/validate-number', async (req, res) => {
            try {
                const { number } = req.body;
                
                if (!number) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Number is required' 
                    });
                }

                const formattedNumber = this.formatPhoneNumber(number);
                if (!formattedNumber) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Invalid phone number format' 
                    });
                }

                const isValid = await this.isValidWhatsAppUser(formattedNumber);
                res.json({ 
                    success: true, 
                    valid: isValid,
                    number: formattedNumber,
                    formattedNumber: formattedNumber,
                    isWhatsAppNumber: isValid
                });
            } catch (error) {
                res.status(500).json({ 
                    success: false, 
                    error: error.message 
                });
            }
        });

        // QR Code endpoint for manual requests
        this.app.get('/api/qr', async (req, res) => {
            try {
                if (!this.client) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'WhatsApp client not initialized' 
                    });
                }

                // Force client initialization if not started
                if (!this.isConnected) {
                    console.log('🔄 Client not connected, attempting to initialize...');
                    // Don't await this, just trigger it
                    this.initializeWhatsApp().catch(error => {
                        console.error('❌ Failed to reinitialize:', error);
                    });
                }

                res.json({ 
                    success: true, 
                    message: 'QR code generation initiated. Check real-time events for QR code.',
                    status: this.isConnected ? 'connected' : 'initializing'
                });
            } catch (error) {
                console.error('QR API error:', error);
                res.status(500).json({ 
                    success: false, 
                    error: error.message 
                });
            }
        });

        this.app.post('/api/process-queue', (req, res) => {
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
                            id: m.id,
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

        // Socket.IO connection handling
        this.io.on('connection', (socket) => {
            console.log('🔌 Client connected to web interface');
            
            // Send current status to new clients
            socket.emit('status_update', {
                isConnected: this.isConnected,
                queueLength: this.messageQueue.length,
                isProcessing: this.isProcessing,
                stats: this.stats
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
        
        // Validate inputs
        if (!number || number === 'undefined' || typeof number !== 'string') {
            console.error(`❌ [QUEUE] Invalid number input: ${number} (type: ${typeof number})`);
            throw new Error('Invalid phone number: number is required and must be a string');
        }
        
        if (!message || message === 'undefined' || typeof message !== 'string') {
            console.error(`❌ [QUEUE] Invalid message input: ${message} (type: ${typeof message})`);
            throw new Error('Invalid message: message is required and must be a string');
        }
        
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

        console.log(`📊 [QUEUE] Queue status at ${new Date().toLocaleTimeString()}: Length=${this.messageQueue.length}, Processing=${this.isProcessing}, Connected=${this.isConnected}`);

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
            if (!this.isConnected || !this.client) {
                console.log(`⚠️ [VALIDATION] WhatsApp not connected, allowing number: ${number}`);
                return true; // Allow format-valid numbers when not connected
            }
            
            console.log(`🔍 [VALIDATION] Checking WhatsApp registration for: ${number}`);
            const numberId = await this.client.getNumberId(number);
            const isValid = numberId !== null && numberId !== undefined;
            console.log(`✅ [VALIDATION] Result for ${number}: ${isValid ? 'VALID' : 'INVALID'}`);
            return isValid;
        } catch (error) {
            console.error(`❌ [VALIDATION] Error checking WhatsApp user ${number}:`, error.message);
            // If there's an error checking, allow the number (fail-safe approach)
            return true;
        }
    }

    formatPhoneNumber(number) {
        // Handle undefined, null, or non-string inputs
        if (!number || typeof number !== 'string') {
            console.error(`❌ [FORMAT] Invalid input for phone number: ${number} (type: ${typeof number})`);
            return null;
        }
        
        // Remove all non-numeric characters
        const cleaned = number.replace(/\D/g, '');
        
        // Basic validation
        if (cleaned.length < 10 || cleaned.length > 15) {
            console.error(`❌ [FORMAT] Invalid phone number length: ${cleaned.length} digits for number: ${cleaned}`);
            return null;
        }
        
        const formatted = cleaned + '@c.us';
        console.log(`✅ [FORMAT] Successfully formatted: ${number} -> ${formatted}`);
        return formatted;
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

// If this file is run directly (not imported)
if (require.main === module) {
    console.log('🚀 Starting Safe WhatsApp Bot...');
    console.log(`📅 Time: ${new Date().toLocaleString()}`);
    console.log(`📁 Directory: ${process.cwd()}`);
    console.log(`📦 Node Version: ${process.version}`);
    console.log(`🖥️ Platform: ${process.platform}, Architecture: ${process.arch}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Heroku: ${process.env.HEROKU ? 'Yes' : 'No'}`);
    console.log('');
    
    try {
        global.bot = new SafeWhatsAppBot();
        console.log('✅ Bot instance created successfully!');
    } catch (error) {
        console.error('❌ Error creating bot:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Export the class for use in other files
module.exports = { SafeWhatsAppBot };
