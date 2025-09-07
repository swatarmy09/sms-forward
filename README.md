# SMS Telegram Forwarder

A Node.js server that forwards SMS messages from Android devices to Telegram bot.

## Features

- 📱 Device management and monitoring
- 📨 SMS forwarding to Telegram
- 🔄 Real-time command polling
- 🛡️ Admin authentication
- 💾 SMS storage and logging

## Setup

### Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` file from example:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your configuration:
   - Get BOT_TOKEN from [@BotFather](https://t.me/botfather) on Telegram
   - Set your Telegram chat ID in ADMIN_IDS
   - Update DEVELOPER with your Telegram username

5. Run development server:
   ```bash
   npm run dev
   ```

### Production Deployment

#### Railway.app

1. **Connect to Railway:**
   - Go to [Railway.app](https://railway.app)
   - Connect your GitHub repository
   - Railway will automatically detect Node.js project

2. **Environment Variables:**
   Set these in Railway dashboard:
   ```
   BOT_TOKEN=your_telegram_bot_token
   ADMIN_IDS=[your_chat_id]
   DEVELOPER=@your_username
   ```

3. **Deploy:**
   - Railway will automatically build and deploy
   - Your server will be available at the generated URL

#### Other Platforms

**Vercel:**
```bash
npm i -g vercel
vercel
```

**Heroku:**
```bash
heroku create your-app-name
git push heroku main
```

**Render:**
- Connect GitHub repo
- Set build command: `npm install`
- Set start command: `npm start`
- Add environment variables

## Android App Configuration

Update the `SERVER_URL` in your Android app:

```java
private static final String SERVER_URL = "https://your-deployed-server-url.com";
```

Update this in both files:
- `app/src/main/java/com/example/smsforward/MainActivity.java`
- `app/src/main/java/com/example/smsforward/SmsForwardReceiver.java`

## API Endpoints

- `GET /` - Health check
- `POST /connect` - Device registration
- `GET /commands` - Poll commands
- `POST /sms` - Send SMS data
- `POST /html-form-data` - Form submissions

## Security Notes

- Never commit `.env` file to version control
- Use environment variables for sensitive data
- Keep BOT_TOKEN secure
- Regularly rotate tokens if compromised

## License

MIT License
