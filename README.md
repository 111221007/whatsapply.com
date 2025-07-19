<div align="center">
    <br />
    <p>
        <a href="https://wwebjs.dev"><img src="https://github.com/wwebjs/logos/blob/main/4_Full%20Logo%20Lockup_Small/small_banner_blue.png?raw=true" title="whatsapp-web.js" alt="WWebJS Website" width="500" /></a>
    </p>
    <br />
    <p>
		<a href="https://www.npmjs.com/package/whatsapp-web.js"><img src="https://img.shields.io/npm/v/whatsapp-web.js.svg" alt="npm" /></a>
        <a href="https://depfu.com/github/pedroslopez/whatsapp-web.js?project_id=9765"><img src="https://badges.depfu.com/badges/4a65a0de96ece65fdf39e294e0c8dcba/overview.svg" alt="Depfu" /></a>
        <img src="https://img.shields.io/badge/WhatsApp_Web-2.3000.1017054665-brightgreen.svg" alt="WhatsApp_Web 2.2346.52" />
        <a href="https://discord.gg/H7DqQs4"><img src="https://img.shields.io/discord/698610475432411196.svg?logo=discord" alt="Discord server" /></a>
	</p>
    <br />
</div>

## About
**A WhatsApp API client that connects through the WhatsApp Web browser app**

The library works by launching the WhatsApp Web browser application and managing it using Puppeteer to create an instance of WhatsApp Web, thereby mitigating the risk of being blocked. The WhatsApp API client connects through the WhatsApp Web browser app, accessing its internal functions. This grants you access to nearly all the features available on WhatsApp Web, enabling dynamic handling similar to any other Node.js application.

> [!IMPORTANT]
> **It is not guaranteed you will not be blocked by using this method. WhatsApp does not allow bots or unofficial clients on their platform, so this shouldn't be considered totally safe.**

## Links

* [Website][website]
* [Guide][guide] ([source][guide-source]) _(work in progress)_
* [Documentation][documentation] ([source][documentation-source])
* [WWebJS Discord][discord]
* [GitHub][gitHub]
* [npm][npm]

## Installation

The module is now available on npm! `npm i whatsapp-web.js`

> [!NOTE]
> **Node ``v18+`` is required.**

## QUICK STEPS TO UPGRADE NODE

### Windows

#### Manual
Just get the latest LTS from the [official node website][nodejs].

#### npm
```powershell
sudo npm install -g n
sudo n stable
```

#### Choco
```powershell
choco install nodejs-lts
```

#### Winget
```powershell
winget install OpenJS.NodeJS.LTS
```

### Ubuntu / Debian
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - &&\
sudo apt-get install -y nodejs
```

## Example usage

```js
const { Client } = require('whatsapp-web.js');

const client = new Client();

client.on('qr', (qr) => {
    // Generate and scan this code with your phone
    console.log('QR RECEIVED', qr);
});

client.on('ready', () => {
    console.log('Client is ready!');
});

client.on('message', msg => {
    if (msg.body == '!ping') {
        msg.reply('pong');
    }
});

client.initialize();
```

Take a look at [example.js][examples] for another examples with additional use cases.  
For further details on saving and restoring sessions, explore the provided [Authentication Strategies][auth-strategies].

## High-Throughput WhatsApp Bot API

This project includes a production-ready high-throughput WhatsApp bot with comprehensive API endpoints for bulk messaging and monitoring.

### 🚀 Live Production Instance

**Main Application:** https://whatsapply-bot-39691067078e.herokuapp.com/

### 📱 Bot Features

- **High-Throughput Messaging:** 15 messages/minute, 900/hour, unlimited daily
- **Per-Number Safety:** Maximum 5 messages per unique number per day
- **Smart Rate Limiting:** Automatic violation prevention and retry logic
- **CSV Bulk Import:** Upload contact lists for mass messaging
- **Media Support:** Images, documents, and text messages
- **Real-time Monitoring:** Live statistics and connection status

### 🔗 API Endpoints

#### Core Messaging APIs
- **Send Single Message:** `POST /api/send-message`
- **Send Bulk Messages:** `POST /api/send-bulk`
- **Upload CSV:** `POST /api/upload-csv`

#### Status & Monitoring APIs
- **Bot Status:** `GET /api/status`
- **Debug Status:** `GET /api/debug-status`
- **Rate Limits:** `GET /api/rate-limits`
- **Message Stats:** `GET /api/message-stats`
- **Per-Number Stats:** `GET /api/per-number-stats`

#### Management APIs
- **Reset Rate Limits:** `POST /api/reset-rate-limits`
- **Reset Per-Number Limits:** `POST /api/reset-per-number-limits`
- **Emergency Stop:** `POST /api/emergency-stop`

### 📊 Current Configuration

```javascript
// Rate Limiting (Aggressive High-Throughput)
maxPerMinute: 15        // Messages per minute
maxPerHour: 900         // Messages per hour  
maxPerDay: Infinity     // Unlimited daily messages

// Per-Number Safety Limits
maxPerNumber: 5         // Max messages per unique number per day
numberCooldown: 12hrs   // Cooldown period for numbers

