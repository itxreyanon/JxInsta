import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import { connectDb } from '../utils/db.js';
import { config } from '../config.js';
import { logger } from '../utils/utils.js';

export class EnhancedTelegramBridge {
    constructor() {
        this.instagramBot = null;
        this.telegramBot = null;
        this.chatMappings = new Map();
        this.userMappings = new Map();
        this.profilePicCache = new Map();
        this.tempDir = path.join(process.cwd(), 'temp');
        this.db = null;
        this.collection = null;
        this.telegramChatId = null;
        this.creatingTopics = new Map();
        this.topicVerificationCache = new Map();
        this.enabled = false;
        this.filters = new Set();
    }

    async initialize(instagramBotInstance) {
        this.instagramBot = instagramBotInstance;

        const token = config.telegram?.botToken;
        this.telegramChatId = config.telegram?.chatId;

        if (!token || token.includes('YOUR_BOT_TOKEN') || !this.telegramChatId || this.telegramChatId.includes('YOUR_CHAT_ID')) {
            logger.warn('⚠️ Telegram bot token or chat ID not configured');
            return;
        }

        try {
            await this.initializeDatabase();
            await fs.ensureDir(this.tempDir);
            
            this.telegramBot = new TelegramBot(token, {
                polling: true
            });

            await this.setupTelegramHandlers();
            await this.loadMappingsFromDb();
            this.setupInstagramHandlers();

            this.enabled = true;
            logger.info('✅ Enhanced Instagram-Telegram bridge initialized');
        } catch (error) {
            logger.error('❌ Failed to initialize bridge:', error.message);
            this.enabled = false;
        }
    }

    async initializeDatabase() {
        try {
            this.db = await connectDb();
            await this.db.command({ ping: 1 });
            logger.info('✅ MongoDB connection successful for bridge');
            this.collection = this.db.collection('instagram_bridge');
            
            await this.collection.createIndex({ type: 1, 'data.instagramThreadId': 1 }, { unique: true, partialFilterExpression: { type: 'chat' } });
            await this.collection.createIndex({ type: 1, 'data.instagramUserId': 1 }, { unique: true, partialFilterExpression: { type: 'user' } });
            
            logger.info('📊 Database initialized for Instagram bridge');
        } catch (error) {
            logger.error('❌ Failed to initialize database:', error.message);
            throw error;
        }
    }

    async loadMappingsFromDb() {
        if (!this.collection) return;
        
        try {
            const mappings = await this.collection.find({}).toArray();
            for (const mapping of mappings) {
                switch (mapping.type) {
                    case 'chat':
                        this.chatMappings.set(mapping.data.instagramThreadId, mapping.data.telegramTopicId);
                        if (mapping.data.profilePicUrl) {
                            this.profilePicCache.set(mapping.data.instagramThreadId, mapping.data.profilePicUrl);
                        }
                        break;
                    case 'user':
                        this.userMappings.set(mapping.data.instagramUserId, {
                            username: mapping.data.username,
                            fullName: mapping.data.fullName,
                            firstSeen: mapping.data.firstSeen,
                            messageCount: mapping.data.messageCount || 0
                        });
                        break;
                }
            }
            logger.info(`📊 Loaded mappings: ${this.chatMappings.size} chats, ${this.userMappings.size} users`);
        } catch (error) {
            logger.error('❌ Failed to load mappings:', error.message);
        }
    }

    async saveChatMapping(instagramThreadId, telegramTopicId, profilePicUrl = null) {
        if (!this.collection) return;
        
        try {
            const updateData = {
                type: 'chat',
                data: {
                    instagramThreadId,
                    telegramTopicId,
                    createdAt: new Date(),
                    lastActivity: new Date()
                }
            };
            if (profilePicUrl) {
                updateData.data.profilePicUrl = profilePicUrl;
            }
            
            await this.collection.updateOne(
                { type: 'chat', 'data.instagramThreadId': instagramThreadId },
                { $set: updateData },
                { upsert: true }
            );
            
            this.chatMappings.set(instagramThreadId, telegramTopicId);
            if (profilePicUrl) {
                this.profilePicCache.set(instagramThreadId, profilePicUrl);
            }
            
            logger.debug(`✅ Saved chat mapping: ${instagramThreadId} -> ${telegramTopicId}`);
        } catch (error) {
            logger.error('❌ Failed to save chat mapping:', error.message);
        }
    }

