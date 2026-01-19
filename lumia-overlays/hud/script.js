/**
 * TCSGO HUD Overlay - JavaScript
 * ===============================
 * Displays recent pulls, session stats, and market info
 */

(function() {
    'use strict';

    const CONFIG = {
        baseRawUrl: '',
        maxRecentPulls: 10,
        codeId: 'tcsgohud'
    };

    let state = {
        recentPulls: [],
        sessionStats: {
            opens: 0,
            spent: 0,
            bestPull: null
        },
        marketStats: {
            listings: 0,
            lastSale: null
        },
        prices: {}
    };

    // Initialize
    function init() {
        loadConfig();
        setupMessageListener();
        render();
    }

    function loadConfig() {
        if (window.overlayConfigs) {
            Object.assign(CONFIG, window.overlayConfigs);
        }
    }

    function setupMessageListener() {
        window.addEventListener('message', (event) => {
            try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                handleMessage(data);
            } catch (e) {}
        });

        document.addEventListener('overlaycontent', (event) => {
            try {
                handleMessage(event.detail || event.data);
            } catch (e) {}
        });
    }

    function handleMessage(data) {
        if (!data) return;
        if (data.codeId && data.codeId !== CONFIG.codeId) return;

        switch (data.type) {
            case 'newpull':
                addRecentPull(data.pull);
                updateSessionStats(data.stats);
                break;
            case 'statsupdate':
                updateSessionStats(data.stats);
                break;
            case 'marketupdate':
                updateMarketStats(data.market);
                break;
            case 'pricesupdate':
                updatePrices(data.prices);
                break;
            case 'fullstate':
                if (data.recentPulls) state.recentPulls = data.recentPulls.slice(0, CONFIG.maxRecentPulls);
                if (data.sessionStats) state.sessionStats = data.sessionStats;
                if (data.marketStats) state.marketStats = data.marketStats;
                if (data.prices) state.prices = data.prices;
                render();
                break;
        }
    }

    function addRecentPull(pull) {
        state.recentPulls.unshift({ ...pull, isNew: true });
        if (state.recentPulls.length > CONFIG.maxRecentPulls) {
            state.recentPulls.pop();
        }
        renderRecentPulls();
        
        // Remove "new" flag after animation
        setTimeout(() => {
            if (state.recentPulls[0]) {
                state.recentPulls[0].isNew = false;
            }
        }, 500);
    }

    function updateSessionStats(stats) {
        if (stats) {
            Object.assign(state.sessionStats, stats);
            renderSessionStats();
        }
    }

    function updateMarketStats(market) {
        if (market) {
            Object.assign(state.marketStats, market);
            renderMarketStats();
        }
    }

    function updatePrices(prices) {
        if (prices) {
            state.prices = prices;
            renderPrices();
        }
    }

    // Rendering
    function render() {
        renderRecentPulls();
        renderSessionStats();
        renderMarketStats();
        renderPrices();
    }

    function renderRecentPulls() {
        const list = document.getElementById('recent-pulls-list');
        list.innerHTML = '';

        if (state.recentPulls.length === 0) {
            list.innerHTML = '<div class="pull-item"><div class="pull-info"><div class="pull-name" style="color: var(--text-secondary);">No pulls yet...</div></div></div>';
            return;
        }

        for (const pull of state.recentPulls) {
            const item = document.createElement('div');
            item.className = `pull-item${pull.isNew ? ' new' : ''}`;

            const img = document.createElement('img');
            img.className = 'pull-image';
            img.src = pull.imageUrl || getFallbackImage();
            img.alt = '';
            img.onerror = () => { img.src = getFallbackImage(); };

            const info = document.createElement('div');
            info.className = 'pull-info';

            const name = document.createElement('div');
            name.className = 'pull-name';
            name.textContent = pull.displayName || 'Unknown Item';

            const meta = document.createElement('div');
            meta.className = 'pull-meta';

            const user = document.createElement('span');
            user.className = 'pull-user';
            user.textContent = pull.username || 'Unknown';

            const rarity = document.createElement('span');
            rarity.className = `pull-rarity rarity-${pull.rarity || 'blue'}`;
            rarity.textContent = pull.rarity || 'common';

            meta.appendChild(user);
            meta.appendChild(rarity);
            info.appendChild(name);
            info.appendChild(meta);
            item.appendChild(img);
            item.appendChild(info);
            list.appendChild(item);
        }
    }

    function renderSessionStats() {
        const s = state.sessionStats;
        document.getElementById('stat-opens').textContent = formatNumber(s.opens || 0);
        document.getElementById('stat-spent').textContent = formatNumber(s.spent || 0);
        
        const bestEl = document.getElementById('stat-best');
        if (s.bestPull) {
            bestEl.textContent = truncate(s.bestPull.displayName || 'Unknown', 15);
            bestEl.classList.add('highlight');
        } else {
            bestEl.textContent = '-';
            bestEl.classList.remove('highlight');
        }
    }

    function renderMarketStats() {
        const m = state.marketStats;
        document.getElementById('stat-listings').textContent = formatNumber(m.listings || 0);
        
        const lastEl = document.getElementById('stat-lastsale');
        if (m.lastSale) {
            lastEl.textContent = `${formatNumber(m.lastSale.price)} coins`;
        } else {
            lastEl.textContent = '-';
        }
    }

    function renderPrices() {
        const list = document.getElementById('prices-list');
        list.innerHTML = '';

        const prices = state.prices;
        if (!prices || Object.keys(prices).length === 0) {
            list.innerHTML = '<div class="price-row"><span class="price-label">Loading...</span></div>';
            return;
        }

        // Show case + key price
        if (prices.casePrice !== undefined) {
            addPriceRow(list, 'Case', `${formatNumber(prices.casePrice)} coins`);
        }
        if (prices.keyPrice !== undefined) {
            addPriceRow(list, 'Key', `${formatNumber(prices.keyPrice)} coins`);
        }
        if (prices.totalOpenCost !== undefined) {
            addPriceRow(list, 'Open Cost', `${formatNumber(prices.totalOpenCost)} coins`);
        }
    }

    function addPriceRow(container, label, value) {
        const row = document.createElement('div');
        row.className = 'price-row';
        
        const labelEl = document.createElement('span');
        labelEl.className = 'price-label';
        labelEl.textContent = label;
        
        const valueEl = document.createElement('span');
        valueEl.className = 'price-value';
        valueEl.textContent = value;
        
        row.appendChild(labelEl);
        row.appendChild(valueEl);
        container.appendChild(row);
    }

    // Utilities
    function formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function truncate(str, len) {
        return str.length > len ? str.slice(0, len) + '...' : str;
    }

    function getFallbackImage() {
        return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 38"><rect fill="%23333" width="50" height="38" rx="4"/></svg>';
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
