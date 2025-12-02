const express = require('express');
const cors = require('cors');
const path = require('path');
const firebaseDB = require('./firebaseDb.js');
const { initializeFirebase } = require('./firebase.js');
const { oxaPayService } = require('./oxapay.js');
const { TelegramNotifier } = require('../shared/telegramNotifier.js');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

initializeFirebase();

const telegramNotifier = new TelegramNotifier(process.env.SUBSCRIPTION_BOT_TOKEN);

const JWT_SECRET = process.env.JWT_SECRET || 'rainbet-codes-secret-change-in-production';
const TELEGRAM_BOT_TOKEN = process.env.SUBSCRIPTION_BOT_TOKEN;
const TG_ENCRYPT_KEY = 'rainbet-tg-encrypt-key-2024';

// Encrypt bot token for client-side use
function encryptBotToken(publicId) {
  if (!TELEGRAM_BOT_TOKEN) return null;
  const key = crypto.createHash('sha256').update(publicId + TG_ENCRYPT_KEY).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(TELEGRAM_BOT_TOKEN, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

const recentCodes = [];
const CODE_CACHE_DURATION = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  const validCodes = recentCodes.filter(c => (now - c.timestamp) < CODE_CACHE_DURATION);
  const removed = recentCodes.length - validCodes.length;
  recentCodes.length = 0;
  recentCodes.push(...validCodes);
  if (removed > 0) {
    console.log(`🧹 Cache cleanup: removed ${removed} old codes, ${recentCodes.length} remaining`);
  }
}, 60 * 1000);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key']
}));
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'rainbet-api-server'
  });
});

