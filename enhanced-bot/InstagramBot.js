import { JxInsta } from '../JxInsta/src/main/java/com/errorxcode/jxinsta/JxInsta.js';
import { DirectMessaging } from '../JxInsta/src/main/java/com/errorxcode/jxinsta/endpoints/direct/DirectMessaging.js';
import { promises as fs } from 'fs';
import { logger } from '../utils/utils.js';
import { config } from '../config.js';

export class EnhancedInstagramBot {
    constructor() {
        this.jxInsta = null;
        this.directMessaging = null;
        this.isRunning = false;
        this.messageHandlers = [];
        this.processedMessageIds = new Set();
        this.maxProcessedMessageIds = 1000;
        this.pollingInterval = null;
        this.lastMessageCheck = Date.now();
    }

    log(level, message, ...args) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level}] ${message}`, ...args);
    }

    async login() {
        try {
            const username = config.instagram?.username;
            const password = config.instagram?.password;

            if (!username || !password) {
                throw new Error('❌ Instagram credentials not configured');
            }

            // Try to login with session first, then fallback to credentials
            let loginSuccess = false;

            try {
                // Check if we have saved session
                const sessionData = await fs.readFile('./instagram-session.json', 'utf-8');
                const { cookie, token } = JSON.parse(sessionData);
                
                if (cookie || token) {
                    this.jxInsta = new JxInsta(cookie, token);
                    this.log('INFO', '✅ Logged in using saved session');
                    loginSuccess = true;
                }
            } catch (sessionError) {
                this.log('INFO', '📂 No valid session found, logging in with credentials...');
            }

            if (!loginSuccess) {
                // Login with credentials using mobile authentication for better media support
                this.jxInsta = new JxInsta(username, password, JxInsta.LoginType.APP_AUTHENTICATION);
                
                // Save session for future use
                const sessionData = {
                    cookie: this.jxInsta.cookie,
                    token: this.jxInsta.token,
                    timestamp: Date.now()
                };
                await fs.writeFile('./instagram-session.json', JSON.stringify(sessionData, null, 2));
                this.log('INFO', '✅ Logged in with credentials and saved session');
            }

            // Initialize direct messaging
            this.directMessaging = this.jxInsta.directMessaging();
            this.isRunning = true;
            
            // Start polling for messages
            this.startMessagePolling();
            
            this.log('INFO', '🚀 Enhanced Instagram bot is now running');

        } catch (error) {
            this.log('ERROR', '❌ Failed to login:', error.message);
            throw error;
        }
    }

    startMessagePolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }

        this.pollingInterval = setInterval(async () => {
            if (!this.isRunning) return;

            try {
                await this.checkForNewMessages();
            } catch (error) {
                this.log('ERROR', '❌ Error polling messages:', error.message);
                
                // If we get authentication errors, try to re-login
                if (error.message.includes('login') || error.message.includes('authentication')) {
                    this.log('WARN', '🔄 Authentication issue detected, attempting re-login...');
                    await this.handleAuthenticationError();
                }
            }
        }, 5000); // Poll every 5 seconds
    }

    async checkForNewMessages() {
        try {
            const threads = await this.directMessaging.listThreads(20, 0); // Get 20 threads from primary folder
            
            for (const thread of threads) {
                if (thread.messages && thread.messages.length > 0) {
                    for (const message of thread.messages) {
                        if (this.isNewMessage(message)) {
                            await this.handleMessage(message, thread);
                        }
                    }
                }
            }
        } catch (error) {
            throw error; // Re-throw to be handled by polling interval
        }
    }

    isNewMessage(message) {
        if (!message.id) return false;
        
        // Check if message is newer than our last check
        if (message.timestamp <= this.lastMessageCheck) return false;
        
        if (this.processedMessageIds.has(message.id)) return false;

        this.processedMessageIds.add(message.id);
        this.lastMessageCheck = Math.max(this.lastMessageCheck, message.timestamp);

        // Prevent memory leak
        if (this.processedMessageIds.size > this.maxProcessedMessageIds) {
            const first = this.processedMessageIds.values().next().value;
            this.processedMessageIds.delete(first);
        }

        return true;
    }

    async handleMessage(message, thread) {
        try {
            const processedMessage = {
                id: message.id,
                text: message.message || '',
                senderId: message.sender,
                senderUsername: thread.username || `user_${message.sender}`,
                timestamp: new Date(message.timestamp),
                threadId: thread.threadId,
                threadTitle: thread.username || 'Direct Message',
                type: this.getMessageType(message),
                raw: message
            };

            this.log('INFO', `💬 [${processedMessage.threadTitle}] New message from @${processedMessage.senderUsername}: "${processedMessage.text}"`);

            // Execute registered message handlers
            for (const handler of this.messageHandlers) {
                try {
                    await handler(processedMessage);
                } catch (handlerError) {
                    this.log('ERROR', `❌ Error in message handler:`, handlerError.message);
                }
            }

        } catch (error) {
            this.log('ERROR', '❌ Error handling message:', error.message);
        }
    }

    getMessageType(message) {
        if (message.itemType) {
            switch (message.itemType) {
                case 'TEXT': return 'text';
                case 'MEDIA': return 'media';
                case 'LINK': return 'link';
                case 'LOCATION': return 'location';
                case 'ACTION_LOG': return 'action';
                case 'PROFILE': return 'profile';
                default: return 'unknown';
            }
        }
        return message.message ? 'text' : 'unknown';
    }

    onMessage(handler) {
        if (typeof handler === 'function') {
            this.messageHandlers.push(handler);
            this.log('INFO', `📝 Added message handler (total: ${this.messageHandlers.length})`);
        }
    }

    async sendMessage(threadId, text) {
        if (!threadId || !text) {
            throw new Error('Thread ID and text are required');
        }

        try {
            const thread = this.directMessaging.getThread(threadId);
            const messageId = await thread.sendMessage(text, false);
            this.log('INFO', `📤 Message sent successfully to thread ${threadId}: "${text}"`);
            return messageId;
        } catch (error) {
            this.log('ERROR', `❌ Error sending message to thread ${threadId}:`, error.message);
            throw error;
        }
    }

    async sendPhoto(threadId, photoPath, caption = '') {
        try {
            const thread = this.directMessaging.getThread(threadId);
            const photoFile = new (await import('fs')).createReadStream(photoPath);
            await thread.sendPhoto(photoFile);
            
            if (caption) {
                await thread.sendMessage(caption, false);
            }
            
            this.log('INFO', `📸 Photo sent successfully to thread ${threadId}`);
            return true;
        } catch (error) {
            this.log('ERROR', `❌ Error sending photo to thread ${threadId}:`, error.message);
            throw error;
        }
    }

    async sendVoiceMessage(threadId, voicePath) {
        try {
            // For voice messages, we'll convert them to a format Instagram accepts
            // Instagram typically accepts voice messages as audio files
            const thread = this.directMessaging.getThread(threadId);
            
            // Read the voice file
            const voiceBuffer = await fs.readFile(voicePath);
            
            // Create a temporary file with proper extension
            const tempPath = `./temp/voice_${Date.now()}.m4a`;
            await fs.writeFile(tempPath, voiceBuffer);
            
            try {
                // Send as audio/media file
                const audioFile = new (await import('fs')).createReadStream(tempPath);
                await thread.sendPhoto(audioFile); // Instagram treats audio as media
                
                this.log('INFO', `🎤 Voice message sent successfully to thread ${threadId}`);
                return true;
            } finally {
                // Clean up temp file
                try {
                    await fs.unlink(tempPath);
                } catch (cleanupError) {
                    this.log('WARN', '⚠️ Could not clean up temp voice file:', cleanupError.message);
                }
            }
        } catch (error) {
            this.log('ERROR', `❌ Error sending voice message to thread ${threadId}:`, error.message);
            throw error;
        }
    }

    async handleAuthenticationError() {
        try {
            this.isRunning = false;
            
            // Clear old session
            try {
                await fs.unlink('./instagram-session.json');
            } catch (e) {
                // Ignore if file doesn't exist
            }

            // Re-login with credentials
            const username = config.instagram?.username;
            const password = config.instagram?.password;
            
            if (username && password) {
                this.jxInsta = new JxInsta(username, password, JxInsta.LoginType.APP_AUTHENTICATION);
                this.directMessaging = this.jxInsta.directMessaging();
                
                // Save new session
                const sessionData = {
                    cookie: this.jxInsta.cookie,
                    token: this.jxInsta.token,
                    timestamp: Date.now()
                };
                await fs.writeFile('./instagram-session.json', JSON.stringify(sessionData, null, 2));
                
                this.isRunning = true;
                this.log('INFO', '✅ Successfully re-authenticated');
            } else {
                throw new Error('No credentials available for re-authentication');
            }
        } catch (error) {
            this.log('ERROR', '❌ Failed to re-authenticate:', error.message);
            throw error;
        }
    }

    async disconnect() {
        this.log('INFO', '🔌 Disconnecting Instagram bot...');
        this.isRunning = false;
        
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        
        this.log('INFO', '✅ Instagram bot disconnected');
    }
}