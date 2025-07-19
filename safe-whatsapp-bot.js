const { Client, LocalAuth, RemoteAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
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
            
            // For Heroku, always use LocalAuth to avoid MongoDB complexity
            console.log('📂 Using LocalAuth for Heroku deployment');
            authStrategy = new LocalAuth({ 
                clientId: 'safe-bot-heroku',
                dataPath: './.wwebjs_auth/'
            });
            
            this.client = new Client({
                authStrategy: authStrategy,
                puppeteer: { 
                    headless: true,
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
                        '--disable-renderer-backgrounding',
                        '--disable-default-apps',
                        '--disable-extensions',
                        '--disable-translate',
                        '--disable-plugins',
                        '--disable-sync',
                        '--disable-dev-shm-usage',
                        '--no-default-browser-check',
                        '--disable-background-networking',
                        '--disable-client-side-phishing-detection',
                        '--disable-component-extensions-with-background-pages',
                        '--disable-ipc-flooding-protection',
                        '--ignore-certificate-errors',
                        '--ignore-ssl-errors',
                        '--ignore-certificate-errors-spki-list',
                        '--memory-pressure-off',
                        '--max_old_space_size=512'
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
            
            // Safe info access
            const pushname = info?.pushname || 'Unknown';
            const userId = info?.wid?.user || 'Unknown';
            console.log(`[INFO] Connected as: ${pushname} (${userId})`);
            
            this.broadcastToClients('ready', { 
                status: 'ready', 
                message: 'Successfully connected to WhatsApp',
                info: {
                    name: pushname,
                    number: userId,
                    platform: info?.platform || 'Unknown'
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
            
            // Clear any existing reconnect timeout
            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
            }
            
            // Attempt to reconnect after a delay
            this.reconnectTimeout = setTimeout(() => {
                if (!this.isConnected) {
                    console.log('[STATUS] Attempting to reconnect...');
                    this.initializeWhatsApp().catch(error => {
                        console.error('❌ Reconnection failed:', error);
                    });
                }
            }, 10000); // Wait 10 seconds before reconnecting
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

        // Multer configuration for file uploads
        const upload = multer({
            dest: 'uploads/',
            limits: {
                fileSize: 16 * 1024 * 1024 // 16MB limit
            },
            fileFilter: (req, file, cb) => {
                // Allow images, videos, documents, audio
                const allowedTypes = [
                    'image/', 'video/', 'audio/', 'application/pdf', 
                    'application/msword', 'application/vnd.openxmlformats-officedocument',
                    'application/zip', 'application/x-rar-compressed', 'text/'
                ];
                
                const isAllowed = allowedTypes.some(type => file.mimetype.startsWith(type));
                if (!isAllowed) {
                    return cb(new Error('File type not supported'));
                }
                cb(null, true);
            }
        });

        // Store upload middleware for use in endpoints
        this.upload = upload;

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

        // Media message endpoint
        this.app.post('/api/send-media', upload.single('media'), async (req, res) => {
            try {
                console.log(`📮 [API] send-media request received:`, {
                    body: req.body,
                    file: req.file ? { 
                        originalname: req.file.originalname, 
                        mimetype: req.file.mimetype, 
                        size: req.file.size 
                    } : null,
                    timestamp: new Date().toISOString()
                });
                
                const { number, message, priority } = req.body;
                
                if (!number || !req.file) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Number and media file are required' 
                    });
                }

                try {
                    // Create MessageMedia from uploaded file with proper MIME type
                    const media = MessageMedia.fromFilePath(req.file.path);
                    media.filename = req.file.originalname;
                    media.mimetype = req.file.mimetype; // Explicitly set the MIME type
                    
                    // For images, ensure they display inline
                    if (req.file.mimetype.startsWith('image/')) {
                        console.log(`📷 [MEDIA] Processing image: ${req.file.originalname} (${req.file.mimetype})`);
                    } else if (req.file.mimetype.startsWith('video/')) {
                        console.log(`🎥 [MEDIA] Processing video: ${req.file.originalname} (${req.file.mimetype})`);
                    } else {
                        console.log(`📎 [MEDIA] Processing document: ${req.file.originalname} (${req.file.mimetype})`);
                    }
                    
                    const result = await this.queueMediaMessage(number, media, message, priority);
                    
                    // Clean up uploaded file
                    fs.unlinkSync(req.file.path);
                    
                    res.json(result);
                } catch (mediaError) {
                    console.error(`❌ [API] Media processing error:`, mediaError.message);
                    // Clean up file on error
                    if (req.file && fs.existsSync(req.file.path)) {
                        fs.unlinkSync(req.file.path);
                    }
                    throw mediaError;
                }
            } catch (error) {
                console.error(`❌ [API] send-media error:`, error.message);
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

        // Enhanced QR Code endpoint for manual requests
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

        // Add restart endpoint for troubleshooting
        this.app.post('/api/restart-whatsapp', async (req, res) => {
            try {
                console.log('🔄 [API] WhatsApp restart requested');
                
                // Stop current processing
                this.isProcessing = false;
                this.isConnected = false;
                
                // Destroy existing client
                if (this.client) {
                    try {
                        await this.client.destroy();
                        console.log('✅ [API] Existing client destroyed');
                    } catch (error) {
                        console.log('⚠️ [API] Error destroying client:', error.message);
                    }
                }
                
                // Clear reconnect timeout
                if (this.reconnectTimeout) {
                    clearTimeout(this.reconnectTimeout);
                }
                
                // Restart WhatsApp
                setTimeout(() => {
                    console.log('🚀 [API] Restarting WhatsApp client...');
                    this.initializeWhatsApp().catch(error => {
                        console.error('❌ [API] Failed to restart WhatsApp:', error);
                    });
                }, 2000);
                
                res.json({
                    success: true,
                    message: 'WhatsApp restart initiated. Please wait for reconnection.'
                });
            } catch (error) {
                console.error('❌ [API] Restart error:', error);
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

        // CSV Contact loading endpoints
        this.app.get('/api/load-contacts', async (req, res) => {
            try {
                const csvPath = path.join(__dirname, 'contacts.csv');
                
                if (!fs.existsSync(csvPath)) {
                    return res.status(404).json({
                        success: false,
                        error: 'contacts.csv file not found. Please upload a CSV file with Name and PhoneNumber columns.'
                    });
                }

                const contacts = await this.loadContactsFromCSV(csvPath);
                const phoneNumbers = contacts.map(contact => contact.PhoneNumber).join(', ');
                
                res.json({
                    success: true,
                    contacts: contacts,
                    phoneNumbers: phoneNumbers,
                    count: contacts.length,
                    message: `Loaded ${contacts.length} contacts from CSV`
                });
            } catch (error) {
                console.error('❌ Error loading contacts:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        this.app.post('/api/send-bulk-messages', async (req, res) => {
            try {
                const { messageTemplate, priority = 'normal' } = req.body;
                
                if (!messageTemplate) {
                    return res.status(400).json({
                        success: false,
                        error: 'Message template is required'
                    });
                }

                const csvPath = path.join(__dirname, 'contacts.csv');
                if (!fs.existsSync(csvPath)) {
                    return res.status(404).json({
                        success: false,
                        error: 'contacts.csv file not found'
                    });
                }

                const contacts = await this.loadContactsFromCSV(csvPath);
                const results = [];

                for (const contact of contacts) {
                    try {
                        // Replace {name} placeholder with actual name
                        const personalizedMessage = messageTemplate.replace(/{name}/g, contact.Name);
                        
                        const result = await this.queueMessage(contact.PhoneNumber, personalizedMessage, priority);
                        results.push({
                            name: contact.Name,
                            number: contact.PhoneNumber,
                            success: true,
                            messageId: result.messageId
                        });
                    } catch (error) {
                        console.error(`❌ Error queuing message for ${contact.Name}:`, error);
                        results.push({
                            name: contact.Name,
                            number: contact.PhoneNumber,
                            success: false,
                            error: error.message
                        });
                    }
                }

                const successCount = results.filter(r => r.success).length;
                const failureCount = results.length - successCount;

                res.json({
                    success: true,
                    message: `Queued ${successCount} messages successfully, ${failureCount} failed`,
                    results: results,
                    summary: {
                        total: results.length,
                        success: successCount,
                        failed: failureCount
                    }
                });
            } catch (error) {
                console.error('❌ Error sending bulk messages:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Bulk media messaging endpoint
        this.app.post('/api/send-bulk-media', this.upload.single('media'), async (req, res) => {
            try {
                const { messageTemplate, priority = 'normal' } = req.body;
                const mediaFile = req.file;
                
                if (!mediaFile) {
                    return res.status(400).json({
                        success: false,
                        error: 'Media file is required'
                    });
                }

                const csvPath = path.join(__dirname, 'contacts.csv');
                if (!fs.existsSync(csvPath)) {
                    return res.status(404).json({
                        success: false,
                        error: 'contacts.csv file not found'
                    });
                }

                console.log(`📎 Starting bulk media send with file: ${mediaFile.originalname}`);

                const contacts = await this.loadContactsFromCSV(csvPath);
                const results = [];

                // Create MessageMedia object with proper MIME type handling
                const media = MessageMedia.fromFilePath(mediaFile.path);
                media.filename = mediaFile.originalname;
                media.mimetype = mediaFile.mimetype; // Explicitly set the MIME type
                
                // Log media type for debugging
                if (mediaFile.mimetype.startsWith('image/')) {
                    console.log(`📷 [BULK] Processing bulk image: ${mediaFile.originalname} (${mediaFile.mimetype})`);
                } else if (mediaFile.mimetype.startsWith('video/')) {
                    console.log(`🎥 [BULK] Processing bulk video: ${mediaFile.originalname} (${mediaFile.mimetype})`);
                } else {
                    console.log(`📎 [BULK] Processing bulk document: ${mediaFile.originalname} (${mediaFile.mimetype})`);
                }
                
                for (const contact of contacts) {
                    try {
                        // Replace {name} placeholder with actual name in caption
                        const personalizedCaption = messageTemplate ? messageTemplate.replace(/{name}/g, contact.Name) : '';
                        
                        const result = await this.queueMediaMessage(contact.PhoneNumber, media, personalizedCaption, priority);
                        results.push({
                            name: contact.Name,
                            number: contact.PhoneNumber,
                            success: true,
                            messageId: result.messageId
                        });
                        
                        console.log(`✅ Media message queued for ${contact.Name} (${contact.PhoneNumber})`);
                    } catch (error) {
                        console.error(`❌ Error queuing media message for ${contact.Name}:`, error);
                        results.push({
                            name: contact.Name,
                            number: contact.PhoneNumber,
                            success: false,
                            error: error.message
                        });
                    }
                }

                // Clean up uploaded file
                try {
                    fs.unlinkSync(mediaFile.path);
                } catch (error) {
                    console.warn('⚠️ Failed to delete uploaded file:', error.message);
                }

                const successCount = results.filter(r => r.success).length;
                const failureCount = results.length - successCount;

                res.json({
                    success: true,
                    message: `Queued ${successCount} media messages successfully, ${failureCount} failed`,
                    results: results,
                    summary: {
                        total: results.length,
                        success: successCount,
                        failed: failureCount
                    }
                });
            } catch (error) {
                console.error('❌ Error sending bulk media messages:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
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

    async queueMediaMessage(number, media, caption = '', priority = 'normal') {
        const queueTime = new Date().toLocaleTimeString();
        console.log(`📥 [QUEUE] queueMediaMessage called at ${queueTime} for ${number}, priority: ${priority}`);
        
        // Validate inputs
        if (!number || number === 'undefined' || typeof number !== 'string') {
            console.error(`❌ [QUEUE] Invalid number input: ${number} (type: ${typeof number})`);
            throw new Error('Invalid phone number: number is required and must be a string');
        }
        
        if (!media) {
            console.error(`❌ [QUEUE] Invalid media input: ${media}`);
            throw new Error('Invalid media: media object is required');
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
            console.log(`❌ [QUEUE] Number is not a valid WhatsApp user at ${new Date().toLocaleTimeString()}`);
            throw new Error('Number is not a valid WhatsApp user. Please check the number and try again.');
        } else if (!isValid && !this.isConnected) {
            console.log(`⚠️ [QUEUE] Cannot verify WhatsApp user (not connected), allowing number at ${new Date().toLocaleTimeString()}`);
        }

        const messageObj = {
            id: Date.now() + Math.random(),
            number: formattedNumber,
            media,
            caption,
            priority,
            timestamp: Date.now(),
            queuedAt: new Date().toLocaleTimeString(),
            status: 'queued',
            retries: 0,
            type: 'media'
        };

        console.log(`📝 [QUEUE] Created media message object at ${new Date().toLocaleTimeString()}:`, {
            id: messageObj.id,
            number: messageObj.number,
            caption: messageObj.caption ? messageObj.caption.substring(0, 50) + '...' : 'No caption',
            priority: messageObj.priority,
            queuedAt: messageObj.queuedAt,
            type: messageObj.type,
            mediaType: media.mimetype || 'unknown'
        });

        // Add to queue based on priority
        if (priority === 'high') {
            this.messageQueue.unshift(messageObj);
            console.log(`⚡ [QUEUE] Added HIGH PRIORITY media message to front of queue at ${new Date().toLocaleTimeString()}`);
        } else {
            this.messageQueue.push(messageObj);
            console.log(`📬 [QUEUE] Added NORMAL priority media message to end of queue at ${new Date().toLocaleTimeString()}`);
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
                console.log(`🔌 [QUEUE] WhatsApp not connected - media message will wait in queue`);
            }
            if (this.isProcessing) {
                console.log(`⚙️ [QUEUE] Processor already running - media message added to queue`);
            }
        }
        
        const result = {
            success: true,
            messageId: messageObj.id,
            queuePosition: this.messageQueue.length,
            queuedAt: messageObj.queuedAt,
            type: 'media'
        };
        
        console.log(`✅ [QUEUE] Media message queued successfully at ${new Date().toLocaleTimeString()}: Position ${result.queuePosition} in queue`);
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
            const messageContent = message.type === 'media' 
                ? (message.caption || 'Media message') 
                : (message.message || 'No content');
            
            console.log(`📤 [PROCESSOR] Processing message at ${processingTime}:`, {
                number: message.number,
                message: messageContent.substring(0, 50) + '...',
                type: message.type || 'text',
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

            // Enhanced client connection check
            console.log(`🔗 [SEND] Checking client connection state at ${new Date().toLocaleTimeString()}...`);
            
            if (!this.client) {
                throw new Error('WhatsApp client not initialized');
            }
            
            // Check if client is ready using multiple methods
            let clientState;
            let isReady = false;
            
            try {
                // Try to get state with timeout
                clientState = await Promise.race([
                    this.client.getState(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('State check timeout')), 3000))
                ]);
                console.log(`📱 [SEND] Client state at ${new Date().toLocaleTimeString()}:`, clientState);
                
                // Check if state indicates readiness
                isReady = clientState === 'CONNECTED';
            } catch (stateError) {
                console.log(`⚠️ [SEND] State check failed, trying alternative method:`, stateError.message);
                clientState = null;
            }
            
            // If state check failed or returned null, try alternative validation
            if (!isReady) {
                try {
                    // Try to check if we can access WhatsApp info (indicates connection)
                    const info = await Promise.race([
                        this.client.info,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Info check timeout')), 2000))
                    ]);
                    
                    if (info && info.wid) {
                        console.log(`✅ [SEND] Client info available, treating as connected`);
                        isReady = true;
                    }
                } catch (infoError) {
                    console.log(`⚠️ [SEND] Info check also failed:`, infoError.message);
                }
            }
            
            if (!isReady) {
                throw new Error(`Client not ready. State: ${clientState || 'unknown'}, Info check failed`);
            }
            
            console.log(`✅ [SEND] Client validated as ready at ${new Date().toLocaleTimeString()}`);

            console.log(`📞 [SEND] Sending message to WhatsApp API at ${new Date().toLocaleTimeString()}...`);
            console.log(`📧 [SEND] Target: ${messageObj.number}`);
            
            let result;
            const apiStartTime = Date.now();
            
            if (messageObj.type === 'media') {
                console.log(`� [SEND] Media Type: ${messageObj.media.mimetype || 'unknown'}`);
                console.log(`📝 [SEND] Caption: ${messageObj.caption || 'No caption'}`);
                
                result = await this.client.sendMessage(messageObj.number, messageObj.media, { 
                    caption: messageObj.caption || '' 
                });
            } else {
                console.log(`💬 [SEND] Content: ${messageObj.message}`);
                result = await this.client.sendMessage(messageObj.number, messageObj.message);
            }
            
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

    async loadContactsFromCSV(csvPath) {
        return new Promise((resolve, reject) => {
            const contacts = [];
            
            fs.createReadStream(csvPath)
                .pipe(csv())
                .on('data', (row) => {
                    // Handle different possible column names
                    const name = row['Name'] || row['name'] || row['NAME'] || 'Unknown';
                    let phoneNumber = row['PhoneNumber'] || row['phonenumber'] || row['PHONENUMBER'] || 
                                    row['Phone'] || row['phone'] || row['PHONE'] || '';
                    
                    // Handle Excel scientific notation (e.g., 9.17208E+11)
                    if (phoneNumber && typeof phoneNumber === 'string') {
                        // Convert scientific notation to regular number
                        if (phoneNumber.includes('E+') || phoneNumber.includes('e+')) {
                            phoneNumber = parseFloat(phoneNumber).toString();
                        }
                        
                        // Remove any decimal points that might be left
                        phoneNumber = phoneNumber.replace(/\./g, '');
                        
                        // Clean and format the number
                        phoneNumber = phoneNumber.replace(/\D/g, ''); // Remove non-digits
                        
                        // Add country code if missing (assuming India +91)
                        if (phoneNumber.length === 10) {
                            phoneNumber = '91' + phoneNumber;
                        }
                    }
                    
                    if (name && phoneNumber) {
                        contacts.push({
                            Name: name,
                            PhoneNumber: phoneNumber
                        });
                    }
                })
                .on('end', () => {
                    console.log(`📋 [CSV] Loaded ${contacts.length} contacts from CSV`);
                    resolve(contacts);
                })
                .on('error', (error) => {
                    console.error('❌ [CSV] Error reading CSV file:', error);
                    reject(error);
                });
        });
    }

    async isValidWhatsAppUser(number) {
        try {
            // If not connected, skip WhatsApp validation and just validate format
            if (!this.isConnected || !this.client) {
                console.log(`⚠️ [VALIDATION] WhatsApp not connected, allowing number: ${number}`);
                return true; // Allow format-valid numbers when not connected
            }
            
            // Check client state before attempting validation
            try {
                const clientState = await this.client.getState();
                if (clientState !== 'CONNECTED') {
                    console.log(`⚠️ [VALIDATION] Client not in CONNECTED state (${clientState}), skipping validation for: ${number}`);
                    return true;
                }
            } catch (stateError) {
                console.log(`⚠️ [VALIDATION] Cannot check client state, skipping validation for: ${number}`);
                return true;
            }
            
            console.log(`🔍 [VALIDATION] Checking WhatsApp registration for: ${number}`);
            
            // Add timeout to prevent hanging
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Validation timeout')), 5000);
            });
            
            const validationPromise = this.client.getNumberId(number);
            const numberId = await Promise.race([validationPromise, timeoutPromise]);
            
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
