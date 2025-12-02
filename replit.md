# Overview

This project is a multi-user subscription service for automated Rainbet.com promo code redemption. It allows users to subscribe multiple Rainbet accounts simultaneously using cryptocurrency payments (OxaPay). The primary goal is to provide a seamless and automated experience for redeeming promo codes found in various Telegram Rainbet groups.

**Key Capabilities:**
*   Monitors multiple Telegram Rainbet groups for promo codes.
*   Automatically extracts codes and their metadata (amount, wager, deadline).
*   Manages user subscriptions and crypto payments.
*   Auto-redeems codes for all subscribed user accounts on Rainbet.com.
*   Provides a client-side dashboard for users to track codes and their redemption status.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

The system is built upon a three-component architecture designed for efficiency and user autonomy:

1.  **Telegram Client (client.js):**
    *   Uses GramJS MTProto to connect as a regular Telegram user, monitoring Telegram groups.
    *   Forwards detected messages containing promo codes to a designated Telegram channel.
    *   Sends messages to the Dashboard Server for code detection and processing.
    *   Event-driven using `NewMessage` handler for real-time monitoring.

2.  **Dashboard Server (server/api.js):**
    *   An Express.js server that receives messages from the Telegram Client.
    *   Automatically detects promo codes using regex patterns (3-30 character alphanumeric).
    *   Extracts comprehensive metadata including code amount, wager requirement, and deadline.
    *   Temporarily stores codes in memory (5-minute cache) for immediate availability.
    *   Provides a REST API for the Tampermonkey script to fetch codes and mark them as claimed.

3.  **Tampermonkey Script (RainbetCodeClaimer.user.js):**
    *   A single, unified script that runs on Rainbet.com.
    *   **Auto-polls the API every 200ms** for new codes.
    *   Injects a built-in dashboard UI into the Rainbet.com page, displaying code details, claim status, and statistics.
    *   **Instant Auto-Redeem:** Uses Rainbet's REST API (`POST /v1/redeem/code`) to redeem codes directly.
    *   Monitors API responses for success/error messages related to redemption.
    *   Uses browser's `GM_setValue` storage to prevent duplicate code processing and maintain a user-specific history.

**Rainbet API Integration:**
*   **Endpoint:** `POST https://services.rainbet.com/v1/redeem/code`
*   **Request Body:** `{"code":"CODE_VALUE"}`
*   **Authentication:** Bearer token from browser localStorage
*   **Error Format:** `{"error":"er_invalid_redeem_code"}` or similar error codes

**Design Rationale:**
*   MTProto user client was chosen due to the absence of admin access for bot integration in source groups.
*   The Dashboard server centralizes code detection logic for consistency and easier maintenance.
*   Tampermonkey fetches from the API, ensuring a clean separation of concerns.
*   The client-side dashboard and local storage (`GM_setValue`) enable a personalized experience without relying on a backend database for individual user code history.

