/**
 * TCSGO Case Opening Overlay - JavaScript
 * ========================================
 * Handles the animated case opening reel and reveal
 */

(function() {
    'use strict';

    // =========================
    // CONFIGURATION
    // =========================
    
    const CONFIG = {
        // GitHub raw URL base (set from Configs tab)
        baseRawUrl: '',
        
        // Animation settings
        reelCardCount: 60,          // Total cards in reel
        winnerPosition: 52,         // Where winner is placed (near end)
        cardWidth: 160,             // Card width in pixels
        cardGap: 8,                 // Gap between cards
        spinDuration: 6000,         // Total spin time in ms
        revealDelay: 500,           // Delay before reveal after spin
        revealDuration: 8000,       // How long reveal shows
        
        // Sound settings
        tickVolume: 0.3,
        revealVolume: 0.5,
        rareVolume: 0.7,
        goldVolume: 0.8,
        
        // Audio pool size (for rapid ticks)
        audioPoolSize: 5,
        
        // Debug mode
        debugMode: false,
        forceRarity: null,          // Set to 'gold' to test gold pulls
        
        // Lumia message routing
        codeId: 'tcsgocaseopen'
    };

    // =========================
    // STATE
    // =========================
    
    let state = {
        isAnimating: false,
        currentContainer: null,
        assetManifest: null,
        audioPool: [],
        audioPoolIndex: 0
    };

    // =========================
    // RARITY MAPPINGS
    // =========================
    
    const STANDARD_RARITIES = ['blue', 'purple', 'pink', 'red', 'gold'];
    const COLLECTION_RARITIES = ['consumer', 'industrial', 'milspec', 'restricted', 'classified', 'covert'];
    
    const RARITY_DISPLAY = {
        blue: 'Mil-Spec',
        purple: 'Restricted',
        pink: 'Classified',
        red: 'Covert',
        gold: 'Rare Special Item',
        consumer: 'Consumer Grade',
        industrial: 'Industrial Grade',
        milspec: 'Mil-Spec',
        restricted: 'Restricted',
        classified: 'Classified',
        covert: 'Covert'
    };

    // =========================
    // WEAR TABLE
    // =========================
    
    const WEAR_TABLE = [
        { name: 'Factory New', weight: 3 },
        { name: 'Minimal Wear', weight: 24 },
        { name: 'Field-Tested', weight: 33 },
        { name: 'Well-Worn', weight: 24 },
        { name: 'Battle-Scarred', weight: 16 }
    ];
    const WEAR_TOTAL = WEAR_TABLE.reduce((s, w) => s + w.weight, 0);

    // =========================
    // INITIALIZATION
    // =========================
    
    function init() {
        // Load config from Lumia Configs tab
        loadConfig();
        
        // Setup audio pool
        setupAudioPool();
        
        // Listen for Lumia messages
        setupMessageListener();
        
        log('TCSGO Case Opening Overlay initialized');
    }

    function loadConfig() {
        // Lumia injects window.overlayConfigs from the Configs tab
        if (window.overlayConfigs) {
            Object.assign(CONFIG, window.overlayConfigs);
        }
        
        // Also check for overlayData
        if (window.overlayData) {
            // Data tab content available here
        }
    }

    function setupAudioPool() {
        const pool = document.getElementById('audio-pool');
        if (!pool || !CONFIG.baseRawUrl) return;
        
        // Create pool of tick audio elements
        for (let i = 0; i < CONFIG.audioPoolSize; i++) {
            const audio = document.createElement('audio');
            audio.preload = 'auto';
            audio.volume = CONFIG.tickVolume;
            pool.appendChild(audio);
            state.audioPool.push(audio);
        }
    }

    function loadSound(type) {
        const manifest = state.assetManifest;
        if (!manifest || !manifest.sounds || !manifest.sounds[type]) return null;
        
        const url = `${CONFIG.baseRawUrl}/${manifest.sounds[type]}`;
        const audio = new Audio(url);
        audio.preload = 'auto';
        return audio;
    }

    // =========================
    // MESSAGE LISTENER
    // =========================
    
    function setupMessageListener() {
        // Lumia Custom Overlay messaging
        window.addEventListener('message', (event) => {
            try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                handleMessage(data);
            } catch (e) {
                // Not a JSON message, ignore
            }
        });
        
        // Also listen for overlaycontent events (Lumia specific)
        document.addEventListener('overlaycontent', (event) => {
            try {
                const data = event.detail || event.data;
                handleMessage(data);
            } catch (e) {
                log('Error handling overlaycontent:', e);
            }
        });
    }

    function handleMessage(data) {
        if (!data) return;
        
        // Check codeId for routing
        if (data.codeId && data.codeId !== CONFIG.codeId) return;
        
        // Handle different message types
        if (data.type === 'caseopen' || data.action === 'caseopen') {
            handleCaseOpen(data);
        } else if (data.type === 'test') {
            runTestAnimation();
        }
    }

    // =========================
    // CASE OPEN HANDLER
    // =========================
    
    async function handleCaseOpen(data) {
        if (state.isAnimating) {
            log('Animation already in progress, ignoring');
            return;
        }
        
        state.isAnimating = true;
        
        try {
            const {
                username,
                containerId,
                containerData,
                winnerItem,
                statTrak,
                wear,
                priceCoins,
                priceCAD
            } = data;
            
            // Load asset manifest if not loaded
            if (!state.assetManifest) {
                await loadAssetManifest();
            }
            
            // Use provided container data or load it
            let container = containerData;
            if (!container && containerId) {
                container = await loadContainer(containerId);
            }
            
            if (!container) {
                log('No container data available');
                state.isAnimating = false;
                return;
            }
            
            state.currentContainer = container;
            
            // Build the reel
            const reelItems = buildReel(container, winnerItem);
            
            // Render the reel
            renderReel(reelItems);
            
            // Show the overlay
            showOverlay();
            
            // Start the animation
            await animateReel(winnerItem, username, statTrak, wear, priceCoins, priceCAD);
            
        } catch (error) {
            log('Error during case open:', error);
        } finally {
            state.isAnimating = false;
        }
    }

    // =========================
    // DATA LOADING
    // =========================
    
    async function loadAssetManifest() {
        try {
            const url = `${CONFIG.baseRawUrl}/assets/asset-manifest.json`;
            const response = await fetch(url);
            state.assetManifest = await response.json();
            log('Asset manifest loaded');
        } catch (error) {
            log('Failed to load asset manifest:', error);
        }
    }

    async function loadContainer(containerId) {
        try {
            // Try loading from Case-Odds folder (matches repo structure)
            const filename = containerId.split('-').map((w, i) => 
                w.charAt(0).toUpperCase() + w.slice(1)
            ).join('_') + '.json';
            
            const url = `${CONFIG.baseRawUrl}/Case-Odds/${filename}`;
            const response = await fetch(url);
            return await response.json();
        } catch (error) {
            log('Failed to load container:', error);
            return null;
        }
    }

    // =========================
    // REEL BUILDING
    // =========================
    
    function buildReel(container, winnerItem) {
        const items = [];
        const caseData = container.case || container;
        const allItems = getAllItemsFromContainer(caseData);
        
        // Fill reel with random items
        for (let i = 0; i < CONFIG.reelCardCount; i++) {
            if (i === CONFIG.winnerPosition) {
                // Insert the winner at the designated position
                items.push({
                    ...winnerItem,
                    isWinner: true
                });
            } else {
                // Pick a random item weighted by tier odds
                const randomItem = pickRandomItem(caseData, allItems);
                items.push(randomItem);
            }
        }
        
        return items;
    }

    function getAllItemsFromContainer(caseData) {
        const items = [];
        const tiers = caseData.tiers || {};
        
        // Collect items from all tiers
        for (const [tierName, tierItems] of Object.entries(tiers)) {
            if (Array.isArray(tierItems)) {
                for (const item of tierItems) {
                    items.push({ ...item, tier: tierName });
                }
            }
        }
        
        // Collect items from gold pool if present
        if (caseData.goldPool && caseData.goldPool !== 'None' && caseData.goldPool.items) {
            for (const item of caseData.goldPool.items) {
                items.push({ ...item, tier: 'gold' });
            }
        }
        
        return items;
    }

    function pickRandomItem(caseData, allItems) {
        const oddsWeights = caseData.oddsWeights || {};
        const tiers = caseData.tiers || {};
        
        // Build tier weights array
        const tierWeights = [];
        for (const [tierName, weight] of Object.entries(oddsWeights)) {
            if (weight > 0) {
                tierWeights.push({ tier: tierName, weight: Number(weight) });
            }
        }
        
        // Pick a tier
        const totalTierWeight = tierWeights.reduce((s, t) => s + t.weight, 0);
        let roll = Math.random() * totalTierWeight;
        let selectedTier = tierWeights[0].tier;
        
        for (const tw of tierWeights) {
            roll -= tw.weight;
            if (roll <= 0) {
                selectedTier = tw.tier;
                break;
            }
        }
        
        // Get items from selected tier
        let tierItems = [];
        if (selectedTier === 'gold' && caseData.goldPool && caseData.goldPool.items) {
            tierItems = caseData.goldPool.items.map(i => ({ ...i, tier: 'gold' }));
        } else if (tiers[selectedTier]) {
            tierItems = tiers[selectedTier].map(i => ({ ...i, tier: selectedTier }));
        }
        
        // Pick random item from tier
        if (tierItems.length === 0) {
            // Fallback to any item
            return allItems[Math.floor(Math.random() * allItems.length)];
        }
        
        return tierItems[Math.floor(Math.random() * tierItems.length)];
    }

    // =========================
    // REEL RENDERING
    // =========================
    
    function renderReel(items) {
        const track = document.getElementById('reel-track');
        track.innerHTML = '';
        
        for (const item of items) {
            const card = createReelCard(item);
            track.appendChild(card);
        }
    }

    function createReelCard(item) {
        const card = document.createElement('div');
        card.className = `reel-card rarity-${item.tier || getRarityFromItem(item)}`;
        
        if (item.isWinner) {
            card.dataset.winner = 'true';
        }
        
        // Image
        const img = document.createElement('img');
        img.className = 'reel-card-image';
        img.src = resolveItemImage(item);
        img.alt = item.displayName || '';
        img.onerror = () => { img.src = getFallbackImage(); };
        card.appendChild(img);
        
        // Name
        const name = document.createElement('div');
        name.className = 'reel-card-name';
        name.textContent = item.displayName || item.itemId || 'Unknown';
        card.appendChild(name);
        
        return card;
    }

    function getRarityFromItem(item) {
        if (item.tier) return item.tier;
        
        const rarity = (item.rarity || '').toLowerCase();
        
        // Map rarity names to tier colors
        const rarityMap = {
            'mil-spec': 'blue',
            'milspec': 'milspec',
            'restricted': 'purple',
            'classified': 'pink',
            'covert': 'red',
            'extraordinary': 'gold',
            'consumer': 'consumer',
            'industrial': 'industrial'
        };
        
        return rarityMap[rarity] || 'blue';
    }

    // =========================
    // IMAGE RESOLUTION
    // =========================
    
    function resolveItemImage(item) {
        const manifest = state.assetManifest;
        if (!manifest || !CONFIG.baseRawUrl) return getFallbackImage();
        
        const container = state.currentContainer;
        const caseId = container?.case?.id || '';
        
        // Check for explicit glove mapping
        if (item.category === 'gloves' && manifest.gloveImageMap && manifest.gloveImageMap[item.itemId]) {
            const caseFolder = manifest.caseFolderMap?.[caseId] || '';
            return `${CONFIG.baseRawUrl}/${caseFolder}/Weapons/${manifest.gloveImageMap[item.itemId]}`;
        }
        
        // Standard resolution: displayName to filename
        const caseFolder = manifest.caseFolderMap?.[caseId] || '';
        const subfolder = (item.category === 'knife') ? 'Knives' : 'Weapons';
        
        let filename = item.displayName || item.itemId || '';
        
        // Remove star prefix from knife names
        filename = filename.replace(/^★\s*/, '');
        
        // Handle Doppler variants
        if (item.variant && item.variant !== 'None' && manifest.dopplerPhaseMap) {
            const suffix = manifest.dopplerPhaseMap[item.variant];
            if (suffix) {
                // For Doppler phases, append the suffix
                const baseName = filename.replace(` (${item.variant})`, '');
                filename = `${baseName}${suffix}`;
            }
        }
        
        filename = `${filename}.png`;
        
        return `${CONFIG.baseRawUrl}/${caseFolder}/${subfolder}/${encodeURIComponent(filename)}`;
    }

    function getFallbackImage() {
        return state.assetManifest?.fallbackImage 
            ? `${CONFIG.baseRawUrl}/${state.assetManifest.fallbackImage}`
            : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23333" width="100" height="100"/><text fill="%23666" x="50" y="55" text-anchor="middle" font-size="12">?</text></svg>';
    }

    // =========================
    // ANIMATION
    // =========================
    
    function showOverlay() {
        const container = document.getElementById('tcsgo-container');
        container.classList.remove('hidden');
        
        const revealPanel = document.getElementById('reveal-panel');
        revealPanel.classList.add('hidden');
    }

    function hideOverlay() {
        const container = document.getElementById('tcsgo-container');
        container.classList.add('hidden');
    }

    async function animateReel(winnerItem, username, statTrak, wear, priceCoins, priceCAD) {
        const track = document.getElementById('reel-track');
        const viewport = document.getElementById('reel-viewport');
        
        // Calculate positions
        const cardTotalWidth = CONFIG.cardWidth + CONFIG.cardGap;
        const viewportCenter = viewport.offsetWidth / 2;
        
        // Final position: winner card center aligned with marker
        const winnerOffset = CONFIG.winnerPosition * cardTotalWidth;
        const finalX = -(winnerOffset - viewportCenter + CONFIG.cardWidth / 2);
        
        // Starting position (off to the right)
        const startX = 100;
        
        // Set initial position
        track.style.transition = 'none';
        track.style.transform = `translate3d(${startX}px, 0, 0)`;
        
        // Force reflow
        track.offsetHeight;
        
        // Load tick sound
        const tickUrl = state.assetManifest?.sounds?.tick 
            ? `${CONFIG.baseRawUrl}/${state.assetManifest.sounds.tick}`
            : null;
        
        // Setup tick sound pool
        if (tickUrl) {
            for (const audio of state.audioPool) {
                audio.src = tickUrl;
                audio.load();
            }
        }
        
        // Start animation with custom easing
        return new Promise((resolve) => {
            const startTime = performance.now();
            const duration = CONFIG.spinDuration;
            let lastTickCard = -1;
            
            function animate(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Custom easing: fast start, slow end (cubic-out with extra slow-down)
                const eased = 1 - Math.pow(1 - progress, 4);
                
                // Calculate current position
                const currentX = startX + (finalX - startX) * eased;
                track.style.transform = `translate3d(${currentX}px, 0, 0)`;
                
                // Calculate which card is at the marker
                const markerX = viewportCenter;
                const trackOffset = -currentX;
                const cardAtMarker = Math.floor((trackOffset + markerX) / cardTotalWidth);
                
                // Play tick when crossing card boundaries
                if (cardAtMarker !== lastTickCard && cardAtMarker >= 0) {
                    playTick();
                    lastTickCard = cardAtMarker;
                }
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // Animation complete
                    setTimeout(() => {
                        showReveal(winnerItem, username, statTrak, wear, priceCoins, priceCAD);
                        resolve();
                    }, CONFIG.revealDelay);
                }
            }
            
            requestAnimationFrame(animate);
        });
    }

    function playTick() {
        if (state.audioPool.length === 0) return;
        
        const audio = state.audioPool[state.audioPoolIndex];
        state.audioPoolIndex = (state.audioPoolIndex + 1) % state.audioPool.length;
        
        audio.currentTime = 0;
        audio.volume = CONFIG.tickVolume;
        audio.play().catch(() => {});
    }

    // =========================
    // REVEAL PANEL
    // =========================
    
    function showReveal(item, username, statTrak, wear, priceCoins, priceCAD) {
        const panel = document.getElementById('reveal-panel');
        const rarity = item.tier || getRarityFromItem(item);
        
        // Set rarity class
        panel.className = `rarity-${rarity}`;
        
        // Set image
        const img = document.getElementById('reveal-image');
        img.src = resolveItemImage(item);
        img.onerror = () => { img.src = getFallbackImage(); };
        
        // Set name
        const nameEl = document.getElementById('reveal-name');
        nameEl.textContent = item.displayName || item.itemId || 'Unknown Item';
        
        // Set StatTrak badge
        const stEl = document.getElementById('reveal-stattrak');
        if (statTrak) {
            stEl.classList.remove('hidden');
        } else {
            stEl.classList.add('hidden');
        }
        
        // Set wear badge
        const wearEl = document.getElementById('reveal-wear');
        wearEl.textContent = wear || rollWear();
        
        // Set price
        const priceEl = document.getElementById('reveal-price');
        priceEl.innerHTML = '';
        if (priceCoins) {
            const coinsSpan = document.createElement('span');
            coinsSpan.className = 'coins';
            coinsSpan.textContent = `${formatNumber(priceCoins)} Coins`;
            priceEl.appendChild(coinsSpan);
        }
        if (priceCAD) {
            const cadSpan = document.createElement('span');
            cadSpan.className = 'cad';
            cadSpan.textContent = `($${priceCAD.toFixed(2)} CAD)`;
            priceEl.appendChild(cadSpan);
        }
        
        // Set username
        const userEl = document.getElementById('reveal-username');
        userEl.textContent = username || '';
        
        // Play reveal sound
        playRevealSound(rarity);
        
        // Create particles
        createParticles(rarity);
        
        // Show panel
        panel.classList.remove('hidden');
        
        // Hide after duration
        setTimeout(() => {
            panel.classList.add('hidden');
            hideOverlay();
        }, CONFIG.revealDuration);
    }

    function rollWear() {
        let roll = Math.random() * WEAR_TOTAL;
        for (const w of WEAR_TABLE) {
            roll -= w.weight;
            if (roll <= 0) return w.name;
        }
        return WEAR_TABLE[0].name;
    }

    function playRevealSound(rarity) {
        let soundType = 'reveal';
        
        if (rarity === 'gold') {
            soundType = 'goldReveal';
        } else if (['pink', 'red', 'classified', 'covert'].includes(rarity)) {
            soundType = 'rare';
        }
        
        const audio = loadSound(soundType);
        if (audio) {
            audio.volume = rarity === 'gold' ? CONFIG.goldVolume : 
                          soundType === 'rare' ? CONFIG.rareVolume : CONFIG.revealVolume;
            audio.play().catch(() => {});
        }
    }

    function createParticles(rarity) {
        const container = document.getElementById('reveal-particles');
        container.innerHTML = '';
        
        // Skip particles for common rarities
        if (['blue', 'consumer', 'industrial'].includes(rarity)) return;
        
        const color = getComputedStyle(document.documentElement)
            .getPropertyValue(`--rarity-${rarity}`).trim() || '#fff';
        
        const particleCount = rarity === 'gold' ? 50 : 30;
        
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.backgroundColor = color;
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.animationDelay = `${Math.random() * 2}s`;
            particle.style.animationDuration = `${2 + Math.random() * 2}s`;
            container.appendChild(particle);
        }
    }

    // =========================
    // UTILITY FUNCTIONS
    // =========================
    
    function formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function log(...args) {
        if (CONFIG.debugMode) {
            console.log('[TCSGO]', ...args);
        }
    }

    // =========================
    // TEST MODE
    // =========================
    
    async function runTestAnimation() {
        // Test data for debugging
        const testData = {
            username: 'TestUser',
            containerId: 'chroma-2-case',
            winnerItem: {
                itemId: 'm4a1-s-hyper-beast',
                displayName: 'M4A1-S | Hyper Beast',
                tier: CONFIG.forceRarity || 'red',
                category: 'weapon',
                rarity: 'covert'
            },
            statTrak: true,
            wear: 'Factory New',
            priceCoins: 15000,
            priceCAD: 45.50
        };
        
        await handleCaseOpen(testData);
    }

    // =========================
    // STARTUP
    // =========================
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose test function for debugging
    window.TCSGOTest = runTestAnimation;

})();
