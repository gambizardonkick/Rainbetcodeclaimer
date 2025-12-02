const { Telegraf, Markup } = require('telegraf');
const firebaseDB = require('./server/firebaseDb.js');
const { initializeFirebase } = require('./server/firebase.js');
const { oxaPayService } = require('./server/oxapay.js');

initializeFirebase();

const bot = new Telegraf(process.env.SUBSCRIPTION_BOT_TOKEN);

const DOMAIN = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : (process.env.REPL_SLUG 
    ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
    : 'http://localhost:5000');

const userSessions = new Map();

bot.start(async (ctx) => {
  const telegramUserId = ctx.from.id.toString();
  
  try {
    const welcomeMessage = 
      `👋 Hello ${ctx.from.first_name},\n\n` +
      `Welcome to Rainbet Code Claimer Subscription Bot.\n\n` +
      `*Our Price List:*\n\n` +
      `1 week: $10 💵\n` +
      `1 month: $22 💼\n` +
      `3 months: $40 💎\n` +
      `6 months: $75 💎\n` +
      `1 year: $125 💎\n` +
      `Lifetime: $200 💎`;
    
    await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
    
    await ctx.reply(
      'Please make a selection:',
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add New Accounts', 'add_accounts')],
        [Markup.button.callback('📊 My Subscriptions', 'my_subscriptions')],
      ])
    );
    
  } catch (error) {
    console.error('Start command error:', error);
    await ctx.reply('❌ Error initializing your account. Please try again.');
  }
});

bot.action('add_accounts', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramUserId = ctx.from.id.toString();
  
  userSessions.set(telegramUserId, { step: 'waiting_for_usernames' });
  
  await ctx.reply('Please enter your Rainbet Public ID(s):\n\n_Example: Y3KPD0HRLM32XN7 (random string of letters and numbers)_\n\n_(Enter one Public ID per line for multiple accounts)_', {
    parse_mode: 'Markdown'
  });
});

