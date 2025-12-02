async function startCombinedWorker() {
  const errors = [];
  
  console.log('🚀 Starting combined worker...');
  
  // Start Telegram user client FIRST (for monitoring groups)
  try {
    if (process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH) {
      const { TelegramClient, Button } = require("telegram");
      const { StringSession } = require("telegram/sessions");
      const { NewMessage } = require("telegram/events");

      const apiId = parseInt(process.env.TELEGRAM_API_ID);
      const apiHash = process.env.TELEGRAM_API_HASH;
      let sessionString = process.env.TELEGRAM_SESSION || process.env.TELEGRAM_SESSION_STRING || "";

      if (sessionString && sessionString.length > 0) {
        const isValidSession = /^[A-Za-z0-9+/=]+$/.test(sessionString) && sessionString.length > 100;
        if (!isValidSession) {
          console.log('⚠️  Invalid session string detected, telegram client skipped');
          sessionString = "";
        }
      }

      if (!sessionString || sessionString.length < 100) {
        console.warn('⚠️  No valid TELEGRAM_SESSION found - telegram client skipped');
        console.warn('   Run "node login.js" to generate a session string');
        errors.push('TELEGRAM_SESSION missing or invalid');
      } else {
        const SOURCE_GROUPS = [
          'rainbetcodetest',
          'Rainbet_Bonus'
        ];
        const TARGET_CHANNEL = '@rainbetbonusdrops';

        console.log('📱 Starting Telegram User Client...');
        console.log('   Source groups:', SOURCE_GROUPS);
        console.log('   Target channel:', TARGET_CHANNEL);

        const stringSession = new StringSession(sessionString);
        const client = new TelegramClient(stringSession, apiId, apiHash, {
          connectionRetries: 5,
        });

        await client.connect();
        console.log('✅ Telegram client connected successfully');

        const targetChannel = await client.getEntity(TARGET_CHANNEL);
        console.log(`   Found target channel: ${targetChannel.title || TARGET_CHANNEL}`);

        const sourceEntities = [];
        for (const groupUsername of SOURCE_GROUPS) {
          try {
            const entity = await client.getEntity(groupUsername);
            sourceEntities.push(entity);
            console.log(`   ✓ Found group: ${entity.title || groupUsername}`);
          } catch (error) {
            console.error(`   ✗ Could not find group: ${groupUsername}`);
          }
        }

        if (sourceEntities.length === 0) {
          throw new Error('No source groups found! Make sure you are a member of at least one source group');
        }

        console.log(`✅ Monitoring ${sourceEntities.length} groups, forwarding to ${TARGET_CHANNEL}`);

        client.addEventHandler(async (event) => {
          try {
            const message = event.message;
            const chat = await event.message.getChat();
            
            const isSourceGroup = sourceEntities.some(entity => entity.id.toString() === chat.id.toString());
            
            if (isSourceGroup) {
              const groupName = chat.title || chat.username || 'Unknown';
              const messageText = message.message || '';
              
              // Only forward messages that contain Bonus Drop pattern with a code
              const isBonusDrop = messageText.includes('Bonus Drop') && messageText.includes('Code:');
              
              if (!isBonusDrop) {
                return; // Skip non-bonus messages
              }
              
              console.log(`🎁 Bonus Drop detected in ${groupName}`);
              
              // Parse bonus drop details from message
              const codeMatch = messageText.match(/Code:\s*([A-Za-z0-9]+)/i);
              const rewardMatch = messageText.match(/Reward:\s*\$?([\d,.]+)/i);
              const claimsMatch = messageText.match(/Claims:\s*([\d,]+)/i);
              const wageredMatch = messageText.match(/Wagered:\s*\$?([\d,]+)/i);
              const timelineMatch = messageText.match(/past\s+(\d+\s*\w+)/i);
              
              const codeData = {
                code: codeMatch ? codeMatch[1].toUpperCase() : null,
                value: rewardMatch ? rewardMatch[1] : null,
                limit: claimsMatch ? claimsMatch[1].replace(/,/g, '') : null,
                wagerRequirement: wageredMatch ? wageredMatch[1].replace(/,/g, '') : null,
                timeline: timelineMatch ? timelineMatch[1] : null,
                source: groupName
              };
              
              console.log(`   Code: ${codeData.code}, Value: $${codeData.value}, Limit: ${codeData.limit}, Wager: $${codeData.wagerRequirement}, Timeline: ${codeData.timeline}`);
              
              try {
                // Send original message first
                const sendOptions = {
                  message: messageText,
                };
                
                if (message.media) {
                  sendOptions.file = message.media;
                }
                
                await client.sendMessage(targetChannel, sendOptions);
                console.log(`   ✓ Forwarded bonus drop to ${TARGET_CHANNEL}`);
                
                // Send promotional message separately
                await client.sendMessage(targetChannel, {
                  message: '🤖 **Want codes claimed automatically?**\n└ Get the bot here: @RainbetSubscriptionBot'
                });
                console.log(`   ✓ Sent bot promo`);
                
                // Send parsed code data to API
                if (codeData.code) {
                  try {
                    const fetch = (await import('node-fetch')).default;
                    await fetch('http://localhost:5000/api/codes', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(codeData)
                    });
                    console.log(`   ✓ Code ${codeData.code} sent to API`);
                  } catch (apiErr) {
                    console.log(`   ⚠️ API error: ${apiErr.message}`);
                  }
                }
              } catch (error) {
                console.error(`✗ Failed to send: ${error.message}`);
              }
            }
          } catch (error) {
            console.error('Error handling message:', error.message);
          }
        }, new NewMessage({}));

        console.log('✅ Telegram client is running and listening for messages');
      }
    } else {
      console.warn('⚠️  TELEGRAM_API_ID or TELEGRAM_API_HASH not set - telegram client skipped');
      errors.push('TELEGRAM_API_ID or TELEGRAM_API_HASH missing');
    }
  } catch (error) {
    console.error('❌ Failed to start telegram client:', error.message);
    errors.push(`Telegram client error: ${error.message}`);
  }

  // Start subscription bot (for DM commands) - runs in background
  try {
    if (process.env.SUBSCRIPTION_BOT_TOKEN) {
      console.log('📱 Starting subscription bot...');
      const { bot } = require('./subscription-bot-v2.js');
      bot.launch().then(() => {
        console.log('✅ Subscription bot started successfully');
      }).catch(err => {
        console.error('❌ Subscription bot error:', err.message);
      });
      
      process.once('SIGINT', () => bot.stop('SIGINT'));
      process.once('SIGTERM', () => bot.stop('SIGTERM'));
    } else {
      console.warn('⚠️  SUBSCRIPTION_BOT_TOKEN not set - subscription bot skipped');
      errors.push('SUBSCRIPTION_BOT_TOKEN missing');
    }
  } catch (error) {
    console.error('❌ Failed to start subscription bot:', error.message);
    errors.push(`Subscription bot error: ${error.message}`);
  }

  console.log('\n' + '='.repeat(60));
  if (errors.length === 0) {
    console.log('✅ Combined worker started successfully - all services running');
  } else if (errors.length === 2) {
    console.log('❌ Combined worker failed - no services started');
    console.log('   Errors:', errors.join(', '));
    process.exit(1);
  } else {
    console.log('⚠️  Combined worker started with warnings - some services skipped');
    console.log('   Issues:', errors.join(', '));
  }
  console.log('='.repeat(60) + '\n');
  
  console.log('🚀 Worker is running. Press Ctrl+C to stop.');
}

startCombinedWorker().catch((error) => {
  console.error('💥 Fatal error starting combined worker:', error);
  process.exit(1);
});