**Configuration Management:**
*   Environment variables (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`) are used for Telegram API credentials.
*   Source groups and the target channel are defined as constants.

**Error Handling:**
*   Employs graceful failure patterns with try-catch blocks and comprehensive console logging.
*   Includes connection retry logic for the Telegram Client.
*   Smart retry system with up to 3 attempts for failed code redemptions.

**UI/UX Decisions:**
*   The Tampermonkey script directly injects a dashboard UI into Rainbet.com, featuring a header bar and a slide-out panel for code information.
*   Visual cues like a pulsing green dot indicate active code searching.
*   Browser notifications are used to alert users of new codes with direct redemption instructions.
*   Teal/green color scheme matching the Rainbet brand.

**Technical Implementations & Feature Specifications:**
*   **Comprehensive Metadata Extraction:** The system accurately extracts all 4 code fields (value, limit, wager requirement, and timeline) from various Telegram message formats.
*   **Client-Side Dashboard:** Each user's code history and claim status are managed locally in their browser using `GM_setValue`, providing persistence across sessions.
*   **Authentication System:** A robust authentication flow (connect, verify, refresh, logout) using JWT access and rotating refresh tokens secures the Tampermonkey script's interaction with the backend, ensuring only subscribed users can claim codes.
*   **Multi-User Subscription Service:** A complete subscription system is integrated, supporting multiple Rainbet accounts per user, varied pricing tiers, and crypto payments via OxaPay with webhook handling.
*   **Payment Webhook Integration:** The OxaPay webhook handler automatically activates subscriptions, creates/updates Rainbet accounts with proper expiry dates, and sends Telegram notifications to users when payment is confirmed.
*   **30-Minute Free Trial with Abuse Prevention:** First-time users receive a 30-minute free trial. The system uses a permanent `trialHistory` collection that tracks trial usage by both Telegram ID AND username forever.
*   **Manual Code Claiming:** Users can click "⚡ Manual Code" in the header to open a dedicated popup panel for entering promo codes.
*   **Timezone Handling:** All timestamps are stored in UTC in the database. User-facing displays show human-friendly formats.

# Database Schema

**Firebase Realtime Database Collections:**
- `users`: User profiles with Telegram IDs and subscription status
- `plans`: Subscription plans with pricing and duration
- `subscriptions`: Active and pending subscriptions with payment tracking
- `rainbetAccounts`: User Rainbet accounts with expiry dates (auto-deleted after expiry)
- `trialHistory`: Permanent records of trial usage to prevent abuse (NEVER deleted)
- `authTokens`: Authentication tokens for user sessions
- `authSessions`: JWT refresh token sessions
- `codes`: Promo codes with claim status
- `claimJobs`: Code claiming job queue
- `auditLogs`: System audit trail

# External Dependencies

*   **Telegram (GramJS)**: Used for MTProto API client capabilities, handling user authentication, message events, and forwarding within Telegram.
*   **express**: The web server framework for building the Dashboard API.
*   **cors**: Enables Cross-Origin Resource Sharing for the Dashboard API.
*   **Firebase Realtime Database**: The NoSQL database used for storing user, subscription, plan, Rainbet account, and authentication token/session data.
*   **OxaPay**: A cryptocurrency payment gateway integrated for processing user subscriptions.
*   **jsonwebtoken**: JWT token generation and verification for authentication.

# Key Files

- `RainbetCodeClaimer.user.js` - Tampermonkey script for Rainbet.com
- `server/api.js` - Main Express API server
- `server/firebaseDb.js` - Firebase database helper functions
- `server/firebase.js` - Firebase Admin SDK initialization
- `server/oxapay.js` - OxaPay payment gateway integration
- `subscription-bot-v2.js` - Telegram subscription bot
- `public/index.html` - Landing page
- `scripts/cleanup-expired-accounts.js` - Cleanup script for expired accounts

# Recent Changes

## November 29, 2025 - Migration from Shuffle.com to Rainbet.com
- **Complete Platform Migration**: Converted entire codebase from Shuffle.com to Rainbet.com
- **API Changes**:
  - Changed from GraphQL (`POST /graphql`) to REST API (`POST /v1/redeem/code`)
  - Updated request body format from GraphQL mutation to simple JSON `{"code":"VALUE"}`
  - Updated error handling for Rainbet-specific error codes (e.g., `er_invalid_redeem_code`)
- **Database Schema Updates**:
  - Renamed `shuffleAccounts` collection to `rainbetAccounts`
  - Updated all related database methods (createRainbetAccount, findRainbetAccountsByUsername, etc.)
  - Updated user schema field from `shuffleUsername` to `rainbetUsername`
- **Tampermonkey Script (RainbetCodeClaimer.user.js)**:
  - Updated @match patterns for rainbet.com domains
  - Integrated Rainbet REST API for code redemption
  - Updated authentication to use Rainbet's token format
  - Updated UI branding with teal/green color scheme
- **API Server Updates**:
  - All endpoints updated to use Rainbet terminology
  - Health check now reports as 'rainbet-api-server'
  - Auth endpoints use `rainbetUsername` and `rainbetAccountId`
- **Subscription Bot Updates**:
  - Updated all messaging to reference Rainbet instead of Shuffle
  - Updated setup guide links
- **UI/Landing Page**:
  - Updated branding, colors, and messaging
  - Updated Telegram bot references
  - Updated setup guide with Rainbet-specific instructions