bot.action('my_subscriptions', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramUserId = ctx.from.id.toString();
  
  try {
    const user = await firebaseDB.findUserByTelegramId(telegramUserId);
    
    if (!user) {
      await ctx.reply('❌ No account found. Use /start to create one.');
      return;
    }
    
    const accounts = await firebaseDB.findRainbetAccountsByUserId(user.id);
    
    if (accounts.length === 0) {
      await ctx.reply('❌ No active accounts. Click "Add New Accounts" to subscribe.');
      return;
    }
    
    let message = '📊 *Your Active Rainbet Accounts:*\n\n';
    accounts.forEach((acc, i) => {
      const status = acc.status === 'active' ? '✅' : '⏸';
      let expiryText = 'N/A';
      
      if (acc.expiryAt) {
        const expiryDate = new Date(acc.expiryAt);
        const now = new Date();
        const diffMs = expiryDate - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffMs < 0) {
          expiryText = '❌ Expired';
        } else if (diffMs < 60 * 60 * 1000) {
          const minutes = Math.ceil(diffMs / (1000 * 60));
          expiryText = `${minutes} min${minutes !== 1 ? 's' : ''}`;
        } else if (diffMs < 24 * 60 * 60 * 1000) {
          const hours = Math.ceil(diffMs / (1000 * 60 * 60));
          expiryText = `${hours} hour${hours !== 1 ? 's' : ''}`;
        } else if (diffDays <= 7) {
          expiryText = `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
        } else {
          const dateStr = expiryDate.toISOString().split('T')[0];
          const timeStr = expiryDate.toISOString().split('T')[1].split('.')[0];
          expiryText = `${dateStr} ${timeStr} UTC`;
        }
      }
      
      message += `${i + 1}. ${status} ${acc.username} - ${expiryText}\n`;
    });
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('My subscriptions error:', error);
    await ctx.reply('❌ Error fetching subscriptions.');
  }
});

bot.action(/^plan_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  
  const telegramUserId = ctx.from.id.toString();
  const session = userSessions.get(telegramUserId);
  
  if (!session || !session.usernames) {
    await ctx.reply('❌ Session expired. Please use /start again.');
    return;
  }
  
  const planId = parseInt(ctx.match[1]);
  const accountCount = parseInt(ctx.match[2]);
  
  try {
    const plan = await firebaseDB.findPlanById(planId);
    
    if (!plan) {
      await ctx.reply('❌ Invalid plan.');
      return;
    }
    
    let user = await firebaseDB.findUserByTelegramId(telegramUserId);
    
    if (!user) {
      user = await firebaseDB.createUser({
        telegramUserId,
        status: 'pending',
      });
    }
    
    const totalPrice = (plan.priceCents / 100) * accountCount;
    
    const orderId = `SUB-${user.id}-${Date.now()}`;
    const subscription = await firebaseDB.createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'pending',
      oxapayOrderId: orderId,
    });
    
    session.subscriptionId = subscription.id;
    session.planId = plan.id;
    session.planName = plan.name;
    session.totalPrice = totalPrice;
    userSessions.set(telegramUserId, session);
    
    const invoice = await oxaPayService.createInvoice({
      amount: totalPrice,
      currency: 'USD',
      orderId,
      description: `${plan.name} - ${accountCount} Rainbet account(s): ${session.usernames.join(', ')}`,
      callbackUrl: `${DOMAIN}/api/oxapay/webhook`,
    });
    
    const paymentMsg = await ctx.reply(
      `You chose *${plan.name}* plan for *${accountCount}* Rainbet Public ID(s).\n` +
      `Total cost: *$${totalPrice}*\n\n` +
      `Please pay using the link below.\n\n` +
      `❗️ As soon as payment status changes, this message will update automatically. ❗️`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: `💰 Pay $${totalPrice} Now`, url: invoice.payLink }
          ]]
        }
      }
    );
    
    await firebaseDB.updateSubscription(subscription.id, { 
      oxapayTrackId: invoice.trackId,
      telegramChatId: ctx.chat.id.toString(),
      paymentMessageId: paymentMsg.message_id,
      pendingUsernames: session.usernames,
    });
    
    console.log(`💾 Saved subscription metadata for ${accountCount} Rainbet accounts:`, session.usernames);
    
    session.paymentMessageId = paymentMsg.message_id;
    userSessions.set(telegramUserId, session);
    
  } catch (error) {
    console.error('Plan selection error:', error);
    await ctx.reply('❌ Error creating payment. Please try again.');
  }
});

bot.on('text', async (ctx) => {
  const telegramUserId = ctx.from.id.toString();
  const session = userSessions.get(telegramUserId);
  
  if (!session || session.step !== 'waiting_for_usernames') {
    return;
  }
  
  try {
    const usernames = ctx.message.text.split('\n').map(u => u.trim().toUpperCase()).filter(u => u.length > 0);
    
    if (usernames.length === 0) {
      await ctx.reply('❌ Please enter at least one Rainbet Public ID.');
      return;
    }
    
    // Check for existing active subscriptions
    const activeAccounts = [];
    for (const username of usernames) {
      const existingAccounts = await firebaseDB.findRainbetAccountsByUsername(username);
      for (const acc of existingAccounts) {
        if (acc.status === 'active' && acc.expiryAt) {
          const expiryDate = new Date(acc.expiryAt);
          if (expiryDate > new Date()) {
            activeAccounts.push({
              publicId: username,
              expiryAt: expiryDate
            });
          }
        }
      }
    }
    
    if (activeAccounts.length > 0) {
      const activeList = activeAccounts.map(acc => {
        const expiryStr = acc.expiryAt.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
        return `• ${acc.publicId} (expires: ${expiryStr})`;
      }).join('\n');
      
      await ctx.reply(
        `❌ *Already Active Subscription*\n\n` +
        `The following Public ID(s) already have an active subscription:\n\n` +
        `${activeList}\n\n` +
        `Please wait until your current subscription expires, or enter different Public ID(s).`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    session.usernames = usernames;
    session.accountCount = usernames.length;
    session.step = 'eligibility_check';
    userSessions.set(telegramUserId, session);
    
    const hasTrialHistory = await firebaseDB.hasUsedTrial(telegramUserId);
    
    let usernameHasTrialHistory = false;
    for (const username of usernames) {
      if (await firebaseDB.hasUsedTrial(null, username)) {
        usernameHasTrialHistory = true;
        break;
      }
    }
    
    if (hasTrialHistory || usernameHasTrialHistory) {
      const availablePlans = await firebaseDB.getAllPlans();
      const keyboard = availablePlans.map(plan => {
        const displayPrice = `$${(plan.priceCents / 100) * usernames.length}`;
        return [Markup.button.callback(`${plan.name} - ${displayPrice}`, `plan_${plan.id}_${usernames.length}`)];
      });
      
      await ctx.reply('Select your plan:', Markup.inlineKeyboard(keyboard));
      return;
    }
    
    await ctx.reply(
      `✅ You have entered ${usernames.length} Rainbet Public ID(s):\n${usernames.join(', ')}\n\n` +
      `🎁 *You're eligible for a 30-MINUTE FREE TRIAL!*\n\n` +
      `Choose an option:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎁 Claim 30-Min Free Trial', callback_data: 'claim_free_trial' }],
            [{ text: '💎 Buy Subscription Plan', callback_data: 'show_buy_plans' }]
          ]
        }
      }
    );
    
  } catch (error) {
    console.error('Text handler error:', error);
    await ctx.reply('❌ An error occurred. Please try /start again.');
  }
});

bot.action('claim_free_trial', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramUserId = ctx.from.id.toString();
  const session = userSessions.get(telegramUserId);
  
  if (!session || !session.usernames) {
    await ctx.reply('❌ Session expired. Please use /start again.');
    return;
  }
  
  try {
    const usernames = session.usernames;
    
    const hasTrialHistory = await firebaseDB.hasUsedTrial(telegramUserId);
    
    if (hasTrialHistory) {
      await ctx.reply('❌ You have already used your free trial. Please purchase a subscription.');
      return;
    }
    
    let user = await firebaseDB.findUserByTelegramId(telegramUserId);
    if (!user) {
      user = await firebaseDB.createUser({
        telegramUserId,
        status: 'active',
        trialClaimedAt: new Date().toISOString()
      });
    } else {
      await firebaseDB.updateUser(user.id, {
        trialClaimedAt: new Date().toISOString(),
        status: 'active'
      });
    }
    
    await grantFreeTrial(ctx, user, usernames);
    
    userSessions.delete(telegramUserId);
    
  } catch (error) {
    console.error('Claim free trial error:', error);
    await ctx.reply('❌ Error claiming trial. Please try again.');
  }
});

bot.action('show_buy_plans', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramUserId = ctx.from.id.toString();
  const session = userSessions.get(telegramUserId);
  
  if (!session || !session.usernames) {
    await ctx.reply('❌ Session expired. Please use /start again.');
    return;
  }
  
  try {
    const usernames = session.usernames;
    
    let user = await firebaseDB.findUserByTelegramId(telegramUserId);
    
    if (!user) {
      user = await firebaseDB.createUser({
        telegramUserId,
        status: 'pending',
      });
    }
    
    await ctx.reply(
      `You have selected ${usernames.length} Rainbet Public ID(s): ${usernames.join(', ')}\n\n` +
      `Please choose a subscription period:`,
      { parse_mode: 'Markdown' }
    );
    
    const availablePlans = await firebaseDB.getAllPlans();
    
    const keyboard = availablePlans.map(plan => {
      const displayPrice = `$${(plan.priceCents / 100) * usernames.length}`;
      return [Markup.button.callback(`${plan.name} - ${displayPrice}`, `plan_${plan.id}_${usernames.length}`)];
    });
    
    await ctx.reply(
      'Select your plan:',
      Markup.inlineKeyboard(keyboard)
    );
    
  } catch (error) {
    console.error('Show buy plans error:', error);
    await ctx.reply('❌ Error loading plans. Please try again.');
  }
});

async function grantFreeTrial(ctx, user, usernames) {
  const SETUP_GUIDE_URL = 'https://www.rainbetcodeclaimer.com/#guide';
  
  try {
    const telegramUserId = ctx.from.id.toString();
    
    await firebaseDB.updateUser(user.id, { 
      trialClaimedAt: new Date().toISOString(),
      status: 'active'
    });
    
    const expiryAt = new Date(Date.now() + 30 * 60 * 1000);
    
    for (const username of usernames) {
      await firebaseDB.createRainbetAccount({
        userId: user.id,
        username,
        status: 'active',
        expiryAt: expiryAt.toISOString()
      });
      
      await firebaseDB.createTrialHistory({
        telegramUserId,
        username
      });
    }
    
    const expiryTimeStr = expiryAt.toISOString().split('T')[1].split('.')[0];
    const expiryDateStr = expiryAt.toISOString().split('T')[0];
    
    await ctx.reply(
      `🎉 *CONGRATULATIONS!*\n\n` +
      `You've been granted a *30-MINUTE FREE TRIAL!*\n\n` +
      `✅ Your Rainbet accounts are now *ACTIVE* and will auto-claim codes:\n` +
      usernames.map((u, i) => `  ${i + 1}. ${u}`).join('\n') + '\n\n' +
      `⏰ Trial expires in *30 minutes*\n` +
      `   (${expiryDateStr} ${expiryTimeStr} UTC)\n\n` +
      `After your trial ends, choose a subscription plan to continue enjoying auto-claiming!\n\n` +
      `🌧️ *Start using it now - codes will auto-claim automatically!*`,
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Setup Your Bot Now', url: SETUP_GUIDE_URL }]
          ]
        }
      }
    );
    
    await ctx.reply(
      'When ready to subscribe:',
      Markup.inlineKeyboard([
        [Markup.button.callback('💎 View Subscription Plans', 'show_plans_' + usernames.length)]
      ])
    );
    
    console.log(`✅ Free trial granted to user ${telegramUserId} for ${usernames.length} Rainbet accounts`);
    
  } catch (error) {
    console.error('Error granting free trial:', error);
    await ctx.reply('❌ Error activating free trial. Please try again.');
  }
}