    async getOrCreateTopic(instagramThreadId, senderUserId) {
        if (this.chatMappings.has(instagramThreadId)) {
            return this.chatMappings.get(instagramThreadId);
        }

        if (this.creatingTopics.has(instagramThreadId)) {
            return await this.creatingTopics.get(instagramThreadId);
        }

        const creationPromise = (async () => {
            try {
                let topicName = `Instagram Chat ${instagramThreadId.substring(0, 10)}...`;
                const userInfo = this.userMappings.get(senderUserId?.toString());
                
                if (userInfo) {
                    topicName = `@${userInfo.username || userInfo.fullName || senderUserId}`;
                } else if (senderUserId) {
                    topicName = `User ${senderUserId}`;
                }

                const topic = await this.telegramBot.createForumTopic(this.telegramChatId, topicName, {
                    icon_color: 0x7ABA3C
                });

                await this.saveChatMapping(instagramThreadId, topic.message_thread_id);
                logger.info(`🆕 Created topic: "${topicName}" (ID: ${topic.message_thread_id})`);

                if (config.telegram?.features?.welcomeMessage !== false) {
                    await this.sendWelcomeMessage(topic.message_thread_id, instagramThreadId, senderUserId);
                }

                return topic.message_thread_id;
            } catch (error) {
                logger.error('❌ Failed to create topic:', error.message);
                return null;
            } finally {
                this.creatingTopics.delete(instagramThreadId);
            }
        })();

        this.creatingTopics.set(instagramThreadId, creationPromise);
        return await creationPromise;
    }

    async sendWelcomeMessage(topicId, instagramThreadId, senderUserId) {
        try {
            const welcomeText = `👤 *Instagram Contact Information*
🆔 *Thread ID:* ${instagramThreadId}
👤 *User ID:* ${senderUserId || 'Unknown'}
📅 *First Contact:* ${new Date().toLocaleDateString()}
💬 Messages from this user will appear here`;

            const sentMessage = await this.telegramBot.sendMessage(this.telegramChatId, welcomeText, {
                message_thread_id: topicId,
                parse_mode: 'Markdown'
            });
            
            await this.telegramBot.pinChatMessage(this.telegramChatId, sentMessage.message_id);
            logger.info(`🎉 Welcome message sent for thread ${instagramThreadId}`);
        } catch (error) {
            logger.error(`❌ Failed to send welcome message:`, error.message);
        }
    }

    async sendToTelegram(message) {
        if (!this.telegramBot || !this.enabled) return;

        try {
            const topicId = await this.getOrCreateTopic(message.threadId, message.senderId);
            if (!topicId) {
                logger.error(`❌ Could not get/create topic for thread ${message.threadId}`);
                return;
            }

            if (message.type === 'text') {
                await this.sendSimpleMessage(topicId, message.text, message.threadId);
            } else if (['media', 'photo', 'video'].includes(message.type)) {
                await this.handleInstagramMedia(message, topicId);
            } else {
                const fallbackText = `[${message.type.toUpperCase()}] ${message.text || 'Unsupported message type'}`;
                await this.sendSimpleMessage(topicId, fallbackText, message.threadId);
            }

        } catch (error) {
            logger.error('❌ Error forwarding to Telegram:', error.message);
        }
    }

