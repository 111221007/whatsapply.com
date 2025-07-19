# Safe WhatsApp Bot - Heroku Deployment

This guide will help you deploy the Safe WhatsApp Bot to Heroku.

## Quick Deploy

[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

## Manual Deployment Steps

1. Clone this repository:
```bash
git clone https://github.com/yourusername/whatsapp-web.js.git
cd whatsapp-web.js
```

2. Create a Heroku app:
```bash
heroku login
heroku create your-app-name
```

3. Add buildpacks for Node.js and Puppeteer:
```bash
heroku buildpacks:add --index 1 heroku/nodejs
heroku buildpacks:add --index 2 https://github.com/jontewks/puppeteer-heroku-buildpack
```

4. Add MongoDB for persistent sessions (recommended):
```bash
heroku addons:create mongolab:sandbox
```

5. Set environment variables:
```bash
heroku config:set NODE_ENV=production
heroku config:set HEROKU=true
```

6. Deploy to Heroku:
```bash
git add .
git commit -m "Deploy to Heroku"
git push heroku main
```

7. Scale the dyno:
```bash
heroku ps:scale web=1
```

8. Open the app:
```bash
heroku open
```

## Authentication

Once deployed, you'll need to scan a QR code to authenticate WhatsApp:

1. Open your app URL in a browser
2. Click on "Show QR Code" to display the QR code
3. Scan it with WhatsApp on your phone

## Important Notes

- Heroku's free tier has some limitations:
  - Dynos sleep after 30 minutes of inactivity
  - If you're using the free tier, your bot will disconnect when the dyno sleeps
  - Consider upgrading to a hobby or professional dyno for 24/7 operation
  
- Session Management:
  - If you're using the MongoDB integration, your session will persist between dyno restarts
  - Without MongoDB, you'll need to re-authenticate after each dyno restart

## Troubleshooting

If you encounter issues:

1. Check the logs:
```bash
heroku logs --tail
```

2. Ensure all buildpacks are installed correctly:
```bash
heroku buildpacks
```

3. Verify that MongoDB is connected (if using RemoteAuth):
```bash
heroku config | grep MONGODB_URI
```

4. Restart the dyno if needed:
```bash
heroku restart
```

## License

This project is licensed under the Apache-2.0 License.