app.post('/api/oxapay/webhook', async (req, res) => {
  try {
    const payload = JSON.stringify(req.body);
    const hmacHeader = req.headers['hmac'];
    
    const isValid = oxaPayService.verifyWebhookSignature(payload, hmacHeader);
    
    if (!isValid) {
      console.error('Invalid OxaPay webhook signature');
      return res.status(403).send('Invalid signature');
    }
    
    const data = req.body;
    const status = (data.status || '').toLowerCase();
    console.log(`📢 OxaPay Webhook received - Status: ${data.status}, OrderId: ${data.orderId}`);
    
    const subscriptionsRef = firebaseDB.db.ref('subscriptions');
    const subscriptionSnapshot = await subscriptionsRef.orderByChild('oxapayOrderId').equalTo(data.orderId).once('value');
    
    if (!subscriptionSnapshot.exists()) {
      console.error('Subscription not found for orderId:', data.orderId);
      return res.status(404).send('Subscription not found');
    }
    
    const subscriptionId = Object.keys(subscriptionSnapshot.val())[0];
    const subscription = { id: subscriptionId, ...subscriptionSnapshot.val()[subscriptionId] };
    
    const SETUP_GUIDE_URL = 'https://www.rainbetcodeclaimer.com/#guide';
    
    if (status === 'confirming') {
      console.log(`⏳ Payment confirming for subscription ${subscription.id}`);
      
      await firebaseDB.updateSubscription(subscription.id, {
        status: 'confirming',
        txId: data.txID,
      });
      
      if (subscription.telegramChatId && subscription.paymentMessageId) {
        try {
          await telegramNotifier.editMessageText(
            subscription.telegramChatId,
            subscription.paymentMessageId,
            `⏳ *Transaction Detected!*\n\n` +
            `We have seen your transaction on the blockchain.\n` +
            `Waiting for network confirmation...\n\n` +
            `💰 Amount: ${data.payAmount} ${data.payCurrency}\n` +
            `🔗 Network: ${data.network}\n\n` +
            `_Please wait, this usually takes 1-5 minutes._`
          );
          console.log(`✅ Sent confirming notification to user`);
        } catch (notifyError) {
          console.error('❌ Error sending confirming notification:', notifyError.message);
        }
      }
      
    } else if (status === 'paid') {
      const plan = await firebaseDB.findPlanById(subscription.planId);
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + plan.durationDays);
      
      await firebaseDB.updateSubscription(subscription.id, {
        status: 'active',
        expiryAt: expiryDate.toISOString(),
        paidAmount: data.payAmount || data.amount || '0',
        paidCurrency: data.payCurrency || data.currency || 'USD',
        txId: data.txID || '',
      });
      
      await firebaseDB.updateUser(subscription.userId, { status: 'active' });
      
      console.log(`✅ Subscription ${subscription.id} activated for user ${subscription.userId}`);
      
      if (subscription.pendingUsernames && Array.isArray(subscription.pendingUsernames) && subscription.pendingUsernames.length > 0) {
        console.log(`📝 Activating ${subscription.pendingUsernames.length} Rainbet accounts...`);
        
        for (const username of subscription.pendingUsernames) {
          try {
            const upperUsername = username.toUpperCase();
            const existingAccounts = await firebaseDB.findRainbetAccountsByUsername(upperUsername);
            
            if (existingAccounts.length > 0) {
              await firebaseDB.updateRainbetAccount(existingAccounts[0].id, {
                status: 'active',
                expiryAt: expiryDate.toISOString(),
              });
              console.log(`✅ Updated Rainbet account: ${upperUsername}`);
            } else {
              await firebaseDB.createRainbetAccount({
                userId: subscription.userId,
                username: upperUsername,
                publicId: upperUsername,
                status: 'active',
                expiryAt: expiryDate.toISOString(),
              });
              console.log(`✅ Created Rainbet account: ${upperUsername}`);
            }
          } catch (accountError) {
            console.error(`❌ Error activating account ${username}:`, accountError);
          }
        }
      }
      
      if (subscription.telegramChatId) {
        try {
          const expiryDateStr = expiryDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
          
          const usernames = subscription.pendingUsernames || [];
          const accountCount = usernames.length;
          
          await telegramNotifier.editMessageText(
            subscription.telegramChatId,
            subscription.paymentMessageId,
            `✅ *Payment Confirmed!*\n\n` +
            `Your Rainbet subscription is now *active*!\n\n` +
            `📋 *Details:*\n` +
            `Plan: ${plan.name}\n` +
            `Accounts: ${accountCount}\n` +
            `Expires: ${expiryDateStr}\n\n` +
            `🌧️ *Your Rainbet accounts are now connected and will auto-claim codes!*\n\n` +
            `Active accounts:\n` +
            usernames.map((u, i) => `  ${i + 1}. ${u}`).join('\n'),
            { 
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🚀 Setup Your Bot Now', url: SETUP_GUIDE_URL }]
                ]
              }
            }
          );
          console.log(`✅ Sent payment confirmed notification to user`);
        } catch (notifyError) {
          console.error('❌ Error sending Telegram notification:', notifyError.message);
          try {
            const usernames = subscription.pendingUsernames || [];
            await telegramNotifier.sendMessage(
              subscription.telegramChatId,
              `✅ *Payment Confirmed!*\n\n` +
              `Your Rainbet subscription is now *active*!\n\n` +
              `🌧️ Your accounts will auto-claim codes:\n` +
              usernames.map((u, i) => `  ${i + 1}. ${u}`).join('\n'),
              { 
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🚀 Setup Your Bot Now', url: SETUP_GUIDE_URL }]
                  ]
                }
              }
            );
          } catch (e) {
            console.error('❌ Error sending backup notification:', e.message);
          }
        }
      }
      
    } else if (status === 'expired') {
      await firebaseDB.updateSubscription(subscription.id, { status: 'expired' });
      console.log(`⏰ Subscription ${subscription.id} expired`);
      
      if (subscription.telegramChatId && subscription.paymentMessageId) {
        try {
          await telegramNotifier.editMessageText(
            subscription.telegramChatId,
            subscription.paymentMessageId,
            `❌ *Payment Expired*\n\n` +
            `Your payment session has expired.\n` +
            `Please use /start to create a new payment.`
          );
        } catch (e) {
          console.error('❌ Error sending expired notification:', e.message);
        }
      }
    }
    
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Internal server error');
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const accountsRef = firebaseDB.db.ref('rainbetAccounts');
    const accountsSnapshot = await accountsRef.once('value');
    
    const accounts = [];
    if (accountsSnapshot.exists()) {
      const usersRef = firebaseDB.db.ref('users');
      const usersSnapshot = await usersRef.once('value');
      const usersData = usersSnapshot.val() || {};
      
      accountsSnapshot.forEach((childSnapshot) => {
        const account = childSnapshot.val();
        const accountId = childSnapshot.key;
        const user = usersData[account.userId] || {};
        
        accounts.push({
          id: parseInt(accountId),
          telegramUserId: user.telegramUserId || null,
          username: account.publicId || account.username || null,
          publicId: account.publicId || null,
          status: account.status,
          expiryAt: account.expiryAt,
          createdAt: account.createdAt,
        });
      });
    }
    
    res.json(accounts);
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const accountId = req.params.id;
    await firebaseDB.db.ref(`rainbetAccounts/${accountId}`).remove();
    
    console.log(`🗑️ Admin deleted Rainbet account: ${accountId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/rainbet-accounts', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const { telegramUserId, username, expiryAt } = req.body;
    const publicId = username;
    
    if (!publicId) {
      return res.status(400).json({ error: 'Missing publicId' });
    }
    
    const normalizedPublicId = publicId.trim().toUpperCase();
    const existing = await firebaseDB.findRainbetAccountsByPublicId(normalizedPublicId);
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Public ID already exists' });
    }
    
    let userId = null;
    
    // Only create/link user if telegramUserId is provided
    if (telegramUserId) {
      let user = await firebaseDB.findUserByTelegramId(telegramUserId);
      if (!user) {
        user = await firebaseDB.createUser({
          telegramUserId,
          status: 'active',
        });
      }
      userId = user.id;
    }
    
    const account = await firebaseDB.createRainbetAccount({
      userId: userId,
      publicId: normalizedPublicId,
      telegramChatId: telegramUserId || null,
      status: 'active',
      expiryAt: expiryAt ? new Date(expiryAt).toISOString() : null,
    });
    
    console.log(`✅ Admin added Rainbet account: ${publicId}${telegramUserId ? ` (TG: ${telegramUserId})` : ''}`);
    
    res.json({
      success: true,
      account,
    });
    
  } catch (error) {
    console.error('Admin add account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin add code endpoint
app.post('/api/admin/codes', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const { code, value, limit, wagerRequirement, timeline } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Missing code' });
    }
    
    const existingCode = recentCodes.find(c => c.code.toUpperCase() === code.toUpperCase());
    if (existingCode) {
      return res.json({ success: true, message: 'Code already exists', code: existingCode });
    }
    
    const newCode = {
      code: code.toUpperCase(),
      value: value || null,
      limit: limit || null,
      wagerRequirement: wagerRequirement || null,
      timeline: timeline || null,
      source: 'Admin',
      claimed: false,
      rejectionReason: null,
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
    };
    
    recentCodes.unshift(newCode);
    
    console.log(`📝 Admin added code: ${code}`);
    
    res.json({ success: true, code: newCode });
    
  } catch (error) {
    console.error('Admin add code error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.options('/api/auth/connect', cors());

app.post('/api/auth/connect', async (req, res) => {
  try {
    const { publicId, rainbetUsername } = req.body;
    
    let account = null;
    
    // Try with publicId (normalize to uppercase for case-insensitive matching)
    if (publicId) {
      const normalizedPublicId = publicId.toUpperCase();
      const accountsRef = firebaseDB.db.ref('rainbetAccounts');
      
      // First try publicId field
      let snapshot = await accountsRef.orderByChild('publicId').equalTo(normalizedPublicId).once('value');
      if (snapshot.exists()) {
        const accountId = Object.keys(snapshot.val())[0];
        account = { id: accountId, ...snapshot.val()[accountId] };
      }
      
      // Also check username field (subscription bot stores Public ID here)
      if (!account) {
        snapshot = await accountsRef.orderByChild('username').equalTo(normalizedPublicId).once('value');
        if (snapshot.exists()) {
          const accountId = Object.keys(snapshot.val())[0];
          account = { id: accountId, ...snapshot.val()[accountId] };
        }
      }
    }
    
    // Fallback to rainbetUsername if publicId not provided
    if (!account && rainbetUsername) {
      const accounts = await firebaseDB.findRainbetAccountsByUsername(rainbetUsername.toUpperCase());
      if (accounts.length > 0) {
        account = accounts[0];
      }
    }
    
    if (!account) {
      return res.status(404).json({ error: 'No active subscription for this account' });
    }
    
    if (account.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }
    
    if (account.expiryAt && new Date(account.expiryAt) < new Date()) {
      return res.status(403).json({ error: 'Subscription has expired' });
    }
    
    const accessToken = jwt.sign(
      { 
        userId: account.userId,
        rainbetAccountId: account.id,
        username: account.username,
      },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );
    
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    const refreshExpiryDate = new Date();
    refreshExpiryDate.setDate(refreshExpiryDate.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
    
    const sessionsRef = firebaseDB.db.ref('authSessions');
    const oldSessionsSnapshot = await sessionsRef.orderByChild('rainbetAccountId').equalTo(account.id).once('value');
    if (oldSessionsSnapshot.exists()) {
      const updates = {};
      oldSessionsSnapshot.forEach((session) => {
        updates[session.key] = null;
      });
      await sessionsRef.update(updates);
    }
    
    await firebaseDB.createAuthSession({
      userId: account.userId,
      rainbetAccountId: account.id,
      refreshToken: refreshTokenHash,
      expiresAt: refreshExpiryDate.toISOString(),
    });
    
    // Get telegram chat ID - check account first, then linked user
    let telegramChatId = account.telegramChatId || null;
    let encryptedBotToken = null;
    
    // If no direct telegramChatId on account, check linked user
    if (!telegramChatId && account.userId) {
      const user = await firebaseDB.findUserById(account.userId);
      if (user && user.telegramUserId) {
        telegramChatId = user.telegramUserId;
      }
    }
    
    // Encrypt bot token if we have a telegram chat ID
    if (telegramChatId) {
      encryptedBotToken = encryptBotToken(publicId.toUpperCase());
    }
    
    const displayId = account.publicId || account.username || publicId;
    console.log(`✅ User authenticated: ${displayId.substring(0,8)}...`);
    
    res.json({
      success: true,
      accessToken,
      refreshToken,
      username: account.username,
      expiryAt: account.expiryAt,
      telegramChatId,
      tgToken: encryptedBotToken,
    });
    
  } catch (error) {
    console.error('Auth connect error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ valid: false, error: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ valid: false, error: 'Invalid or expired token' });
    }
    
    const accountSnapshot = await firebaseDB.db.ref(`rainbetAccounts/${decoded.rainbetAccountId}`).once('value');
    
    if (!accountSnapshot.exists()) {
      return res.status(403).json({ valid: false, error: 'Account not found' });
    }
    
    const account = { id: decoded.rainbetAccountId, ...accountSnapshot.val() };
    
    if (account.status !== 'active') {
      return res.status(403).json({ valid: false, error: 'Account is not active' });
    }
    
    if (account.expiryAt && new Date(account.expiryAt) < new Date()) {
      return res.status(403).json({ valid: false, error: 'Subscription has expired' });
    }
    
    res.json({
      valid: true,
      username: account.username,
      subscriptionExpiry: account.expiryAt,
    });
    
  } catch (error) {
    console.error('Auth verify error:', error);
    res.status(500).json({ valid: false, error: 'Internal server error' });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refreshToken' });
    }
    
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    const session = await firebaseDB.findAuthSessionByRefreshToken(refreshTokenHash);
    
    if (!session) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    if (new Date(session.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'Refresh token expired' });
    }
    
    const accountSnapshot = await firebaseDB.db.ref(`rainbetAccounts/${session.rainbetAccountId}`).once('value');
    
    if (!accountSnapshot.exists()) {
      return res.status(403).json({ error: 'Account not found' });
    }
    
    const account = { id: session.rainbetAccountId, ...accountSnapshot.val() };
    
    if (account.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }
    
    if (account.expiryAt && new Date(account.expiryAt) < new Date()) {
      return res.status(403).json({ error: 'Subscription has expired' });
    }
    
    const newAccessToken = jwt.sign(
      { 
        userId: account.userId,
        rainbetAccountId: account.id,
        username: account.username,
      },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );
    
    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    const newRefreshTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    
    await firebaseDB.db.ref(`authSessions/${session.id}`).update({
      refreshToken: newRefreshTokenHash,
      lastActiveAt: new Date().toISOString(),
    });
    
    res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
    
  } catch (error) {
    console.error('Auth refresh error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refreshToken' });
    }
    
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    const session = await firebaseDB.findAuthSessionByRefreshToken(refreshTokenHash);
    if (session) {
      await firebaseDB.deleteAuthSession(session.id);
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Auth logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/subscription/status/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    const user = await firebaseDB.findUserById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const activeSubscriptions = await firebaseDB.findActiveSubscriptionsByUserId(userId);
    
    res.json({
      user,
      subscription: activeSubscriptions[0] || null,
    });
    
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/codes', (req, res) => {
  res.json(recentCodes);
});

app.post('/api/codes', async (req, res) => {
  try {
    const { code, value, limit, wagerRequirement, timeline, amount, wager, deadline, source } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Missing code' });
    }
    
    const existingCode = recentCodes.find(c => c.code.toUpperCase() === code.toUpperCase());
    if (existingCode) {
      return res.json({ success: true, message: 'Code already exists', code: existingCode });
    }
    
    const newCode = {
      code: code.toUpperCase(),
      value: value || null,
      limit: limit || null,
      wagerRequirement: wagerRequirement || null,
      timeline: timeline || null,
      amount: amount || null,
      wager: wager || null,
      deadline: deadline || null,
      source: source || 'Telegram',
      claimed: false,
      rejectionReason: null,
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
    };
    
    recentCodes.unshift(newCode);
    
    console.log(`📝 New code added: ${code}`);
    
    res.json({ success: true, code: newCode });
    
  } catch (error) {
    console.error('Add code error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/redeem-code', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Missing code' });
    }
    
    console.log(`🎯 Backend redeeming code: ${code}`);
    
    const axios = require('axios');
    
    const response = await axios.post('https://services.rainbet.com/v1/redeem/code', 
      { code },
      {
        timeout: 15000,
        withCredentials: true,
        headers: {
          'accept': 'application/json, text/plain, */*',
          'accept-encoding': 'gzip, deflate, br, zstd',
          'accept-language': 'en-US,en;q=0.9',
          'content-type': 'application/json',
          'origin': 'https://rainbet.com',
          'priority': 'u=1, i',
          'referer': 'https://rainbet.com/',
          'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
        }
      }
    );
    
    console.log(`✅ Rainbet API Response:`, response.data);
    res.json({ success: true, data: response.data });
    
  } catch (error) {
    console.error(`❌ Redeem code error:`, error.response?.data || error.message);
    
    const errorData = error.response?.data || { error: error.message };
    const status = error.response?.status || 500;
    
    res.status(status).json({ error: true, data: errorData });
  }
});

app.post('/api/code/claim', async (req, res) => {
  try {
    const { code, success, error: reason } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Missing code' });
    }
    
    const codeIndex = recentCodes.findIndex(c => c.code.toUpperCase() === code.toUpperCase());
    
    if (codeIndex >= 0) {
      recentCodes[codeIndex].claimed = success;
      if (!success && reason) {
        recentCodes[codeIndex].rejectionReason = reason;
      }
      recentCodes[codeIndex].claimedAt = new Date().toISOString();
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Claim code error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/plans', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const { name, priceCents, currency, durationDays, maxCodesPerDay } = req.body;
    
    if (!name || !priceCents || !durationDays) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const plan = await firebaseDB.createPlan({
      name,
      priceCents,
      currency: currency || 'TRX',
      durationDays,
      maxCodesPerDay: maxCodesPerDay || 10,
    });
    
    console.log(`✅ Admin created plan: ${name}`);
    
    res.json({ success: true, plan });
    
  } catch (error) {
    console.error('Admin create plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/plans', async (req, res) => {
  try {
    const plans = await firebaseDB.getAllPlans();
    res.json(plans);
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/cleanup', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const result = await firebaseDB.deleteExpiredRainbetAccounts();
    
    console.log(`🧹 Cleanup: ${result.deleted} expired accounts deleted`);
    
    res.json({
      success: true,
      deleted: result.deleted,
      accounts: result.accounts,
    });
    
  } catch (error) {
    console.error('Admin cleanup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/admin/trial', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const { telegramUserId, username } = req.body;
    
    if (!telegramUserId || !username) {
      return res.status(400).json({ error: 'Missing telegramUserId or username' });
    }
    
    const hasUsed = await firebaseDB.hasUsedTrial(telegramUserId, username);
    
    if (hasUsed) {
      return res.status(400).json({ error: 'Trial already used' });
    }
    
    let user = await firebaseDB.findUserByTelegramId(telegramUserId);
    
    if (!user) {
      user = await firebaseDB.createUser({
        telegramUserId,
        status: 'active',
      });
    }
    
    const expiryDate = new Date();
    expiryDate.setMinutes(expiryDate.getMinutes() + 30);
    
    const account = await firebaseDB.createRainbetAccount({
      userId: user.id,
      username: username.toLowerCase(),
      status: 'active',
      expiryAt: expiryDate.toISOString(),
    });
    
    await firebaseDB.createTrialHistory({
      telegramUserId,
      username: username.toLowerCase(),
    });
    
    console.log(`✅ Trial granted: ${username} for user ${user.id}`);
    
    res.json({
      success: true,
      account,
      expiryAt: expiryDate.toISOString(),
    });
    
  } catch (error) {
    console.error('Admin trial error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve static files AFTER all API routes
app.use(express.static(path.join(__dirname, '../public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Rainbet API Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