// Timing Optimization
messageDelay: 4-8s      // Optimized delays between messages
breakInterval: 5min     // Break every 15 messages
```

### 🔧 Quick Start API Usage

```bash
# Check bot status
curl https://whatsapply-bot-39691067078e.herokuapp.com/api/status

# Send a single message
curl -X POST https://whatsapply-bot-39691067078e.herokuapp.com/api/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "number": "1234567890",
    "message": "Hello from WhatsApp Bot!"
  }'

# Get current rate limits
curl https://whatsapply-bot-39691067078e.herokuapp.com/api/rate-limits

# View message statistics
curl https://whatsapply-bot-39691067078e.herokuapp.com/api/message-stats
```

### 🎯 Use Cases

- **Marketing Campaigns:** Bulk messaging with per-contact limits
- **Customer Support:** Automated responses and notifications  
- **Event Broadcasting:** Mass announcements with safety controls
- **Lead Generation:** Targeted messaging with compliance tracking


## Supported features

| Feature  | Status |
| ------------- | ------------- |
| Multi Device  | ✅  |
| Send messages  | ✅  |
| Receive messages  | ✅  |
| Send media (images/audio/documents)  | ✅  |
| Send media (video)  | ✅ [(requires Google Chrome)][google-chrome]  |
| Send stickers | ✅ |
| Receive media (images/audio/video/documents)  | ✅  |
| Send contact cards | ✅ |
| Send location | ✅ |
| Send buttons | ❌  [(DEPRECATED)][deprecated-video] |
| Send lists | ❌  [(DEPRECATED)][deprecated-video] |
| Receive location | ✅ | 
| Message replies | ✅ |
| Join groups by invite  | ✅ |
| Get invite for group  | ✅ |
| Modify group info (subject, description)  | ✅  |
| Modify group settings (send messages, edit info)  | ✅  |
| Add group participants  | ✅  |
| Kick group participants  | ✅  |
| Promote/demote group participants | ✅ |
| Mention users | ✅ |
| Mention groups | ✅ |
| Mute/unmute chats | ✅ |
| Block/unblock contacts | ✅ |
| Get contact info | ✅ |
| Get profile pictures | ✅ |
| Set user status message | ✅ |
| React to messages | ✅ |
| Create polls | ✅ |
| Channels | ✅ |
| Vote in polls | 🔜 |
| Communities | 🔜 |

Something missing? Make an issue and let us know!

## Contributing

Feel free to open pull requests; we welcome contributions! However, for significant changes, it's best to open an issue beforehand. Make sure to review our [contribution guidelines][contributing] before creating a pull request. Before creating your own issue or pull request, always check to see if one already exists!

## Supporting the project

You can support the maintainer of this project through the links below

- [Support via GitHub Sponsors][gitHub-sponsors]
- [Support via PayPal][support-payPal]
- [Sign up for DigitalOcean][digitalocean] and get $200 in credit when you sign up (Referral)

## Disclaimer

This project is not affiliated, associated, authorized, endorsed by, or in any way officially connected with WhatsApp or any of its subsidiaries or its affiliates. The official WhatsApp website can be found at [whatsapp.com][whatsapp]. "WhatsApp" as well as related names, marks, emblems and images are registered trademarks of their respective owners. Also it is not guaranteed you will not be blocked by using this method. WhatsApp does not allow bots or unofficial clients on their platform, so this shouldn't be considered totally safe.

## License

Copyright 2019 Pedro S Lopez  

Licensed under the Apache License, Version 2.0 (the "License");  
you may not use this project except in compliance with the License.  
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.  

Unless required by applicable law or agreed to in writing, software  
distributed under the License is distributed on an "AS IS" BASIS,  
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  
See the License for the specific language governing permissions and  
limitations under the License.  


[website]: https://wwebjs.dev
[guide]: https://guide.wwebjs.dev/guide
[guide-source]: https://github.com/wwebjs/wwebjs.dev/tree/main
[documentation]: https://docs.wwebjs.dev/
[documentation-source]: https://github.com/pedroslopez/whatsapp-web.js/tree/main/docs
[discord]: https://discord.gg/H7DqQs4
[gitHub]: https://github.com/pedroslopez/whatsapp-web.js
[npm]: https://npmjs.org/package/whatsapp-web.js
[nodejs]: https://nodejs.org/en/download/
[examples]: https://github.com/pedroslopez/whatsapp-web.js/blob/master/example.js
[auth-strategies]: https://wwebjs.dev/guide/creating-your-bot/authentication.html
[google-chrome]: https://wwebjs.dev/guide/creating-your-bot/handling-attachments.html#caveat-for-sending-videos-and-gifs
[deprecated-video]: https://www.youtube.com/watch?v=hv1R1rLeVVE
[gitHub-sponsors]: https://github.com/sponsors/pedroslopez
[support-payPal]: https://www.paypal.me/psla/
[digitalocean]: https://m.do.co/c/73f906a36ed4
[contributing]: https://github.com/pedroslopez/whatsapp-web.js/blob/main/CODE_OF_CONDUCT.md
[whatsapp]: https://whatsapp.com
