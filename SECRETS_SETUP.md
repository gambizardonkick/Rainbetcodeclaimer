# Secrets Setup Guide

## Firebase Credentials Setup

### Step 1: Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a new project"
3. Name it (e.g., "Rainbet Code Claimer")
4. Click "Create project"

### Step 2: Get Firebase Credentials
1. In Firebase Console, go to **Project Settings** (gear icon)
2. Click **Service Accounts** tab
3. Click **Generate New Private Key** button
4. A JSON file will download with all your credentials
5. Open the JSON file and find:
   - `project_id` → **FIREBASE_PROJECT_ID**
   - `client_email` → **FIREBASE_CLIENT_EMAIL**
   - `private_key` → **FIREBASE_PRIVATE_KEY**

### Step 3: Get Database URL
1. In Firebase Console, go to **Realtime Database**
2. Click **Create Database**
3. Choose location and start in **Test Mode**
4. Copy the database URL (looks like `https://project-name.firebaseio.com`)
5. Make sure it's the **ROOT URL ONLY** - no child paths!
   - ✅ Correct: `https://project-name.firebaseio.com`
   - ❌ Wrong: `https://project-name.firebaseio.com/somepath`
6. This is → **FIREBASE_DATABASE_URL**

**Note:** If you accidentally include a child path, our system will automatically clean it for you!

---

## Telegram Bot Setup

### Get SUBSCRIPTION_BOT_TOKEN
1. Open Telegram and search for **@BotFather**
2. Type `/newbot`
3. Follow the prompts:
   - Enter bot name (e.g., "Rainbet Subscription Bot")
   - Enter bot username (e.g., "rainbet_subscription_bot")
4. BotFather will give you a token that looks like: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`
5. This is → **SUBSCRIPTION_BOT_TOKEN**

---

## OxaPay Setup

### Get OXAPAY_MERCHANT_API_KEY
1. Go to [OxaPay Dashboard](https://oxapay.com/dashboard)
2. Create an account or log in
3. Go to **API Keys** or **Settings**
4. Create a new API key
5. Copy the key → **OXAPAY_MERCHANT_API_KEY**

---

## Generate Security Keys

These don't need to come from anywhere - you create them:

### JWT_SECRET
Generate a random secure string (minimum 32 characters):
```
rainbet-jwt-secret-key-abc123xyz789-do-not-share-this
```

### ADMIN_API_KEY
Generate another random string:
```
admin-api-key-super-secret-12345678
```

You can use an online tool like [randomkeygen.com](https://randomkeygen.com/) for secure random strings.

---

## How to Set Secrets in Replit

### Method 1: Using Replit UI (Easiest)
1. In Replit, click the **Secrets** icon (🔑) on the left sidebar
2. Click **"Add new secret"**
3. Enter the key name (e.g., `FIREBASE_PROJECT_ID`)
4. Enter the value (from Firebase JSON file)
5. Click **"Add Secret"**
6. Repeat for all 8 secrets

### Method 2: Using CLI Command (One at a time)
```bash
replit secrets set FIREBASE_PROJECT_ID "your-value-here"
replit secrets set FIREBASE_CLIENT_EMAIL "your-value-here"
replit secrets set FIREBASE_PRIVATE_KEY "your-value-here"
replit secrets set FIREBASE_DATABASE_URL "your-value-here"
replit secrets set SUBSCRIPTION_BOT_TOKEN "your-value-here"
replit secrets set OXAPAY_MERCHANT_API_KEY "your-value-here"
replit secrets set JWT_SECRET "your-jwt-secret-string"
replit secrets set ADMIN_API_KEY "your-admin-api-key-string"
```

---

## Verification

After setting all secrets, run:
```bash
npm start
```

Check the logs for:
- ✅ `Firebase initialized successfully`
- ✅ `API server running on port 5000`
- ✅ `Telegram bot connected`

If any secrets are missing, you'll see error messages like:
- ❌ `Firebase PRIVATE_KEY not found`
- ❌ `SUBSCRIPTION_BOT_TOKEN not found`

---

## Important Notes

⚠️ **FIREBASE_PRIVATE_KEY** - When copying from JSON:
- Use the entire key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`
- The key has literal `\n` characters - Replit will handle these automatically

⚠️ **Secrets are case-sensitive** - Use exact names:
- ✅ `FIREBASE_PROJECT_ID` (correct)
- ❌ `Firebase_Project_ID` (wrong)
- ❌ `firebase_project_id` (wrong)

⚠️ **Never commit secrets to code** - Always use environment variables/secrets

---

## Quick Checklist

After setting up, verify you have:
- [ ] Firebase Project created
- [ ] Realtime Database URL
- [ ] Service Account JSON downloaded
- [ ] Telegram bot token from @BotFather
- [ ] OxaPay API key
- [ ] Generated JWT_SECRET and ADMIN_API_KEY
- [ ] All 8 secrets added to Replit
- [ ] Server starts without errors