bot.action(/^show_plans_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  
  const accountCount = parseInt(ctx.match[1]);
  
  try {
    const availablePlans = await firebaseDB.getAllPlans();
    
    const keyboard = availablePlans.map(plan => {
      const displayPrice = `$${(plan.priceCents / 100) * accountCount}`;
      return [Markup.button.callback(`${plan.name} - ${displayPrice}`, `plan_${plan.id}_${accountCount}`)];
    });
    
    await ctx.reply(
      'Select your plan:',
      Markup.inlineKeyboard(keyboard)
    );
  } catch (error) {
    console.error('Show plans error:', error);
    await ctx.reply('❌ Error loading plans.');
  }
});

async function notifyPaymentConfirmed(telegramUserId, messageId, subscriptionDetails) {
  const SETUP_GUIDE_URL = 'https://www.rainbetcodeclaimer.com/#guide';
  
  try {
    await bot.telegram.editMessageText(
      telegramUserId,
      messageId,
      null,
      `✅ *Payment Confirmed!*\n\n` +
      `Your Rainbet subscription is now *active*!\n\n` +
      `📋 *Details:*\n` +
      `Plan: ${subscriptionDetails.planName}\n` +
      `Accounts: ${subscriptionDetails.accountCount}\n` +
      `Expires: ${subscriptionDetails.expiryDate}\n\n` +
      `🌧️ *Your Rainbet accounts are now connected and will auto-claim codes!*\n\n` +
      `Active accounts:\n` +
      subscriptionDetails.usernames.map((u, i) => `  ${i + 1}. ${u}`).join('\n'),
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Setup Your Bot Now', url: SETUP_GUIDE_URL }]
          ]
        }
      }
    );
    
    console.log(`✅ Payment confirmation sent to user ${telegramUserId}`);
    
  } catch (error) {
    console.error('Error updating payment message:', error);
    try {
      await bot.telegram.sendMessage(
        telegramUserId,
        `✅ *Payment Confirmed!*\n\n` +
        `Your Rainbet subscription is now *active*!\n\n` +
        `📋 *Details:*\n` +
        `Plan: ${subscriptionDetails.planName}\n` +
        `Accounts: ${subscriptionDetails.accountCount}\n` +
        `Expires: ${subscriptionDetails.expiryDate}\n\n` +
        `🌧️ *Your Rainbet accounts are now connected and will auto-claim codes!*\n\n` +
        `Active accounts:\n` +
        subscriptionDetails.usernames.map((u, i) => `  ${i + 1}. ${u}`).join('\n'),
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🚀 Setup Your Bot Now', url: SETUP_GUIDE_URL }]
            ]
          }
        }
      );
      console.log(`✅ Payment confirmation sent as new message to user ${telegramUserId}`);
    } catch (e) {
      console.error('Error sending notification:', e);
    }
  }
}

module.exports = { bot, userSessions, notifyPaymentConfirmed };

if (require.main === module) {
  if (process.env.SUBSCRIPTION_BOT_TOKEN) {
    bot.launch().then(() => {
      console.log('🤖 Rainbet Subscription bot started!');
    }).catch((error) => {
      console.error('Failed to start bot:', error);
      process.exit(1);
    });

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } else {
    console.warn('⚠️  SUBSCRIPTION_BOT_TOKEN not set - subscription bot not started');
    console.log('Please create a bot via @BotFather and add the token to secrets');
  }
}
