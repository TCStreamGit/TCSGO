/**
 * TCSGO Case Opening Controller V1
 * =================================
 * 
 * Handles chat commands, loyalty point validation, and orchestrates
 * buy/open/sell flows. Implements dual-receive reliability pattern.
 * 
 * COMMANDS PARSED:
 *   !buycase <alias> [qty]   - Buy case(s), deduct points
 *   !buykey [qty]            - Buy key(s), deduct points
 *   !open <alias>            - Open a case (no point deduction)
 *   !sell <oid>              - Start selling an item
 *   !sellconfirm <token>     - Confirm a pending sell
 * 
 * DUAL-RECEIVE:
 *   1) Primary: Overlay.on('overlaycontent', ...) event listener
 *   2) Fallback: Poll Overlay.getVariable('tcsgo_last_event_json') every 250ms
 * 
 * EVENT ROUTING:
 *   - Commands generate an eventId before calling commit commands
 *   - Router waits for matching eventId in response
 *   - Timeout after ackTimeoutMs triggers refund (for buy flows)
 */

(function () {
    'use strict';

    // =========================================================================
    // CONFIGURATION (loaded from configs.json via Lumia)
    // =========================================================================

    const DEFAULT_CONFIG = {
        // Base URL for fetching data files (if needed)
        baseRawUrl: '',

        // Polling interval for fallback receive (ms)
        pollIntervalMs: 250,

        // Timeout waiting for commit command acknowledgment (ms)
        ackTimeoutMs: 3000,

        // Market fee percent for selling
        feePercent: 10,

        // Default key price (coins)
        defaultKeyPriceCoins: 3500,

        // Overlay codeId for routing
        codeId: 'tcsgo-controller',

        // Winner card display duration (ms)
        winnerDisplayMs: 8000,

        // Toast display duration (ms)
        toastDurationMs: 5000,

        // Debug mode
        debugMode: false
    };

    let CONFIG = { ...DEFAULT_CONFIG };

    // =========================================================================
    // CACHED DATA (aliases, prices)
    // =========================================================================

    let aliasCache = null;   // case-aliases.json contents
    let pricesCache = null;  // prices.json contents

    // =========================================================================
    // EVENT ROUTING STATE
    // =========================================================================

    // Map of eventId -> { resolve, reject, timeoutId }
    const pendingEvents = new Map();

    // Last processed eventId (to ignore duplicates in polling)
    let lastProcessedEventId = null;

    // Polling interval reference
    let pollIntervalRef = null;

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    async function init() {
        log('[TCSGO Controller] Initializing...');

        // Load config from Lumia (if available)
        loadConfig();

        // Load cached data files
        await loadDataFiles();

        // Setup event listeners
        setupEventListeners();

        // Start polling fallback
        startPolling();

        log('[TCSGO Controller] Initialized successfully.');
    }

    /**
     * Load configuration from Lumia's Configs tab (window.data)
     */
    function loadConfig() {
        // Lumia injects configs via `data` global
        if (typeof data !== 'undefined' && data) {
            CONFIG = { ...DEFAULT_CONFIG, ...data };
        }
        log('[Config] Loaded:', CONFIG);
    }

    /**
     * Load alias and price data from Lumia storage or inline
     * In V1, we assume data is accessible via Overlay.getStorage or fetched
     */
    async function loadDataFiles() {
        try {
            // Try loading from Lumia persistent storage first
            const aliasJson = await safeGetStorage('tcsgo_aliases');
            if (aliasJson) {
                aliasCache = JSON.parse(aliasJson);
                log('[Data] Loaded aliases from storage:', Object.keys(aliasCache.aliases || {}).length, 'aliases');
            }

            const pricesJson = await safeGetStorage('tcsgo_prices');
            if (pricesJson) {
                pricesCache = JSON.parse(pricesJson);
                log('[Data] Loaded prices from storage');
            }

            // If not in storage and baseRawUrl is set, fetch from GitHub
            if (!aliasCache && CONFIG.baseRawUrl) {
                const resp = await fetch(`${CONFIG.baseRawUrl}/data/case-aliases.json`);
                aliasCache = await resp.json();
                log('[Data] Fetched aliases from URL');
            }

            if (!pricesCache && CONFIG.baseRawUrl) {
                const resp = await fetch(`${CONFIG.baseRawUrl}/data/prices.json`);
                pricesCache = await resp.json();
                log('[Data] Fetched prices from URL');
            }

        } catch (err) {
            log('[Data] Error loading data files:', err.message);
        }
    }

    // =========================================================================
    // EVENT LISTENERS (Dual-Receive Primary)
    // =========================================================================

    function setupEventListeners() {
        // Primary: Listen for overlaycontent events from Lumia
        if (typeof Overlay !== 'undefined' && Overlay.on) {
            Overlay.on('overlaycontent', (eventData) => {
                log('[Event] Received overlaycontent:', eventData);
                handleIncomingEvent(eventData.content);
            });

            // Also listen for chat messages to parse commands
            Overlay.on('chat', (chatData) => {
                handleChatMessage(chatData);
            });

            log('[Events] Overlay.on listeners registered');
        } else {
            log('[Events] Overlay API not available, using fallback only');
        }
    }

    // =========================================================================
    // POLLING FALLBACK (Dual-Receive Secondary)
    // =========================================================================

    function startPolling() {
        if (pollIntervalRef) return; // Already polling

        pollIntervalRef = setInterval(async () => {
            try {
                const eventJson = await safeGetVariable('tcsgo_last_event_json');
                if (eventJson && eventJson !== 'null' && eventJson !== '') {
                    handleIncomingEvent(eventJson);
                }
            } catch (err) {
                // Ignore polling errors
            }
        }, CONFIG.pollIntervalMs);

        log('[Polling] Started with interval:', CONFIG.pollIntervalMs, 'ms');
    }

    function stopPolling() {
        if (pollIntervalRef) {
            clearInterval(pollIntervalRef);
            pollIntervalRef = null;
            log('[Polling] Stopped');
        }
    }

    // =========================================================================
    // EVENT ROUTER
    // =========================================================================

    /**
     * Handle incoming event payload (from either overlaycontent or polling)
     * @param {string} payloadStr - JSON string of the event payload
     */
    function handleIncomingEvent(payloadStr) {
        if (!payloadStr) return;

        let payload;
        try {
            payload = typeof payloadStr === 'string' ? JSON.parse(payloadStr) : payloadStr;
        } catch (err) {
            log('[Router] Failed to parse payload:', err.message);
            return;
        }

        const eventId = payload.eventId || payload.data?.eventId;

        // Deduplicate: ignore if we've already processed this eventId
        if (eventId && eventId === lastProcessedEventId) {
            log('[Router] Ignoring duplicate eventId:', eventId);
            return;
        }

        if (eventId) {
            lastProcessedEventId = eventId;
        }

        log('[Router] Processing event:', payload.type, eventId || '(no eventId)');

        // Check if there's a pending promise waiting for this eventId
        if (eventId && pendingEvents.has(eventId)) {
            const pending = pendingEvents.get(eventId);
            clearTimeout(pending.timeoutId);
            pendingEvents.delete(eventId);

            if (payload.ok) {
                pending.resolve(payload);
            } else {
                pending.reject(payload);
            }
            return;
        }

        // Otherwise, handle as an unsolicited event (e.g., external trigger)
        handleUnsolicitedEvent(payload);
    }

    /**
     * Handle events not matched to a pending promise
     */
    function handleUnsolicitedEvent(payload) {
        const type = payload.type;

        switch (type) {
            case 'open-result':
                // External open triggered - show winner card
                if (payload.ok && payload.data?.winner) {
                    showWinnerCard(payload.data, payload.username || 'Unknown');
                }
                break;

            case 'buycase-result':
            case 'buykey-result':
                // External buy result - just show toast
                if (payload.ok) {
                    showToast('success', 'Purchase Complete', `${payload.data?.displayName || 'Item'} purchased.`);
                }
                break;

            case 'sell-start-result':
                if (payload.ok) {
                    const d = payload.data;
                    showToast('info', 'Sell Started', `Confirm with: !sellconfirm ${d.token} (${d.expiresInSeconds}s)`);
                }
                break;

            case 'sell-confirm-result':
                if (payload.ok) {
                    const d = payload.data;
                    showToast('success', 'Item Sold!', `+${formatNumber(d.creditedCoins)} coins. Balance: ${formatNumber(d.newBalance)}`);
                }
                break;

            default:
                log('[Router] Unhandled event type:', type);
        }
    }

    // =========================================================================
    // CHAT COMMAND PARSING
    // =========================================================================

    /**
     * Handle incoming chat message and parse for TCSGO commands
     */
    function handleChatMessage(chatData) {
        const message = (chatData.message || '').trim();
        const username = chatData.username || chatData.displayname || 'Unknown';
        const platform = chatData.platform || chatData.site || 'twitch';

        // Skip if not a command
        if (!message.startsWith('!')) return;

        const parts = message.slice(1).split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        log('[Chat] Command:', command, 'Args:', args, 'User:', username);

        switch (command) {
            case 'buycase':
                handleBuyCase(username, platform, args);
                break;

            case 'buykey':
                handleBuyKey(username, platform, args);
                break;

            case 'open':
                handleOpen(username, platform, args);
                break;

            case 'sell':
                handleSell(username, platform, args);
                break;

            case 'sellconfirm':
                handleSellConfirm(username, platform, args);
                break;

            default:
                // Not a TCSGO command, ignore
                break;
        }
    }

    // =========================================================================
    // BUY CASE FLOW
    // =========================================================================

    /**
     * !buycase <alias> [qty]
     */
    async function handleBuyCase(username, platform, args) {
        const alias = args[0];
        const qty = Math.max(1, parseInt(args[1], 10) || 1);

        if (!alias) {
            await sendChatMessage(`@${username} Usage: !buycase <alias> [qty]`);
            return;
        }

        // Resolve alias to case info
        const caseInfo = resolveAlias(alias);
        if (!caseInfo) {
            await sendChatMessage(`@${username} Unknown case: ${alias}`);
            return;
        }

        // Get case price
        const pricePerCase = getCasePrice(caseInfo.caseId);
        const totalCost = pricePerCase * qty;

        log('[BuyCase] Case:', caseInfo.displayName, 'Price:', pricePerCase, 'Qty:', qty, 'Total:', totalCost);

        // Get viewer's current points
        const currentPoints = await getLoyaltyPoints(username, platform);
        log('[BuyCase] User points:', currentPoints);

        if (currentPoints < totalCost) {
            await sendChatMessage(`@${username} Insufficient coins! Need ${formatNumber(totalCost)}, have ${formatNumber(currentPoints)}.`);
            return;
        }

        // Deduct points immediately (optimistic)
        const deducted = await addLoyaltyPoints(username, platform, -totalCost);
        log('[BuyCase] Deducted points, new balance:', deducted);

        // Generate eventId for correlation
        const eventId = generateEventId();

        // Call commit command
        try {
            const result = await callCommitCommand('tcsgo-commit-buycase', {
                eventId,
                platform,
                username,
                alias,
                qty
            }, eventId);

            // Success
            await sendChatMessage(`@${username} Bought ${qty}x ${caseInfo.displayName}! Balance: ${formatNumber(deducted)}`);
            showToast('success', 'Case Purchased', `${username} bought ${qty}x ${caseInfo.displayName}`);

        } catch (err) {
            // Failed or timeout - refund points
            log('[BuyCase] Failed, refunding:', totalCost);
            await addLoyaltyPoints(username, platform, totalCost);
            const errMsg = err?.error?.message || 'Purchase failed';
            await sendChatMessage(`@${username} ${errMsg}. Points refunded.`);
            showToast('error', 'Purchase Failed', errMsg);
        }
    }

    // =========================================================================
    // BUY KEY FLOW
    // =========================================================================

    /**
     * !buykey [qty]
     */
    async function handleBuyKey(username, platform, args) {
        const qty = Math.max(1, parseInt(args[0], 10) || 1);

        // Get key price
        const pricePerKey = getKeyPrice();
        const totalCost = pricePerKey * qty;

        log('[BuyKey] Price:', pricePerKey, 'Qty:', qty, 'Total:', totalCost);

        // Get viewer's current points
        const currentPoints = await getLoyaltyPoints(username, platform);

        if (currentPoints < totalCost) {
            await sendChatMessage(`@${username} Insufficient coins! Need ${formatNumber(totalCost)}, have ${formatNumber(currentPoints)}.`);
            return;
        }

        // Deduct points immediately
        const deducted = await addLoyaltyPoints(username, platform, -totalCost);

        // Generate eventId
        const eventId = generateEventId();

        try {
            const result = await callCommitCommand('tcsgo-commit-buykey', {
                eventId,
                platform,
                username,
                qty
            }, eventId);

            await sendChatMessage(`@${username} Bought ${qty}x Key(s)! Balance: ${formatNumber(deducted)}`);
            showToast('success', 'Keys Purchased', `${username} bought ${qty}x keys`);

        } catch (err) {
            // Refund
            log('[BuyKey] Failed, refunding:', totalCost);
            await addLoyaltyPoints(username, platform, totalCost);
            const errMsg = err?.error?.message || 'Purchase failed';
            await sendChatMessage(`@${username} ${errMsg}. Points refunded.`);
            showToast('error', 'Purchase Failed', errMsg);
        }
    }

    // =========================================================================
    // OPEN CASE FLOW
    // =========================================================================

    /**
     * !open <alias>
     * No point deduction - case/key already owned in inventory
     */
    async function handleOpen(username, platform, args) {
        const alias = args[0];

        if (!alias) {
            await sendChatMessage(`@${username} Usage: !open <alias>`);
            return;
        }

        // Resolve alias
        const caseInfo = resolveAlias(alias);
        if (!caseInfo) {
            await sendChatMessage(`@${username} Unknown case: ${alias}`);
            return;
        }

        const eventId = generateEventId();

        try {
            const result = await callCommitCommand('tcsgo-commit-open', {
                eventId,
                platform,
                username,
                alias
            }, eventId);

            // Show winner card
            if (result.ok && result.data) {
                showWinnerCard(result.data, username);

                const winner = result.data.winner;
                const stStr = winner.statTrak ? 'StatTrak™ ' : '';
                await sendChatMessage(`@${username} opened ${stStr}${winner.displayName} (${winner.wear})!`);
            }

        } catch (err) {
            const errMsg = err?.error?.message || 'Open failed';
            await sendChatMessage(`@${username} ${errMsg}`);
            showToast('error', 'Open Failed', errMsg);
        }
    }

    // =========================================================================
    // SELL FLOW
    // =========================================================================

    /**
     * !sell <oid>
     */
    async function handleSell(username, platform, args) {
        const oid = args[0];

        if (!oid) {
            await sendChatMessage(`@${username} Usage: !sell <oid>`);
            return;
        }

        const eventId = generateEventId();

        try {
            const result = await callCommitCommand('tcsgo-commit-sell-start', {
                eventId,
                platform,
                username,
                oid
            }, eventId);

            if (result.ok && result.data) {
                const d = result.data;
                const msg = `@${username} Selling ${d.item.displayName} for ${formatNumber(d.creditAmount)} coins (${d.marketFeePercent}% fee). Type: !sellconfirm ${d.token} within ${d.expiresInSeconds}s`;
                await sendChatMessage(msg);
                showToast('info', 'Confirm Sale', `!sellconfirm ${d.token}`);
            }

        } catch (err) {
            const errMsg = err?.error?.message || 'Sell failed';
            await sendChatMessage(`@${username} ${errMsg}`);
            showToast('error', 'Sell Failed', errMsg);
        }
    }

    /**
     * !sellconfirm <token>
     */
    async function handleSellConfirm(username, platform, args) {
        const token = args[0];

        if (!token) {
            await sendChatMessage(`@${username} Usage: !sellconfirm <token>`);
            return;
        }

        const eventId = generateEventId();

        try {
            const result = await callCommitCommand('tcsgo-commit-sell-confirm', {
                eventId,
                platform,
                username,
                token
            }, eventId);

            if (result.ok && result.data) {
                const d = result.data;
                // Credit loyalty points
                await addLoyaltyPoints(username, platform, d.creditedCoins);

                await sendChatMessage(`@${username} Sold ${d.item.displayName}! +${formatNumber(d.creditedCoins)} coins. Balance: ${formatNumber(d.newBalance)}`);
                showToast('success', 'Item Sold!', `+${formatNumber(d.creditedCoins)} coins`);
            }

        } catch (err) {
            const errMsg = err?.error?.message || 'Confirm failed';
            await sendChatMessage(`@${username} ${errMsg}`);
            showToast('error', 'Sell Failed', errMsg);
        }
    }

    // =========================================================================
    // COMMIT COMMAND INVOCATION
    // =========================================================================

    /**
     * Call a Lumia commit command and wait for acknowledgment
     * @param {string} commandName - e.g., 'tcsgo-commit-buycase'
     * @param {object} params - Parameters to pass to the command
     * @param {string} eventId - Event ID for correlation
     * @returns {Promise<object>} - Resolves with the ack payload or rejects on error/timeout
     */
    function callCommitCommand(commandName, params, eventId) {
        return new Promise((resolve, reject) => {
            // Setup timeout
            const timeoutId = setTimeout(() => {
                if (pendingEvents.has(eventId)) {
                    pendingEvents.delete(eventId);
                    reject({ ok: false, error: { code: 'TIMEOUT', message: 'Command timed out' } });
                }
            }, CONFIG.ackTimeoutMs);

            // Register pending event
            pendingEvents.set(eventId, { resolve, reject, timeoutId });

            // Call the command via Lumia
            if (typeof Overlay !== 'undefined' && Overlay.callCommand) {
                Overlay.callCommand(commandName, params);
                log('[Commit] Called:', commandName, 'eventId:', eventId);
            } else {
                // Fallback: reject immediately if no Overlay API
                clearTimeout(timeoutId);
                pendingEvents.delete(eventId);
                reject({ ok: false, error: { code: 'NO_OVERLAY', message: 'Overlay API unavailable' } });
            }
        });
    }

    // =========================================================================
    // WINNER CARD UI
    // =========================================================================

    /**
     * Show the winner card with item details
     */
    function showWinnerCard(resultData, username) {
        const container = document.getElementById('winner-container');
        if (!container) return;

        const winner = resultData.winner;
        const priceSnapshot = resultData.priceSnapshot || {};

        // Determine rarity class
        const rarity = normalizeRarity(winner.rarity || winner.tier);

        // Update container class
        container.className = `rarity-${rarity}`;

        // Set image
        const imgEl = document.getElementById('winner-image');
        if (imgEl) {
            imgEl.src = resultData.imagePath || '';
            imgEl.onerror = () => {
                imgEl.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 75"><rect fill="%23333" width="100" height="75"/><text fill="%23666" x="50" y="40" text-anchor="middle" font-size="10">?</text></svg>';
            };
        }

        // Set name
        const nameEl = document.getElementById('winner-name');
        if (nameEl) {
            nameEl.textContent = winner.displayName || 'Unknown Item';
        }

        // Set StatTrak badge
        const stEl = document.getElementById('winner-stattrak');
        if (stEl) {
            stEl.classList.toggle('hidden', !winner.statTrak);
        }

        // Set wear badge
        const wearEl = document.getElementById('winner-wear');
        if (wearEl) {
            wearEl.textContent = winner.wear || 'Unknown';
        }

        // Set price
        const priceEl = document.getElementById('winner-price');
        if (priceEl) {
            priceEl.innerHTML = '';
            if (priceSnapshot.chosenCoins) {
                const coinsSpan = document.createElement('span');
                coinsSpan.className = 'coins';
                coinsSpan.textContent = `${formatNumber(priceSnapshot.chosenCoins)} Coins`;
                priceEl.appendChild(coinsSpan);
            }
            if (priceSnapshot.cad) {
                const cadSpan = document.createElement('span');
                cadSpan.className = 'cad';
                cadSpan.textContent = `($${priceSnapshot.cad.toFixed(2)} CAD)`;
                priceEl.appendChild(cadSpan);
            }
        }

        // Set username
        const userEl = document.getElementById('winner-username');
        if (userEl) {
            userEl.textContent = username;
        }

        // Show container
        container.classList.remove('hidden', 'fade-out');

        // Auto-hide after duration
        setTimeout(() => {
            container.classList.add('fade-out');
            setTimeout(() => {
                container.classList.add('hidden');
            }, 400);
        }, CONFIG.winnerDisplayMs);
    }

    /**
     * Normalize rarity string to CSS class name
     */
    function normalizeRarity(rarity) {
        if (!rarity) return 'blue';
        const r = rarity.toLowerCase().replace(/[-\s]/g, '');
        const map = {
            'milspec': 'milspec',
            'mil-spec': 'milspec',
            'restricted': 'restricted',
            'classified': 'classified',
            'covert': 'covert',
            'consumer': 'consumer',
            'industrial': 'industrial',
            'extraordinary': 'gold',
            'blue': 'blue',
            'purple': 'purple',
            'pink': 'pink',
            'red': 'red',
            'gold': 'gold'
        };
        return map[r] || 'blue';
    }

    // =========================================================================
    // TOAST SYSTEM
    // =========================================================================

    /**
     * Show a toast notification
     * @param {string} type - 'success' | 'error' | 'warning' | 'info'
     * @param {string} title - Toast title
     * @param {string} message - Toast message
     */
    function showToast(type, title, message) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };

        toast.innerHTML = `
            <div class="toast-icon">${icons[type] || 'ℹ'}</div>
            <div class="toast-content">
                <div class="toast-title">${escapeHtml(title)}</div>
                <div class="toast-message">${escapeHtml(message)}</div>
            </div>
        `;

        container.appendChild(toast);

        // Auto-remove after duration
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, CONFIG.toastDurationMs);
    }

    // =========================================================================
    // HELPER: ALIAS RESOLUTION
    // =========================================================================

    /**
     * Resolve a user-provided alias to case info
     */
    function resolveAlias(alias) {
        if (!aliasCache || !aliasCache.aliases) return null;
        const key = alias.toLowerCase().trim();
        return aliasCache.aliases[key] || null;
    }

    // =========================================================================
    // HELPER: PRICE LOOKUPS
    // =========================================================================

    /**
     * Get case price in coins
     */
    function getCasePrice(caseId) {
        if (pricesCache && pricesCache.cases && pricesCache.cases[caseId] !== undefined) {
            const cadPrice = pricesCache.cases[caseId];
            const cadToCoins = pricesCache.cadToCoins || 1000;
            return Math.round(cadPrice * cadToCoins);
        }
        // Default fallback
        return 2000;
    }

    /**
     * Get key price in coins
     */
    function getKeyPrice() {
        if (pricesCache && pricesCache.keys && pricesCache.keys.default !== undefined) {
            const cadPrice = pricesCache.keys.default;
            const cadToCoins = pricesCache.cadToCoins || 1000;
            return Math.round(cadPrice * cadToCoins);
        }
        return CONFIG.defaultKeyPriceCoins;
    }

    // =========================================================================
    // HELPER: LOYALTY POINTS
    // =========================================================================

    /**
     * Get user's loyalty points
     */
    async function getLoyaltyPoints(username, platform) {
        if (typeof Overlay !== 'undefined' && Overlay.getLoyaltyPoints) {
            try {
                return await Overlay.getLoyaltyPoints({ username, platform });
            } catch (err) {
                log('[Points] getLoyaltyPoints error:', err);
                return 0;
            }
        }
        return 0;
    }

    /**
     * Add (or subtract if negative) loyalty points
     */
    async function addLoyaltyPoints(username, platform, value) {
        if (typeof Overlay !== 'undefined' && Overlay.addLoyaltyPoints) {
            try {
                return await Overlay.addLoyaltyPoints({ username, platform, value });
            } catch (err) {
                log('[Points] addLoyaltyPoints error:', err);
                return 0;
            }
        }
        return 0;
    }

    // =========================================================================
    // HELPER: CHAT MESSAGES
    // =========================================================================

    /**
     * Send a chat message via Lumia chatbot
     */
    async function sendChatMessage(message) {
        if (typeof Overlay !== 'undefined' && Overlay.chatbot) {
            try {
                await Overlay.chatbot({ message, chatAsSelf: false });
            } catch (err) {
                log('[Chat] chatbot error:', err);
            }
        } else {
            log('[Chat] (no chatbot):', message);
        }
    }

    // =========================================================================
    // HELPER: STORAGE ACCESS
    // =========================================================================

    async function safeGetStorage(key) {
        if (typeof Overlay !== 'undefined' && Overlay.getStorage) {
            try {
                return Overlay.getStorage(key);
            } catch (err) {
                return null;
            }
        }
        return null;
    }

    async function safeGetVariable(name) {
        if (typeof Overlay !== 'undefined' && Overlay.getVariable) {
            try {
                return Overlay.getVariable(name);
            } catch (err) {
                return null;
            }
        }
        return null;
    }

    // =========================================================================
    // UTILITY FUNCTIONS
    // =========================================================================

    function generateEventId() {
        const ts = Date.now().toString(36);
        const rand = Math.random().toString(36).substring(2, 8);
        return `evt_${ts}_${rand}`;
    }

    function formatNumber(num) {
        return (num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function log(...args) {
        if (CONFIG.debugMode) {
            console.log('[TCSGO]', ...args);
        }
    }

    // =========================================================================
    // STARTUP
    // =========================================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for debugging
    window.TCSGOController = {
        showToast,
        showWinnerCard,
        getConfig: () => CONFIG,
        getAliasCache: () => aliasCache,
        getPricesCache: () => pricesCache
    };

})();
