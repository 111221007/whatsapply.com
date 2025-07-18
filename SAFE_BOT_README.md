# 🚀 Safe WhatsApp Bot with Web Interface

A comprehensive WhatsApp automation solution with built-in safety controls and a beautiful web interface.

## ✨ Features

### 🛡️ Safety Controls
- **Rate Limiting**: Maximum 15 messages per minute, 1000 per day
- **Smart Delays**: Random delays between messages (3-10 seconds)
- **Auto Breaks**: Mandatory breaks every 10 messages (5 minutes)
- **Number Validation**: Checks if numbers are valid WhatsApp users
- **Connection Monitoring**: Automatic reconnection handling
- **Error Recovery**: Retry logic with exponential backoff

### 🌐 Web Interface
- **Real-time Dashboard**: Live connection status and statistics
- **Message Queue Management**: Visual queue with status tracking
- **Contact Management**: Load and select from your WhatsApp contacts
- **Activity Logs**: Real-time logging of all bot activities
- **QR Code Display**: Easy WhatsApp authentication
- **Mobile Responsive**: Works on all devices

### 📊 Analytics
- **Daily Statistics**: Track messages sent, success rates
- **Rate Monitoring**: Real-time rate limit tracking
- **Progress Indicators**: Visual progress bars for daily limits
- **Queue Status**: Live queue length and processing status

## 🚀 Quick Start

### 1. Install Dependencies
```bash
# Exit any existing REPL first (Ctrl+D)
npm install express socket.io
```

### 2. Start the Safe Bot
```bash
npm run bot
# or
node safe-whatsapp-bot.js
```

### 3. Open Web Interface
Open your browser and go to: **http://localhost:3000**

### 4. Authenticate WhatsApp
1. A browser window will open automatically
2. Scan the QR code with your WhatsApp mobile app
3. Go to: WhatsApp → Settings → Linked Devices → Link a Device
4. Scan the QR code displayed in the web interface

## 🎯 Usage

### Web Interface (Recommended)
1. **Open Dashboard**: Navigate to `http://localhost:3000`
2. **Send Messages**: Use the message form with number validation
3. **Monitor Queue**: Watch real-time queue processing
4. **View Statistics**: Track your messaging analytics
5. **Manage Contacts**: Load and select from your contacts

### API Endpoints
- `GET /api/status` - Get bot status and statistics
- `POST /api/send-message` - Queue a message
- `POST /api/validate-number` - Validate WhatsApp number
- `GET /api/contacts` - Get WhatsApp contacts

### Example API Usage
```javascript
// Send a message via API
fetch('/api/send-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        number: '+1234567890',
        message: 'Hello from Safe WhatsApp Bot!',
        priority: 'normal'
    })
});
```

## ⚙️ Configuration

### Rate Limits (in safe-whatsapp-bot.js)
```javascript
this.rateLimiter = {
    maxPerMinute: 15,        // Max messages per minute
    maxPerDay: 1000,         // Max messages per day
    minDelay: 3000,          // Min delay between messages (3s)
    maxDelay: 10000,         // Max delay between messages (10s)
    breakAfter: 10,          // Take break after X messages
    breakDuration: 300000    // Break duration (5 minutes)
};
```

### WhatsApp Client Settings
```javascript
this.client = new Client({
    authStrategy: new LocalAuth({ clientId: 'safe-bot' }),
    puppeteer: { 
        headless: false,     // Set to true for headless mode
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});
```

## 🛡️ Safety Best Practices

### ✅ DO:
- Use personal contacts only
- Send personalized messages
- Respect rate limits
- Take regular breaks
- Monitor connection status
- Use meaningful message content
- Validate numbers before sending

### ❌ DON'T:
- Send to unknown/random numbers
- Use identical spam-like messages
- Exceed rate limits
- Run 24/7 without breaks
- Ignore connection issues
- Send promotional content on personal accounts

## 🎨 Web Interface Features

### Dashboard
- **Connection Status**: Real-time WhatsApp connection monitoring
- **Statistics**: Messages sent, success rates, daily progress
- **Queue Management**: Live queue with message status
- **Rate Monitoring**: Current rate vs. limits

### Message Composer
- **Number Validation**: Check if numbers are valid WhatsApp users
- **Priority Levels**: Normal and high priority queuing
- **Character Counter**: Track message length
- **Contact Selection**: Choose from loaded contacts

### Activity Logs
- **Real-time Logging**: Live activity feed
- **Color Coding**: Different colors for different log types
- **Timestamps**: Precise timing for all activities
- **Error Tracking**: Detailed error reporting

## 🔧 Troubleshooting

### Common Issues

**1. WhatsApp Not Connecting**
- Make sure no other WhatsApp Web sessions are active
- Clear browser cache and cookies
- Restart the bot and scan QR code again

**2. Messages Not Sending**
- Check if numbers are valid WhatsApp users
- Verify rate limits aren't exceeded
- Check connection status in dashboard

**3. Web Interface Not Loading**
- Ensure port 3000 is not in use
- Check console for error messages
- Restart the bot

### Error Messages
- **"Rate limit reached"**: Slow down, wait for cooldown
- **"Contact not found"**: Invalid WhatsApp number
- **"Daily limit exceeded"**: Reached 1000 messages for today
- **"WhatsApp not connected"**: Authentication required

## 📱 Mobile Access

The web interface is fully responsive and works on mobile devices:
- **Tablets**: Full dashboard experience
- **Phones**: Optimized layout with touch controls
- **Progressive Web App**: Add to home screen capability

## 🔒 Security

- **Local Authentication**: Sessions stored locally
- **No Data Collection**: All data stays on your device
- **Secure Connections**: HTTPS ready for production
- **Session Management**: Automatic session cleanup

## 📈 Advanced Usage

### Bulk Messaging with Safety
```javascript
const contacts = ['+1234567890', '+0987654321'];
const messages = ['Hi John!', 'Hello Sarah!'];

for (let i = 0; i < contacts.length; i++) {
    await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            number: contacts[i],
            message: messages[i],
            priority: 'normal'
        })
    });
    
    // The bot automatically handles delays and safety
}
```

### Custom Message Templates
```javascript
const template = (name) => `Hi ${name}! Hope you're having a great day! 🌟`;

// Use in web interface or API
```

## 🤝 Contributing

Feel free to contribute to this project by:
- Reporting bugs
- Suggesting features
- Improving documentation
- Submitting pull requests

## 📄 License

This project is built on top of whatsapp-web.js and follows the same Apache-2.0 license.

## ⚠️ Disclaimer

This tool is for educational and personal use only. Always comply with WhatsApp's Terms of Service and local regulations. Use responsibly and respect others' privacy.
