console.log("Background service worker loaded!");

const GA_MEASUREMENT_ID = "G-YOUR_MEASUREMENT_ID";
const GA_API_SECRET = "YOUR_API_SECRET";

const GA_ENDPOINT = `https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`;

const balanceCache = new Map();
const MAX_CACHE_SIZE = 128;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getAddressData(address, type) {
    const cachedEntry = balanceCache.get(address);
    if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_TTL_MS) && cachedEntry.type === type) {
        console.log(`[Cache Hit] Data for ${address} (${type}): ${cachedEntry.balance.toFixed(8)} ${type.toUpperCase()} (from cache).`);
        return { balance: cachedEntry.balance, n_tx: cachedEntry.n_tx, type: cachedEntry.type };
    }

    let apiUrl;
    let finalBalanceSatoshis;
    let numTransactions;
    let finalBalanceCrypto; // Balance in BTC or ETH

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            console.warn(`API request for ${address} (${type}) timed out (10 seconds).`);
        }, 10000);

        if (type === 'bitcoin') {
            apiUrl = `https://blockchain.info/balance?active=${address}`;
        } else if (type === 'ethereum') {
            apiUrl = `https://api.blockcypher.com/v1/eth/main/addrs/${address}/balance`;
        } else {
            throw new Error("Unsupported address type.");
        }

        console.log(`[Cache Miss/Stale] Making API request for ${address} (${type}) from URL: ${apiUrl}`);

        const response = await fetch(apiUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API responded with status ${response.status}. Message: ${errorText || 'No additional message.'}`);
        }

        const data = await response.json();
        console.log(`Raw API data for ${address} (${type}):`, data);

        if (type === 'bitcoin') {
            const addressData = data[address] || {};
            finalBalanceSatoshis = addressData.final_balance || 0;
            numTransactions = addressData.n_tx || 0;
            finalBalanceCrypto = finalBalanceSatoshis / 100_000_000; // Convert satoshis to BTC
        } else if (type === 'ethereum') {
            // Blockcypher returns balance in Wei and n_tx directly
            const balanceWei = data.balance || 0;
            numTransactions = data.n_tx || 0;
            finalBalanceCrypto = balanceWei / 1e18; // Convert Wei to ETH (1 ETH = 10^18 Wei)
        }

        if (balanceCache.size >= MAX_CACHE_SIZE) {
            const oldestKey = balanceCache.keys().next().value;
            balanceCache.delete(oldestKey);
            console.log(`[Cache Evict] Evicted ${oldestKey} from cache to make space.`);
        }
        balanceCache.set(address, { balance: finalBalanceCrypto, n_tx: numTransactions, type: type, timestamp: Date.now() });
        console.log(`[Cache Set] Data stored for ${address} (${type}): ${finalBalanceCrypto.toFixed(8)} ${type.toUpperCase()}, ${numTransactions} txs.`);

        return { balance: finalBalanceCrypto, n_tx: numTransactions, type: type };

    } catch (error) {
        console.error(`Error fetching data for ${address} (${type}):`, error);
        if (error.name === 'AbortError') {
            throw new Error(`Request for ${address} timed out.`);
        }
        throw new Error(`Network or API error: ${error.message || 'Unknown error'}.`);
    }
}

async function getOrCreateClientId() {
    let { client_id } = await chrome.storage.local.get('client_id');
    if (!client_id) {
        client_id = crypto.randomUUID();
        await chrome.storage.local.set({ client_id });
    }
    return client_id;
}

async function getOrCreateSessionInfo() {
    let { session_id, session_start_timestamp, session_number } = await chrome.storage.local.get(['session_id', 'session_start_timestamp', 'session_number']);

    const now = Date.now();
    const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

    if (!session_id || !session_start_timestamp || (now - session_start_timestamp > SESSION_TIMEOUT_MS)) {
        session_id = now.toString();
        session_start_timestamp = now;
        session_number = (session_number || 0) + 1;
        await chrome.storage.local.set({ session_id, session_start_timestamp, session_number });
    } else {
        await chrome.storage.local.set({ session_start_timestamp: now });
    }
    return { session_id, session_number };
}

async function sendGA4Event(eventName, eventParams = {}) {
    try {
        const client_id = await getOrCreateClientId();
        const { session_id, session_number } = await getOrCreateSessionInfo();

        const payload = {
            client_id: client_id,
            events: [{
                name: eventName,
                params: {
                    ...eventParams,
                    session_id: session_id,
                    engagement_time_msec: 100,
                    session_number: session_number
                }
            }]
        };

        const response = await fetch(GA_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to send GA4 event ${eventName}: ${response.status} - ${errorText}`);
        } else {
            console.log(`GA4 event '${eventName}' sent successfully.`);
        }
    } catch (error) {
        console.error(`Error sending GA4 event ${eventName}:`, error);
    }
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        sendGA4Event('first_open');
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background script received message:", request);

    if (request.type === 'GET_BALANCE' && request.address && request.addressType) {
        (async () => {
            const address = request.address;
            const type = request.addressType;
            try {
                const result = await getAddressData(address, type);
                console.log(`[sendResponse] Sending success response for ${address} (${type}):`, result);
                sendResponse({ status: 'success', balance: result.balance, address: address, n_tx: result.n_tx, type: result.type });
            } catch (error) {
                console.error(`[sendResponse] Sending error response for ${address} (${type}):`, error.message);
                sendResponse({ status: 'error', message: error.message, address: address, type: type });
            }
        })();
        return true;
    } else if (request.type === 'ANALYTICS_EVENT') {
        sendGA4Event(request.eventName, request.eventParams);
    }
});
