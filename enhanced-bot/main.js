import { EnhancedInstagramBot } from './InstagramBot.js';
import { EnhancedTelegramBridge } from './TelegramBridge.js';
import { config } from '../config.js';
import { logger } from '../utils/utils.js';

async function main() {
    let instagramBot;
    let telegramBridge;

    try {
        // Initialize Instagram bot
        instagramBot = new EnhancedInstagramBot();
        await instagramBot.login();

        // Initialize Telegram bridge
        telegramBridge = new EnhancedTelegramBridge();
        await telegramBridge.initialize(instagramBot);

        // Set up message forwarding from Instagram to Telegram
        instagramBot.onMessage(async (message) => {
            try {
                if (telegramBridge.enabled) {
                    await telegramBridge.sendToTelegram(message);
                }
            } catch (error) {
                logger.error('Error forwarding message to Telegram:', error.message);
            }
        });

        logger.info('🚀 Enhanced Instagram-Telegram bot is running');
        logger.info('📱 Features enabled:');
        logger.info('  ✅ Text messages (bidirectional)');
        logger.info('  ✅ Voice messages (Telegram → Instagram)');
        logger.info('  ✅ Photos (Telegram → Instagram)');
        logger.info('  ✅ Media handling with proper conversion');
        logger.info('  ✅ Session management and auto-recovery');

        // Heartbeat
        setInterval(() => {
            logger.info(`💓 Bot heartbeat - Instagram: ${instagramBot.isRunning}, Telegram: ${telegramBridge.enabled}`);
        }, 300000); // Every 5 minutes

        // Graceful shutdown
        const shutdownHandler = async () => {
            logger.info('\n👋 Shutting down gracefully...');
            if (instagramBot) {
                await instagramBot.disconnect();
            }
            if (telegramBridge) {
                await telegramBridge.shutdown();
            }
            logger.info('🛑 Shutdown complete');
            process.exit(0);
        };

        process.on('SIGINT', shutdownHandler);
        process.on('SIGTERM', shutdownHandler);

    } catch (error) {
        logger.error('❌ Bot failed to start:', error.message);
        
        // Cleanup on failure
        if (instagramBot) {
            try {
                await instagramBot.disconnect();
            } catch (e) {
                logger.error('Error during cleanup:', e.message);
            }
        }
        if (telegramBridge) {
            try {
                await telegramBridge.shutdown();
            } catch (e) {
                logger.error('Error during cleanup:', e.message);
            }
        }
        
        process.exit(1);
    }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        logger.error('❌ Unhandled error in main:', error.message);
        process.exit(1);
    });
}

export { main };