# Testing Guide

## Adding Test Accounts

### Option 1: Using the Add Test Account Script

Once Firebase credentials are set up, run:

```bash
npm run add-test-account
```

This will add the "RobbingCasinos" account with:
- Username: `robbingcasinos` 
- Status: Active
- Expiry: 10 years (for testing)

### Option 2: Using Admin API Endpoint

Once the backend is running, add an account via curl:

```bash
curl -X POST http://localhost:5000/api/admin/rainbet-accounts \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_ADMIN_API_KEY" \
  -d '{
    "telegramUserId": "test_user_robbingcasinos",
    "username": "RobbingCasinos",
    "expiryAt": "2035-12-31T23:59:59Z"
  }'
```

## Testing the Connection Flow

1. **Set Firebase Credentials:**
   - Add `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_DATABASE_URL` to secrets

2. **Start the API Server:**
   ```bash
   npm start
   ```

3. **Install the Tampermonkey Script:**
   - Install [Tampermonkey](https://www.tampermonkey.net/)
   - Visit the script at: `RainbetCodeClaimer.user.js`
   - Click "Install"

4. **Test Connection:**
   - Go to https://rainbet.com
   - Log in with the test account or any Rainbet account
   - Click "🔒 Fetch Username & Connect" button
   - Verify username is fetched and displayed
   - Connection should succeed if account exists in database

## Database Collections

- **users**: User profiles with Telegram IDs
- **rainbetAccounts**: Rainbet accounts linked to users
- **plans**: Subscription plans
- **subscriptions**: Active subscriptions
- **codes**: Promo codes and their claim status

## Debugging

Check logs for:
1. Username fetch: `✅ Got username from API: robbingcasinos`
2. Backend verification: `✅ User authenticated: robbingcasinos`
3. Connection success: Shows green "✅ Active" status
