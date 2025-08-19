# Enhanced Instagram-Telegram Bot

An improved Instagram-Telegram bridge bot that uses the JxInsta library for better stability and media handling, especially voice messages.

## Features

### ✅ What's Fixed/Enhanced:
- **Better Authentication**: Uses JxInsta library with mobile authentication for better stability
- **Voice Message Support**: Properly converts and sends voice messages from Telegram to Instagram
- **Media Handling**: Improved photo and video handling with proper format conversion
- **Session Management**: Automatic session saving and recovery to prevent frequent logins
- **Error Recovery**: Automatic re-authentication when sessions expire
- **Polling-based**: Uses polling instead of realtime to avoid connection issues

### 🎯 Key Improvements Over Old Bot:
1. **No More Challenge Issues**: Uses proper mobile API authentication
2. **Voice Messages Work**: Converts OGG to M4A format for Instagram compatibility
3. **Better Media Support**: Handles photos, videos, and documents properly
4. **Stable Connection**: Polling-based approach is more reliable than realtime
5. **Auto-Recovery**: Automatically handles authentication errors and re-logins

## Installation

1. **Install Dependencies**:
```bash
cd enhanced-bot
npm install
```

2. **Install FFmpeg** (required for voice message conversion):
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

3. **Configure** your `config.js`:
```javascript
export const config = {
  instagram: {
    username: 'your_instagram_username',
    password: 'your_instagram_password'
  },
  telegram: {
    botToken: 'your_telegram_bot_token',
    chatId: 'your_supergroup_chat_id',
    features: {
      welcomeMessage: true,
      profilePicSync: true
    }
  },
  admin: {
    users: ['your_telegram_username']
  }
};
```

## Usage

1. **Start the bot**:
```bash
npm start
```

2. **Send messages**:
   - Text messages work bidirectionally
   - Send voice messages from Telegram → they'll be converted and sent to Instagram
   - Send photos from Telegram → they'll be sent to Instagram
   - Instagram messages appear in Telegram forum topics

## Voice Message Flow

1. **Telegram → Instagram**:
   - User sends voice message in Telegram
   - Bot downloads the OGG file
   - Converts OGG to M4A using FFmpeg
   - Sends M4A to Instagram as audio message
   - Cleans up temporary files

2. **Format Support**:
   - Input: OGG (Telegram voice messages)
   - Output: M4A (Instagram compatible)
   - Conversion: AAC codec, 128kbps, mono, 44.1kHz

## File Structure

```
enhanced-bot/
├── InstagramBot.js      # Main Instagram bot using JxInsta
├── TelegramBridge.js    # Enhanced Telegram bridge
├── main.js             # Application entry point
├── package.json        # Dependencies
└── README.md          # This file
```

## Key Differences from Old Bot

| Feature | Old Bot | Enhanced Bot |
|---------|---------|--------------|
| Instagram API | instagram-private-api + MQTT | JxInsta library |
| Authentication | Web-based (unstable) | Mobile API (stable) |
| Voice Messages | ❌ Not working | ✅ Full support with conversion |
| Connection | Realtime (fragile) | Polling (reliable) |
| Session Management | Basic | Advanced with auto-recovery |
| Media Handling | Limited | Full support with conversion |
| Error Recovery | Manual | Automatic |

## Troubleshooting

### Voice Messages Not Working:
1. Ensure FFmpeg is installed: `ffmpeg -version`
2. Check temp directory permissions
3. Verify Instagram authentication is working

### Authentication Issues:
1. Check Instagram credentials in config
2. Delete `instagram-session.json` to force re-login
3. Ensure account doesn't have 2FA enabled

### Telegram Issues:
1. Verify bot token and chat ID
2. Ensure bot is admin in the supergroup
3. Check forum topics are enabled

## Dependencies

- **node-telegram-bot-api**: Telegram bot interface
- **fs-extra**: Enhanced file system operations
- **axios**: HTTP requests
- **fluent-ffmpeg**: Audio/video conversion
- **mongodb**: Database for mappings
- **JxInsta**: Instagram API library (local)

## License

MIT License - Feel free to modify and use as needed.