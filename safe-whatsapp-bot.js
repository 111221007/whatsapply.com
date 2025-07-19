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
            messagesPerHour: 0,
            dailyCount: 0,
            lastReset: new Date().toDateString(),
            lastHourReset: new Date().getHours(),
            consecutiveMessages: 0,
            lastMessageTime: 0,
            violations: 0,
            warningLevel: 'green', // green, yellow, red
            numberMessageCounts: new Map(), // Track messages per number
            dailyUniqueNumbers: new Set() // Track unique numbers contacted today
        };
        this.rateLimiter = {
            maxPerMinute: 15, // High throughput: 15 messages per minute
            maxPerHour: 900, // 15*60 = 900 messages per hour
            maxPerDay: Infinity, // UNLIMITED: No daily limit on total messages
            maxPerNumber: 5, // INCREASED: Max 5 messages per unique number per day (up from 3)
            maxUniqueNumbersPerDay: Infinity, // UNLIMITED: No limit on unique numbers
            minDelay: 4000, // Aggressive: Minimum 4 seconds between messages (15/min = 4s)
            maxDelay: 8000, // Aggressive: Maximum 8 seconds between messages
            breakAfter: 15, // Take break after every 15 messages (1 minute worth)
            breakDuration: 300000, // 5 minute break (reduced for high throughput)
            longBreakAfter: 100, // Long break after 100 messages
            longBreakDuration: 1800000, // 30 minute long break (reduced)
            dailyBreakStart: 23, // Start daily break at 11 PM (later for more working hours)
            dailyBreakEnd: 7, // End daily break at 7 AM (earlier start)
            weekendSlowdown: false, // NO weekend slowdown for maximum throughput
            numberCooldown: 43200000, // 12 hours cooldown (reduced from 24h for faster re-messaging)
            suspiciousPatternThreshold: 10 // Higher threshold for aggressive sending
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
                // Allow images, videos, documents, audio, and CSV files
                const allowedTypes = [
                    'image/', 'video/', 'audio/', 'application/pdf', 
                    'application/msword', 'application/vnd.openxmlformats-officedocument',
                    'application/zip', 'application/x-rar-compressed', 'text/',
                    'text/csv', 'application/csv'
                ];
                
                // Special handling for CSV files (check extension as some systems don't set correct MIME type)
                const isCSV = file.originalname.toLowerCase().endsWith('.csv') || 
                             file.mimetype === 'text/csv' || 
                             file.mimetype === 'application/csv';
                
                const isAllowed = allowedTypes.some(type => file.mimetype.startsWith(type)) || isCSV;
                
                if (!isAllowed) {
                    return cb(new Error('File type not supported. Allowed: images, videos, documents, audio, CSV files'));
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

        // CSV Upload endpoint - allows users to upload CSV files from their system
        this.app.post('/api/upload-csv', upload.single('csvFile'), async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({
                        success: false,
                        error: 'No CSV file uploaded. Please select a CSV file.'
                    });
                }

                // Validate file type
                if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
                    // Clean up uploaded file
                    fs.unlinkSync(req.file.path);
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid file type. Please upload a CSV file.'
                    });
                }

                console.log(`📁 [UPLOAD] CSV file uploaded: ${req.file.originalname}`);

                // Load and validate CSV content
                const contacts = await this.loadContactsFromCSV(req.file.path);
                
                if (contacts.length === 0) {
                    // Clean up uploaded file
                    fs.unlinkSync(req.file.path);
                    return res.status(400).json({
                        success: false,
                        error: 'No valid contacts found in CSV. Please ensure your CSV has "Name" and "PhoneNumber" columns.'
                    });
                }

                // Move uploaded file to replace the default contacts.csv
                const targetPath = path.join(__dirname, 'contacts.csv');
                fs.renameSync(req.file.path, targetPath);

                console.log(`✅ [UPLOAD] Successfully uploaded and processed ${contacts.length} contacts`);

                res.json({
                    success: true,
                    message: `Successfully uploaded and processed ${contacts.length} contacts from ${req.file.originalname}`,
                    contacts: contacts.slice(0, 10), // Show first 10 contacts as preview
                    totalCount: contacts.length,
                    fileName: req.file.originalname,
                    preview: contacts.length > 10 ? `Showing first 10 of ${contacts.length} contacts` : 'All contacts displayed',
                    columnsDetected: {
                        nameColumn: 'Name (auto-detected)',
                        phoneColumn: 'PhoneNumber (auto-detected)',
                        supportedFormats: ['Name/name/NAME', 'PhoneNumber/Phone/phone/PHONE']
                    }
                });

            } catch (error) {
                // Clean up uploaded file if there was an error
                if (req.file && fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
                
                console.error('❌ Error uploading CSV:', error);
                res.status(500).json({
                    success: false,
                    error: `Failed to process CSV file: ${error.message}`
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
                
                const violationCheck = await this.checkForViolations();
                const currentHour = new Date().getHours();
                const isQuietTime = currentHour >= this.rateLimiter.dailyBreakStart || currentHour < this.rateLimiter.dailyBreakEnd;
                
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
                    stats: {
                        ...this.stats,
                        // Convert Map and Set to objects/arrays for JSON
                        numberMessageCounts: Object.fromEntries(this.stats.numberMessageCounts),
                        dailyUniqueNumbers: Array.from(this.stats.dailyUniqueNumbers)
                    },
                    rateLimiter: this.rateLimiter,
                    antiViolation: {
                        canSend: violationCheck.canSend,
                        reason: violationCheck.reason,
                        warningLevel: this.stats.warningLevel,
                        isQuietTime: isQuietTime,
                        dailyProgress: `${this.stats.dailyCount}/∞ (unlimited)`,
                        hourlyProgress: `${this.stats.messagesPerHour}/${this.rateLimiter.maxPerHour}`,
                        uniqueNumbersProgress: `${this.stats.dailyUniqueNumbers.size}/∞ (unlimited)`,
                        consecutiveMessages: this.stats.consecutiveMessages,
                        violations: this.stats.violations,
                        perNumberLimits: {
                            maxPerNumber: this.rateLimiter.maxPerNumber,
                            numbersAtLimit: Array.from(this.stats.numberMessageCounts.entries())
                                .filter(([num, count]) => count >= this.rateLimiter.maxPerNumber)
                                .map(([num, count]) => ({ number: num, count }))
                        }
                    }
                };
                res.json(response);
            } catch (error) {
                console.error('Debug status error:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Safety check endpoint for content analysis
        this.app.post('/api/check-message-safety', async (req, res) => {
            try {
                const { message } = req.body;
                
                if (!message) {
                    return res.status(400).json({
                        success: false,
                        error: 'Message content is required'
                    });
                }
                
                const contentCheck = this.analyzeMessageContent(message);
                const violationCheck = await this.checkForViolations();
                
                res.json({
                    success: true,
                    contentAnalysis: contentCheck,
                    violationCheck: violationCheck,
                    recommendation: contentCheck.safe && violationCheck.canSend 
                        ? 'Safe to send' 
                        : 'Not recommended to send',
                    reasons: [
                        ...(contentCheck.safe ? [] : [contentCheck.reason]),
                        ...(violationCheck.canSend ? [] : [violationCheck.reason])
                    ]
                });
            } catch (error) {
                console.error('❌ Safety check error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Emergency stop endpoint
        this.app.post('/api/emergency-stop', async (req, res) => {
            try {
                console.log('🚨 [EMERGENCY] Emergency stop requested');
                
                // Clear queue
                this.messageQueue = [];
                this.isProcessing = false;
                
                // Set violation warning to maximum
                this.stats.warningLevel = 'red';
                this.stats.violations += 10;
                
                console.log('🛑 [EMERGENCY] All messaging stopped, queue cleared');
                
                res.json({
                    success: true,
                    message: 'Emergency stop activated. All messaging has been halted.',
                    queueCleared: true,
                    processingStop: true
                });
            } catch (error) {
                console.error('❌ Emergency stop error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Per-number limit check endpoint
        this.app.get('/api/check-number-limit/:number', async (req, res) => {
            try {
                const { number } = req.params;
                
                if (!number) {
                    return res.status(400).json({
                        success: false,
                        error: 'Number parameter is required'
                    });
                }

                const formattedNumber = this.formatPhoneNumber(number);
                if (!formattedNumber) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid phone number format'
                    });
                }

                const currentCount = this.stats.numberMessageCounts.get(formattedNumber) || 0;
                const limit = this.rateLimiter.maxPerNumber;
                const remaining = Math.max(0, limit - currentCount);
                const canSend = currentCount < limit;

                res.json({
                    success: true,
                    number: formattedNumber,
                    currentCount: currentCount,
                    limit: limit,
                    remaining: remaining,
                    canSend: canSend,
                    status: canSend ? 'available' : 'limit_reached',
                    message: canSend 
                        ? `${remaining} messages remaining for this number today`
                        : `Daily limit of ${limit} messages reached for this number`
                });
            } catch (error) {
                console.error('❌ Number limit check error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // High-throughput configuration endpoint
        this.app.get('/api/throughput-config', (req, res) => {
            try {
                const config = {
                    messagesPerMinute: this.rateLimiter.maxPerMinute,
                    messagesPerHour: this.rateLimiter.maxPerHour,
                    messagesPerDay: 'Unlimited',
                    perNumberLimit: this.rateLimiter.maxPerNumber,
                    delayRange: `${this.rateLimiter.minDelay/1000}s - ${this.rateLimiter.maxDelay/1000}s`,
                    breakSchedule: {
                        regularBreak: `Every ${this.rateLimiter.breakAfter} messages`,
                        regularBreakDuration: `${this.rateLimiter.breakDuration/1000/60} minutes`,
                        longBreak: `Every ${this.rateLimiter.longBreakAfter} messages`,
                        longBreakDuration: `${this.rateLimiter.longBreakDuration/1000/60} minutes`
                    },
                    theoreticalMax: {
                        perHour: `${this.rateLimiter.maxPerMinute * 60} messages/hour`,
                        perDay: `${this.rateLimiter.maxPerMinute * 60 * 24} messages/day (if running 24/7)`,
                        uniqueNumbers: `${Math.floor((this.rateLimiter.maxPerMinute * 60 * 24) / this.rateLimiter.maxPerNumber)} unique numbers/day`
                    },
                    optimizations: {
                        weekendSlowdown: this.rateLimiter.weekendSlowdown,
                        numberCooldown: `${this.rateLimiter.numberCooldown/1000/60/60} hours`,
                        aggressiveMode: true
                    }
                };

                res.json({
                    success: true,
                    message: 'High-throughput configuration active',
                    config: config,
                    warning: 'This is an aggressive configuration. Monitor for WhatsApp violations.'
                });
            } catch (error) {
                console.error('❌ Throughput config error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
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
        
        // Content analysis for spam detection
        const contentCheck = this.analyzeMessageContent(message);
        if (!contentCheck.safe) {
            console.error(`❌ [QUEUE] Message blocked due to content: ${contentCheck.reason}`);
            throw new Error(`Message blocked: ${contentCheck.reason}`);
        }
        
        // Pre-queue violation check including per-number limits
        const violationCheck = await this.checkForViolations(formattedNumber);
        if (!violationCheck.canSend) {
            console.error(`❌ [QUEUE] Message blocked due to violations: ${violationCheck.reason}`);
            throw new Error(`Cannot queue message: ${violationCheck.reason}`);
        }
        
        // Log per-number limit status
        if (violationCheck.numberLimitCheck) {
            const { number, currentCount, limit } = violationCheck.numberLimitCheck;
            console.log(`📊 [QUEUE] Number ${number} usage: ${currentCount}/${limit} messages today`);
            
            if (currentCount >= limit - 1) {
                console.log(`⚠️ [QUEUE] WARNING: Number ${number} will reach limit after this message`);
            }
        }
        
        // Validate number format
        const formattedNumber = this.formatPhoneNumber(number);
        console.log(`📞 [QUEUE] Formatted number: ${formattedNumber} at ${queueTime}`);
        if (!formattedNumber) {
            console.log(`❌ [QUEUE] Invalid phone number format at ${queueTime}`);
            throw new Error('Invalid phone number format');
        }

        // Daily limit removed - unlimited total messages, only per-number limit applies
        console.log(`📊 [QUEUE] Unlimited total messages allowed (queueMessage) at ${queueTime}`);

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

        // Daily limit removed - unlimited total messages, only per-number limit applies
        console.log(`📊 [QUEUE] Unlimited total messages allowed (queueMediaMessage) at ${queueTime}`);

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
                
                this.updateStats(message.number); // Pass the target number for per-number tracking
                
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
            
            // Aggressive delay optimization for high throughput (15/min = 4s intervals)
            const baseDelay = Math.random() * (this.rateLimiter.maxDelay - this.rateLimiter.minDelay) + this.rateLimiter.minDelay;
            
            // Reduced randomness for consistent high throughput
            const randomVariation = (Math.random() - 0.5) * 2000; // ±1 second variation only
            const finalDelay = Math.max(3000, baseDelay + randomVariation); // Minimum 3 seconds for aggressive sending
            
            const delaySeconds = Math.round(finalDelay/1000);
            console.log(`⚡ [PROCESSOR] High-throughput delay: ${delaySeconds} seconds (15/min target) at ${new Date().toLocaleTimeString()}...`);
            
            // Enhanced break logic
            if (this.stats.consecutiveMessages >= this.rateLimiter.breakAfter) {
                const breakTime = new Date().toLocaleTimeString();
                console.log(`😴 [PROCESSOR] Taking regular break after ${this.stats.consecutiveMessages} messages at ${breakTime}...`);
                this.broadcastToClients('status_update', { 
                    message: `Taking a ${this.rateLimiter.breakDuration/1000/60} minute break to avoid violations` 
                });
                await this.delay(this.rateLimiter.breakDuration);
                this.stats.consecutiveMessages = 0;
            }

            // Long break for extended messaging
            if (this.stats.messagesSent > 0 && this.stats.messagesSent % this.rateLimiter.longBreakAfter === 0) {
                const longBreakTime = new Date().toLocaleTimeString();
                console.log(`🛌 [PROCESSOR] Taking LONG break after ${this.stats.messagesSent} total messages at ${longBreakTime}...`);
                this.broadcastToClients('status_update', { 
                    message: `Taking a ${this.rateLimiter.longBreakDuration/1000/60} minute long break for safety` 
                });
                await this.delay(this.rateLimiter.longBreakDuration);
            }
            
            // Optimized countdown for high throughput (shorter delays)
            const countdownIntervals = [1, 2, 3]; // Only show final seconds for speed
            for (let i = delaySeconds; i > 0; i--) {
                if (countdownIntervals.includes(i)) {
                    console.log(`⚡ [TIMER] ${i}s remaining (high-throughput mode)...`);
                }
                await this.delay(1000);
            }
            console.log(`🚀 [TIMER] Ready for next message at ${new Date().toLocaleTimeString()}`);
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
            // Anti-violation checks BEFORE sending (including per-number limits)
            const violationCheck = await this.checkForViolations(messageObj.number);
            if (!violationCheck.canSend) {
                console.log(`🚫 [VIOLATION] Message blocked: ${violationCheck.reason}`);
                throw new Error(`Message sending blocked to prevent violations: ${violationCheck.reason}`);
            }

            // Log per-number status
            if (violationCheck.numberLimitCheck) {
                const { number, currentCount, limit } = violationCheck.numberLimitCheck;
                console.log(`📊 [SEND] Number ${number} status: ${currentCount}/${limit} messages used today`);
            }

            // Enhanced rate limit checks
            console.log(`📊 [SEND] Rate check at ${new Date().toLocaleTimeString()}: ${this.stats.messagesPerMinute}/${this.rateLimiter.maxPerMinute} per minute, ${this.stats.messagesPerHour}/${this.rateLimiter.maxPerHour} per hour`);
            
            if (this.stats.messagesPerMinute >= this.rateLimiter.maxPerMinute) {
                console.log(`⚠️ [SEND] Per-minute rate limit reached, waiting 1 minute...`);
                await this.delay(60000);
                this.stats.messagesPerMinute = 0;
                console.log(`✅ [SEND] Per-minute rate limit wait completed`);
            }

            if (this.stats.messagesPerHour >= this.rateLimiter.maxPerHour) {
                console.log(`⚠️ [SEND] Hourly rate limit reached, waiting 1 hour...`);
                await this.delay(3600000);
                this.stats.messagesPerHour = 0;
                console.log(`✅ [SEND] Hourly rate limit wait completed`);
            }

            // Check for daily quiet hours
            const currentHour = new Date().getHours();
            if (currentHour >= this.rateLimiter.dailyBreakStart || currentHour < this.rateLimiter.dailyBreakEnd) {
                console.log(`😴 [SEND] In quiet hours (${this.rateLimiter.dailyBreakStart}:00 - ${this.rateLimiter.dailyBreakEnd}:00), delaying message...`);
                const hoursUntilActive = currentHour >= this.rateLimiter.dailyBreakStart 
                    ? (24 - currentHour + this.rateLimiter.dailyBreakEnd) 
                    : (this.rateLimiter.dailyBreakEnd - currentHour);
                await this.delay(hoursUntilActive * 3600000);
            }

            // Weekend slowdown
            const isWeekend = [0, 6].includes(new Date().getDay());
            if (isWeekend && this.rateLimiter.weekendSlowdown) {
                console.log(`🏖️ [SEND] Weekend detected, applying extra delay...`);
                await this.delay(30000); // Extra 30 seconds on weekends
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

    analyzeMessageContent(message) {
        const spamKeywords = [
            'urgent', 'limited time', 'act now', 'call now', 'click here',
            'free money', 'make money fast', 'get rich quick', 'guaranteed',
            'winner', 'congratulations', 'you have won', 'claim now',
            'bitcoin', 'cryptocurrency', 'investment opportunity',
            'loan approved', 'credit card', 'debt relief',
            'weight loss', 'lose weight fast', 'miracle cure',
            'viagra', 'pharmacy', 'prescription'
        ];
        
        const suspiciousPatterns = [
            /(.)\1{4,}/g, // Repeated characters (aaaaa, 11111)
            /[A-Z]{10,}/g, // Too many capitals
            /(!)(\1{3,})/g, // Multiple exclamation marks
            /(\d+%\s*(off|discount|sale))/gi, // Discount offers
            /\$\d+/g, // Dollar amounts
            /(whatsapp\.com|wa\.me)/gi // WhatsApp links
        ];
        
        const messageLength = message.length;
        const lowerMessage = message.toLowerCase();
        
        // Check for spam keywords
        const foundSpamWords = spamKeywords.filter(keyword => 
            lowerMessage.includes(keyword.toLowerCase())
        );
        
        if (foundSpamWords.length > 0) {
            return {
                safe: false,
                reason: `Contains spam keywords: ${foundSpamWords.join(', ')}`,
                riskLevel: 'high'
            };
        }
        
        // Check for suspicious patterns
        const foundPatterns = suspiciousPatterns.filter(pattern => 
            pattern.test(message)
        );
        
        if (foundPatterns.length > 2) {
            return {
                safe: false,
                reason: 'Message contains multiple suspicious patterns',
                riskLevel: 'high'
            };
        }
        
        // Check message length (too short or too long can be suspicious)
        if (messageLength < 5) {
            return {
                safe: false,
                reason: 'Message too short (potential spam)',
                riskLevel: 'medium'
            };
        }
        
        if (messageLength > 1000) {
            return {
                safe: false,
                reason: 'Message too long (potential spam)',
                riskLevel: 'medium'
            };
        }
        
        // Check for too many URLs
        const urlCount = (message.match(/https?:\/\/[^\s]+/g) || []).length;
        if (urlCount > 2) {
            return {
                safe: false,
                reason: 'Too many URLs in message',
                riskLevel: 'high'
            };
        }
        
        console.log(`✅ [CONTENT] Message passed content analysis (${messageLength} chars, ${foundPatterns.length} patterns)`);
        return {
            safe: true,
            reason: 'Content analysis passed',
            riskLevel: 'low'
        };
    }

    async checkForViolations(targetNumber = null) {
        const now = Date.now();
        const currentHour = new Date().getHours();
        const today = new Date().toDateString();
        
        // Reset hourly counter
        if (new Date().getHours() !== this.stats.lastHourReset) {
            this.stats.messagesPerHour = 0;
            this.stats.lastHourReset = new Date().getHours();
        }
        
        // Reset daily counter and per-number tracking
        if (this.stats.lastReset !== today) {
            this.stats.dailyCount = 0;
            this.stats.lastReset = today;
            this.stats.violations = 0;
            this.stats.warningLevel = 'green';
            this.stats.numberMessageCounts.clear(); // Reset per-number counts
            this.stats.dailyUniqueNumbers.clear(); // Reset unique numbers
            console.log(`🔄 [RESET] Daily stats reset for ${today}`);
        }
        
        // Daily limit removed - unlimited total messages allowed
        console.log(`📊 [CHECK] Unlimited daily messages - only per-number limits apply`);
        
        // Check unique numbers limit - also unlimited now
        console.log(`📊 [CHECK] Unlimited unique numbers allowed per day`);
        
        // CRITICAL: Check per-number message limit
        if (targetNumber) {
            const numberKey = targetNumber.replace('@c.us', ''); // Clean key
            const messagesForNumber = this.stats.numberMessageCounts.get(numberKey) || 0;
            
            if (messagesForNumber >= this.rateLimiter.maxPerNumber) {
                this.stats.warningLevel = 'red';
                console.log(`🚫 [VIOLATION] Number ${numberKey} has reached limit: ${messagesForNumber}/${this.rateLimiter.maxPerNumber}`);
                return {
                    canSend: false,
                    reason: `Number ${numberKey} has reached daily limit of ${this.rateLimiter.maxPerNumber} messages`
                };
            }
            
            console.log(`📊 [CHECK] Number ${numberKey} messages: ${messagesForNumber}/${this.rateLimiter.maxPerNumber}`);
        }
        
        // Check if too many messages sent too quickly
        const timeSinceLastMessage = now - this.stats.lastMessageTime;
        if (timeSinceLastMessage < this.rateLimiter.minDelay) {
            return {
                canSend: false,
                reason: `Minimum delay of ${this.rateLimiter.minDelay/1000} seconds not met`
            };
        }
        
        // Check quiet hours
        if (currentHour >= this.rateLimiter.dailyBreakStart || currentHour < this.rateLimiter.dailyBreakEnd) {
            return {
                canSend: false,
                reason: `Quiet hours active (${this.rateLimiter.dailyBreakStart}:00 - ${this.rateLimiter.dailyBreakEnd}:00)`
            };
        }
        
        // Warning system based on multiple factors
        const dailyUsagePercent = (this.stats.dailyCount / this.rateLimiter.maxPerDay) * 100;
        const uniqueNumbersPercent = (this.stats.dailyUniqueNumbers.size / this.rateLimiter.maxUniqueNumbersPerDay) * 100;
        
        if (dailyUsagePercent > 80 || uniqueNumbersPercent > 80) {
            this.stats.warningLevel = 'red';
            console.log(`🚨 [WARNING] High usage: ${dailyUsagePercent.toFixed(1)}% daily, ${uniqueNumbersPercent.toFixed(1)}% unique numbers`);
        } else if (dailyUsagePercent > 60 || uniqueNumbersPercent > 60) {
            this.stats.warningLevel = 'yellow';
            console.log(`⚠️ [WARNING] Moderate usage: ${dailyUsagePercent.toFixed(1)}% daily, ${uniqueNumbersPercent.toFixed(1)}% unique numbers`);
        }
        
        // Check for suspicious patterns
        if (this.stats.consecutiveMessages > this.rateLimiter.suspiciousPatternThreshold) {
            console.log(`⚠️ [PATTERN] High consecutive messages detected: ${this.stats.consecutiveMessages}`);
            this.stats.violations++;
        }
        
        return {
            canSend: true,
            reason: 'All checks passed',
            warningLevel: this.stats.warningLevel,
            numberLimitCheck: targetNumber ? {
                number: targetNumber.replace('@c.us', ''),
                currentCount: this.stats.numberMessageCounts.get(targetNumber.replace('@c.us', '')) || 0,
                limit: this.rateLimiter.maxPerNumber
            } : null
        };
    }

    updateStats(targetNumber = null) {
        const today = new Date().toDateString();
        const currentHour = new Date().getHours();
        
        // Reset daily count if new day
        if (this.stats.lastReset !== today) {
            this.stats.dailyCount = 0;
            this.stats.lastReset = today;
            this.stats.violations = 0;
            this.stats.warningLevel = 'green';
            this.stats.numberMessageCounts.clear();
            this.stats.dailyUniqueNumbers.clear();
        }
        
        // Reset hourly count if new hour
        if (this.stats.lastHourReset !== currentHour) {
            this.stats.messagesPerHour = 0;
            this.stats.lastHourReset = currentHour;
        }
        
        this.stats.messagesSent++;
        this.stats.dailyCount++;
        this.stats.messagesPerHour++;
        this.stats.messagesPerMinute++;
        this.stats.consecutiveMessages++;
        this.stats.lastMessageTime = Date.now();
        
        // CRITICAL: Track per-number message counts
        if (targetNumber) {
            const numberKey = targetNumber.replace('@c.us', ''); // Clean key
            const currentCount = this.stats.numberMessageCounts.get(numberKey) || 0;
            this.stats.numberMessageCounts.set(numberKey, currentCount + 1);
            this.stats.dailyUniqueNumbers.add(numberKey);
            
            console.log(`📊 [STATS] Number ${numberKey} now has ${currentCount + 1}/${this.rateLimiter.maxPerNumber} messages today`);
            
            // Warning if approaching per-number limit
            if (currentCount + 1 >= this.rateLimiter.maxPerNumber) {
                console.log(`🚫 [LIMIT] Number ${numberKey} has reached maximum daily messages (${this.rateLimiter.maxPerNumber})`);
            }
        }
        
        // Reset per-minute counter every minute
        setTimeout(() => {
            this.stats.messagesPerMinute = Math.max(0, this.stats.messagesPerMinute - 1);
        }, 60000);
        
        console.log(`📊 [STATS] Updated - Daily: ${this.stats.dailyCount}/${this.rateLimiter.maxPerDay}, Hourly: ${this.stats.messagesPerHour}/${this.rateLimiter.maxPerHour}, Unique numbers: ${this.stats.dailyUniqueNumbers.size}/${this.rateLimiter.maxUniqueNumbersPerDay}, Warning: ${this.stats.warningLevel}`);
        
        this.broadcastToClients('stats_update', {
            ...this.stats,
            // Convert Map and Set to arrays for JSON serialization
            numberMessageCounts: Object.fromEntries(this.stats.numberMessageCounts),
            dailyUniqueNumbers: Array.from(this.stats.dailyUniqueNumbers)
        });
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
