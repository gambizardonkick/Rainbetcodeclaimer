# Debugging Username Detection

## How to See What's Happening

1. **Install the updated Tampermonkey script** and make sure it's enabled
2. **Go to rainbet.com and log in**
3. **Open the browser Developer Tools** (F12 or Right-click → Inspect)
4. **Go to Console tab**
5. **Scroll to find logs starting with "🔍"** when you click "🔒 Fetch Username & Connect"

## What to Look For

### Successful Username Detection
You should see:
```
🔍 Auth token found: ✅ Yes
📡 Calling Rainbet user API...
📥 API Response status: 200
📊 API Response data: { profile: { username: 'YourUsername', ... }, ... }
✅ Got username from API: yourusername
```

### Failed Username Detection
If you see:
```
🔍 Auth token found: ❌ No
❌ No auth token - trying fallback methods...
❌ Could not find username anywhere
```

**Solution:** Make sure you're logged into Rainbet. The script needs your auth token.

## Common Issues & Fixes

### Issue 1: Auth Token Not Found
- **Check:** Are you logged into Rainbet?
- **Fix:** Log in to Rainbet first, then try connecting

### Issue 2: API Returns Error (status 401, 403, etc)
- **Check:** Look for the status code in logs
- **Fix:** This might mean your auth token expired - log out and log back in

### Issue 3: Username Not in API Response
- **Check:** The fallback will try to find username on the page
- **Fix:** Make sure the page fully loaded with your username visible

## Full Debugging Flow

```
Click "🔒 Fetch Username & Connect" button
    ↓
Console logs: "🔍 Auth token found: ✅ Yes" or "❌ No"
    ↓
If Yes: Calls API → Shows response data
If No: Looks for username on page
    ↓
If found: Shows "✅ Got username from API: xxx"
    ↓
Sends to backend: "🔐 Verifying "xxx" with backend..."
    ↓
Backend response: Shows if connection succeeded or failed
```

## Copy Logs for Debugging

If you can't figure it out:
1. Click the button
2. Right-click on console → Select all
3. Copy all logs
4. Send them to support with what happened

The logs will show exactly where it's failing!