    async sendSimpleMessage(topicId, text, instagramThreadId) {
        try {
            const sentMessage = await this.telegramBot.sendMessage(this.telegramChatId, text, {
                message_thread_id: topicId
            });
            return sentMessage.message_id;
        } catch (error) {
            logger.error('❌ Failed to send message to Telegram:', error.message);
            return null;
        }
    }

    async handleInstagramMedia(message, topicId) {
        try {
            // For now, send media URL or description
            const mediaText = `📎 Media received: ${message.raw?.message || 'Instagram media'}`;
            await this.sendSimpleMessage(topicId, mediaText, message.threadId);
        } catch (error) {
            logger.error('❌ Error handling Instagram media:', error.message);
        }
    }

    setupInstagramHandlers() {
        // Instagram message handler is set up in the main bot
        logger.info('📱 Instagram handlers ready for bridge');
    }

    async setupTelegramHandlers() {
        if (!this.telegramBot) return;

        this.telegramBot.on('message', async (msg) => {
            try {
                if (
                    (msg.chat.type === 'supergroup' || msg.chat.type === 'group') &&
                    msg.is_topic_message &&
                    msg.message_thread_id
                ) {
                    await this.handleTelegramMessage(msg);
                }
            } catch (error) {
                logger.error('❌ Error in Telegram handler:', error.message);
            }
        });

        this.telegramBot.on('polling_error', (error) => {
            logger.error('Telegram polling error:', error.message);
        });

        logger.info('📱 Telegram handlers set up');
    }

    async handleTelegramMessage(msg) {
        try {
            const topicId = msg.message_thread_id;
            const instagramThreadId = this.findInstagramThreadIdByTopic(topicId);

            if (!instagramThreadId) {
                logger.warn('⚠️ Could not find Instagram thread for Telegram message');
                await this.setReaction(msg.chat.id, msg.message_id, '❓');
                return;
            }

            if (msg.text) {
                await this.handleTelegramText(msg, instagramThreadId);
            } else if (msg.photo) {
                await this.handleTelegramMedia(msg, 'photo', instagramThreadId);
            } else if (msg.video) {
                await this.handleTelegramMedia(msg, 'video', instagramThreadId);
            } else if (msg.voice) {
                await this.handleTelegramVoice(msg, instagramThreadId);
            } else if (msg.document) {
                await this.handleTelegramMedia(msg, 'document', instagramThreadId);
            } else {
                logger.warn(`⚠️ Unsupported Telegram media type in topic ${topicId}`);
                await this.setReaction(msg.chat.id, msg.message_id, '❌');
            }

        } catch (error) {
            logger.error('❌ Failed to handle Telegram message:', error.message);
            await this.setReaction(msg.chat.id, msg.message_id, '❌');
        }
    }

    async handleTelegramText(msg, instagramThreadId) {
        try {
            const text = msg.text.trim();
            await this.instagramBot.sendMessage(instagramThreadId, text);
            await this.setReaction(msg.chat.id, msg.message_id, '👍');
            logger.info(`✅ Text sent to Instagram: "${text}"`);
        } catch (error) {
            logger.error('❌ Failed to send text to Instagram:', error.message);
            await this.setReaction(msg.chat.id, msg.message_id, '❌');
        }
    }

    async handleTelegramVoice(msg, instagramThreadId) {
        try {
            await this.setReaction(msg.chat.id, msg.message_id, '🔄');

            // Download voice message
            const fileId = msg.voice.file_id;
            const fileLink = await this.telegramBot.getFileLink(fileId);
            const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
            
            // Save original voice file
            const originalPath = path.join(this.tempDir, `voice_${Date.now()}.ogg`);
            await fs.writeFile(originalPath, Buffer.from(response.data));

            // Convert OGG to M4A for Instagram compatibility
            const convertedPath = path.join(this.tempDir, `voice_${Date.now()}.m4a`);
            
            await new Promise((resolve, reject) => {
                ffmpeg(originalPath)
                    .toFormat('mp4')
                    .audioCodec('aac')
                    .audioBitrate(128)
                    .audioChannels(1)
                    .audioFrequency(44100)
                    .on('end', resolve)
                    .on('error', reject)
                    .save(convertedPath);
            });

            // Send voice message to Instagram
            await this.instagramBot.sendVoiceMessage(instagramThreadId, convertedPath);
            await this.setReaction(msg.chat.id, msg.message_id, '👍');
            
            logger.info(`🎤 Voice message sent to Instagram thread ${instagramThreadId}`);

            // Clean up temp files
            try {
                await fs.unlink(originalPath);
                await fs.unlink(convertedPath);
            } catch (cleanupError) {
                logger.debug('Could not clean up temp files:', cleanupError.message);
            }

        } catch (error) {
            logger.error('❌ Failed to send voice message to Instagram:', error.message);
            await this.setReaction(msg.chat.id, msg.message_id, '❌');
        }
    }

