const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('./index');

console.log('🔧 Starting WhatsApp Debug Server...');

const app = express();
let whatsappClient = null;
let isConnected = false;
let qrCode = null;
let connectionStatus = 'disconnected';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize WhatsApp Client
function initializeWhatsApp() {
    if (whatsappClient) {
        console.log('⚠️ WhatsApp client already exists');
        return;
    }

    console.log('📱 Initializing WhatsApp client...');
    
    whatsappClient = new Client({
        authStrategy: new LocalAuth({ clientId: 'debug-bot' }),
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

    // Event handlers
    whatsappClient.on('qr', (qr) => {
        console.log('📱 QR Code received');
        qrCode = qr;
        connectionStatus = 'qr_received';
    });

    whatsappClient.on('authenticated', () => {
        console.log('✅ WhatsApp authenticated successfully');
        connectionStatus = 'authenticated';
    });

    whatsappClient.on('ready', () => {
        console.log('🚀 WhatsApp client is ready!');
        isConnected = true;
        connectionStatus = 'connected';
        qrCode = null;
    });

    whatsappClient.on('disconnected', (reason) => {
        console.log('❌ WhatsApp client disconnected:', reason);
        isConnected = false;
        connectionStatus = 'disconnected';
        qrCode = null;
    });

    whatsappClient.on('auth_failure', (message) => {
        console.error('❌ Authentication failure:', message);
        connectionStatus = 'auth_failed';
    });

    // Initialize the client
    whatsappClient.initialize().catch(error => {
        console.error('❌ Failed to initialize WhatsApp client:', error);
        connectionStatus = 'error';
    });
}

// API Endpoints
app.get('/api/debug-status', (req, res) => {
    console.log('Debug status requested');
    res.json({
        timestamp: new Date().toISOString(),
        connection: {
            isConnected: isConnected,
            clientState: connectionStatus,
            qrCode: qrCode
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

// Connect to WhatsApp
app.post('/api/connect', (req, res) => {
    console.log('🔌 WhatsApp connection requested');
    
    if (whatsappClient && isConnected) {
        return res.json({
            success: false,
            message: 'WhatsApp is already connected',
            status: connectionStatus
        });
    }

    if (whatsappClient && connectionStatus === 'connecting') {
        return res.json({
            success: false,
            message: 'WhatsApp is already connecting',
            status: connectionStatus
        });
    }

    try {
        connectionStatus = 'connecting';
        initializeWhatsApp();
        
        res.json({
            success: true,
            message: 'WhatsApp connection initiated',
            status: connectionStatus
        });
    } catch (error) {
        console.error('❌ Error connecting to WhatsApp:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to connect to WhatsApp',
            error: error.message
        });
    }
});

// Disconnect from WhatsApp
app.post('/api/disconnect', async (req, res) => {
    console.log('🔌 WhatsApp disconnection requested');
    
    if (!whatsappClient) {
        return res.json({
            success: false,
            message: 'WhatsApp client is not initialized',
            status: connectionStatus
        });
    }

    try {
        await whatsappClient.destroy();
        whatsappClient = null;
        isConnected = false;
        connectionStatus = 'disconnected';
        qrCode = null;
        
        res.json({
            success: true,
            message: 'WhatsApp disconnected successfully',
            status: connectionStatus
        });
    } catch (error) {
        console.error('❌ Error disconnecting from WhatsApp:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to disconnect from WhatsApp',
            error: error.message
        });
    }
});

// Get current QR code
app.get('/api/qr', async (req, res) => {
    try {
        if (!qrCode) {
            return res.json({
                success: false,
                message: 'No QR code available',
                status: connectionStatus
            });
        }

        // Generate QR code as data URL
        const qrDataURL = await QRCode.toDataURL(qrCode, {
            errorCorrectionLevel: 'M',
            type: 'image/png',
            quality: 0.92,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        res.json({
            success: true,
            qr: qrDataURL,
            status: connectionStatus,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ QR code generation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate QR code',
            error: error.message
        });
    }
});

// Open QR code in new tab (fallback for browsers that can't display inline)
app.get('/api/qr-tab', async (req, res) => {
    try {
        if (!qrCode) {
            return res.status(404).send(`
                <html>
                    <head><title>QR Code Not Available</title></head>
                    <body style="font-family: Arial; text-align: center; padding: 50px;">
                        <h2>❌ QR Code Not Available</h2>
                        <p>Please connect to WhatsApp first to generate a QR code.</p>
                        <button onclick="window.close()">Close</button>
                    </body>
                </html>
            `);
        }

        // Generate QR code as data URL
        const qrDataURL = await QRCode.toDataURL(qrCode, {
            errorCorrectionLevel: 'M',
            type: 'image/png',
            quality: 0.92,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        res.send(`
            <html>
                <head>
                    <title>WhatsApp QR Code</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { 
                            font-family: Arial, sans-serif; 
                            text-align: center; 
                            padding: 20px; 
                            background: #f0f8f0; 
                        }
                        .container { 
                            max-width: 400px; 
                            margin: 0 auto; 
                            background: white; 
                            padding: 30px; 
                            border-radius: 10px; 
                            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                        }
                        .qr-code { 
                            margin: 20px 0; 
                            border: 2px solid #25d366; 
                            border-radius: 8px; 
                            padding: 10px; 
                            background: white;
                        }
                        .instructions { 
                            background: #e8f5e8; 
                            padding: 15px; 
                            border-radius: 5px; 
                            margin: 15px 0; 
                        }
                        .auto-refresh { 
                            color: #666; 
                            font-size: 12px; 
                            margin-top: 15px; 
                        }
                        button { 
                            background: #25d366; 
                            color: white; 
                            border: none; 
                            padding: 10px 20px; 
                            border-radius: 5px; 
                            cursor: pointer; 
                            margin: 5px; 
                        }
                        button:hover { background: #128c7e; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h2 style="color: #25d366;">📱 WhatsApp QR Code</h2>
                        <div class="qr-code">
                            <img src="${qrDataURL}" alt="WhatsApp QR Code" style="max-width: 100%; height: auto;">
                        </div>
                        <div class="instructions">
                            <h4 style="margin: 0 0 10px 0; color: #128c7e;">📋 How to Connect:</h4>
                            <p style="margin: 5px 0;">1. Open WhatsApp on your phone</p>
                            <p style="margin: 5px 0;">2. Go to Settings > Linked Devices</p>
                            <p style="margin: 5px 0;">3. Tap "Link a Device"</p>
                            <p style="margin: 5px 0;">4. Scan this QR code</p>
                        </div>
                        <button onclick="location.reload()">🔄 Refresh QR Code</button>
                        <button onclick="window.close()">❌ Close</button>
                        <div class="auto-refresh">
                            🔄 Auto-refreshing every 30 seconds...
                        </div>
                    </div>
                    <script>
                        // Auto-refresh every 30 seconds
                        setInterval(() => {
                            location.reload();
                        }, 30000);
                        
                        // Check if connected every 5 seconds
                        setInterval(async () => {
                            try {
                                const response = await fetch('/api/debug-status');
                                const data = await response.json();
                                if (data.connection.isConnected) {
                                    document.body.innerHTML = \`
                                        <div class="container">
                                            <h2 style="color: #25d366;">✅ Connected Successfully!</h2>
                                            <p>WhatsApp is now connected. You can close this tab.</p>
                                            <button onclick="window.close()">Close Tab</button>
                                        </div>
                                    \`;
                                }
                            } catch (error) {
                                console.log('Status check failed:', error);
                            }
                        }, 5000);
                    </script>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('❌ QR code tab generation error:', error);
        res.status(500).send(`
            <html>
                <head><title>Error</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h2>❌ Error Generating QR Code</h2>
                    <p>${error.message}</p>
                    <button onclick="window.close()">Close</button>
                </body>
            </html>
        `);
    }
});

// Send test message
app.post('/api/send-message', async (req, res) => {
    const { number, message } = req.body;
    
    if (!isConnected || !whatsappClient) {
        return res.status(400).json({
            success: false,
            message: 'WhatsApp is not connected'
        });
    }

    if (!number || !message) {
        return res.status(400).json({
            success: false,
            message: 'Number and message are required'
        });
    }

    try {
        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
        await whatsappClient.sendMessage(chatId, message);
        
        res.json({
            success: true,
            message: 'Message sent successfully',
            to: number,
            content: message,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error sending message:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send message',
            error: error.message
        });
    }
});

// Validate WhatsApp number
app.post('/api/validate-number', async (req, res) => {
    const { number } = req.body;
    
    if (!number) {
        return res.json({
            valid: false,
            message: 'No number provided'
        });
    }
    
    // Basic validation - check if number looks like a valid international number
    const cleanNumber = number.replace(/[^\d+]/g, '');
    const isValidFormat = /^\+\d{10,15}$/.test(cleanNumber);
    
    if (!isValidFormat) {
        return res.json({
            valid: false,
            message: 'Invalid number format. Use international format like +886928316907'
        });
    }
    
    if (!isConnected || !whatsappClient) {
        // If not connected, do basic format validation only
        return res.json({
            valid: isValidFormat,
            message: isValidFormat ? 'Number format is valid (WhatsApp connection needed for full validation)' : 'Invalid number format',
            number: cleanNumber
        });
    }

    try {
        // Format the number properly for WhatsApp
        const phoneNumber = cleanNumber.replace('+', '');
        const chatId = `${phoneNumber}@c.us`;
        
        // Try to get the contact info to validate
        const contact = await whatsappClient.getContactById(chatId);
        
        res.json({
            valid: contact && contact.isWAContact,
            number: cleanNumber,
            contact: contact ? {
                name: contact.name,
                pushname: contact.pushname,
                isWAContact: contact.isWAContact
            } : null,
            message: contact && contact.isWAContact ? 'Valid WhatsApp number!' : 'Number format is correct but may not be on WhatsApp'
        });
    } catch (error) {
        console.error('❌ Number validation error:', error);
        // Even if validation fails, if format is good, consider it potentially valid
        res.json({
            valid: isValidFormat,
            message: isValidFormat ? 'Number format is valid (could not verify WhatsApp status)' : 'Invalid number format',
            error: error.message
        });
    }
});

// Get bot status
app.get('/api/status', (req, res) => {
    res.json({
        connected: isConnected,
        queueLength: 0, // Placeholder
        processing: false, // Placeholder
        stats: {
            messagesSent: 0,
            dailyCount: 0,
            messagesPerMinute: 0
        }
    });
});

// Start processing queue
app.post('/api/start-processing', (req, res) => {
    if (!isConnected) {
        return res.json({
            success: false,
            message: 'WhatsApp is not connected'
        });
    }
    
    res.json({
        success: true,
        message: 'Message processing started'
    });
});

// Get contacts
app.get('/api/contacts', async (req, res) => {
    if (!isConnected || !whatsappClient) {
        return res.status(400).json({
            success: false,
            message: 'WhatsApp is not connected'
        });
    }

    try {
        const contacts = await whatsappClient.getContacts();
        const formattedContacts = contacts
            .filter(contact => contact.isWAContact)
            .slice(0, 50) // Limit to first 50 contacts
            .map(contact => ({
                number: contact.number,
                name: contact.name,
                pushname: contact.pushname
            }));
        
        res.json(formattedContacts);
    } catch (error) {
        console.error('❌ Error getting contacts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get contacts',
            error: error.message
        });
    }
});

// Test message endpoint
app.get('/api/test-message/:number/:message', async (req, res) => {
    const { number, message } = req.params;
    
    if (!isConnected || !whatsappClient) {
        return res.json({
            success: false,
            error: 'WhatsApp is not connected'
        });
    }

    try {
        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
        await whatsappClient.sendMessage(chatId, decodeURIComponent(message));
        
        res.json({
            success: true,
            message: 'Test message sent successfully',
            to: number,
            content: decodeURIComponent(message)
        });
    } catch (error) {
        console.error('❌ Test message error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

const PORT = 3002;
app.listen(PORT, () => {
    console.log(`🌐 Debug server running on http://localhost:${PORT}`);
});
