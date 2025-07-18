#!/usr/bin/env node

// Safe WhatsApp Bot - Status Check and Demo
console.log('\n🚀 Safe WhatsApp Bot - System Status Check\n');

const fs = require('fs');
const path = require('path');

// Check if all required files exist
const requiredFiles = [
    { file: 'safe-whatsapp-bot.js', desc: 'Main Bot System' },
    { file: 'public/index.html', desc: 'Web Interface' },
    { file: 'package.json', desc: 'Package Configuration' },
    { file: 'SAFE_BOT_README.md', desc: 'Documentation' }
];

console.log('📋 File Status Check:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

let allFilesExist = true;
requiredFiles.forEach(({ file, desc }) => {
    const exists = fs.existsSync(path.join(__dirname, file));
    const status = exists ? '✅' : '❌';
    const size = exists ? `(${Math.round(fs.statSync(path.join(__dirname, file)).size / 1024)}KB)` : '';
    console.log(`${status} ${desc.padEnd(25)} ${file} ${size}`);
    if (!exists) allFilesExist = false;
});

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (allFilesExist) {
    console.log('🎉 All required files are present and ready!\n');
} else {
    console.log('⚠️  Some files are missing. Please run the setup again.\n');
    process.exit(1);
}

// Check if dependencies are installed
console.log('📦 Dependency Status:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const requiredDeps = ['express', 'socket.io'];
const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

let allDepsInstalled = true;
requiredDeps.forEach(dep => {
    const inPackage = packageJson.dependencies && packageJson.dependencies[dep];
    const installed = fs.existsSync(path.join(__dirname, 'node_modules', dep));
    
    const status = inPackage && installed ? '✅' : (inPackage ? '📦' : '❌');
    const statusText = inPackage && installed ? 'Installed' : (inPackage ? 'In package.json' : 'Missing');
    
    console.log(`${status} ${dep.padEnd(15)} ${statusText}`);
    
    if (!installed) allDepsInstalled = false;
});

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

console.log('\n🎯 What\'s Ready to Use:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const features = [
    '🛡️  Rate Limiting System (15 msg/min, 1000/day)',
    '⏱️  Smart Delays (3-10 seconds between messages)',
    '🔄 Auto Breaks (5 min break every 10 messages)',
    '✅ Number Validation (checks valid WhatsApp users)',
    '🌐 Web Dashboard (real-time interface)',
    '📊 Statistics Tracking (success rates, daily limits)',
    '📋 Message Queue Management',
    '📱 Contact Integration',
    '🔗 Socket.IO Real-time Updates',
    '📝 Activity Logging',
    '🎨 Responsive Design (mobile-friendly)',
    '🔌 REST API Endpoints'
];

features.forEach(feature => console.log(`   ${feature}`));

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

console.log('\n🚀 How to Start:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (!allDepsInstalled) {
    console.log('📦 Step 1: Install dependencies');
    console.log('   npm install express socket.io\n');
}

console.log('🎯 Step 2: Start the bot');
console.log('   node safe-whatsapp-bot.js');
console.log('   # or');
console.log('   npm run bot\n');

console.log('🌐 Step 3: Open web interface');
console.log('   http://localhost:3000\n');

console.log('📱 Step 4: Scan QR code with WhatsApp mobile app\n');

console.log('💡 Features available in web interface:');
const webFeatures = [
    'Real-time connection status',
    'Message composer with validation',
    'Contact loader and selector',
    'Live activity logs',
    'Statistics dashboard',
    'Queue management',
    'Progress tracking'
];

webFeatures.forEach(feature => console.log(`   • ${feature}`));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎉 System is ready! Follow the steps above to start your Safe WhatsApp Bot.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