    async handleTelegramMedia(msg, mediaType, instagramThreadId) {
        try {
            await this.setReaction(msg.chat.id, msg.message_id, '🔄');

            let fileId, fileName;
            switch (mediaType) {
                case 'photo':
                    fileId = msg.photo[msg.photo.length - 1].file_id;
                    fileName = `photo_${Date.now()}.jpg`;
                    break;
                case 'video':
                    fileId = msg.video.file_id;
                    fileName = `video_${Date.now()}.mp4`;
                    break;
                case 'document':
                    fileId = msg.document.file_id;
                    fileName = msg.document.file_name || `document_${Date.now()}`;
                    break;
                default:
                    throw new Error(`Unsupported media type: ${mediaType}`);
            }

            // Download media
            const fileLink = await this.telegramBot.getFileLink(fileId);
            const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
            const filePath = path.join(this.tempDir, fileName);
            await fs.writeFile(filePath, Buffer.from(response.data));

            // Send to Instagram
            if (mediaType === 'photo') {
                await this.instagramBot.sendPhoto(instagramThreadId, filePath, msg.caption || '');
            } else {
                // For other media types, send as text with description
                const mediaInfo = `📎 ${mediaType}: ${fileName}${msg.caption ? `\n${msg.caption}` : ''}`;
                await this.instagramBot.sendMessage(instagramThreadId, mediaInfo);
            }

            await this.setReaction(msg.chat.id, msg.message_id, '👍');
            logger.info(`✅ ${mediaType} sent to Instagram thread ${instagramThreadId}`);

            // Clean up
            try {
                await fs.unlink(filePath);
            } catch (cleanupError) {
                logger.debug('Could not clean up temp file:', cleanupError.message);
            }

        } catch (error) {
            logger.error(`❌ Failed to send ${mediaType} to Instagram:`, error.message);
            await this.setReaction(msg.chat.id, msg.message_id, '❌');
        }
    }

    async setReaction(chatId, messageId, emoji) {
        try {
            const token = config.telegram?.botToken;
            if (!token) return;
            
            await axios.post(`https://api.telegram.org/bot${token}/setMessageReaction`, {
                chat_id: chatId,
                message_id: messageId,
                reaction: [{ type: 'emoji', emoji: emoji }]
            });
        } catch (err) {
            logger.debug('Failed to set reaction:', err?.response?.data?.description || err.message);
        }
    }

    findInstagramThreadIdByTopic(topicId) {
        for (const [threadId, topic] of this.chatMappings.entries()) {
            if (topic === topicId) {
                return threadId;
            }
        }
        return null;
    }

    async shutdown() {
        logger.info('🛑 Shutting down Instagram-Telegram bridge...');
        if (this.telegramBot) {
            try {
                await this.telegramBot.stopPolling();
            } catch (error) {
                logger.debug('Error stopping Telegram polling:', error.message);
            }
        }
        try {
            await fs.emptyDir(this.tempDir);
        } catch (error) {
            logger.debug('Could not clean temp directory:', error.message);
        }
        logger.info('✅ Bridge shutdown complete');
    }
}