console.log("Background service worker loaded!");

const balanceCache = new Map();
const MAX_CACHE_SIZE = 128;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getAddressBalance(address) {
    const cachedEntry = balanceCache.get(address);
    if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_TTL_MS)) {
        console.log(`[Cache Hit] Balance for ${address}: ${cachedEntry.balance.toFixed(8)} BTC (from cache).`);
        return { balance: cachedEntry.balance, n_tx: cachedEntry.n_tx };
    }

    const apiUrl = `https://blockchain.info/balance?active=${address}`;
    console.log(`[Cache Miss/Stale] Making API request for ${address} from URL: ${apiUrl}`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            console.warn(`API request for ${address} timed out (10 seconds).`);
        }, 10000);

        const response = await fetch(apiUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API responded with status ${response.status}. Message: ${errorText || 'No additional message.'}`);
        }

        const data = await response.json();
        console.log(`Raw API data for ${address}:`, data);

        const addressData = data[address] || {};
        const finalBalanceSatoshis = addressData.final_balance || 0;
        const numTransactions = addressData.n_tx || 0;

        const finalBalanceBTC = finalBalanceSatoshis / 100_000_000;

        if (balanceCache.size >= MAX_CACHE_SIZE) {
            const oldestKey = balanceCache.keys().next().value;
            balanceCache.delete(oldestKey);
            console.log(`[Cache Evict] Evicted ${oldestKey} from cache to make space.`);
        }
        balanceCache.set(address, { balance: finalBalanceBTC, n_tx: numTransactions, timestamp: Date.now() });
        console.log(`[Cache Set] Balance stored for ${address}: ${finalBalanceBTC.toFixed(8)} BTC, ${numTransactions} txs.`);

        return { balance: finalBalanceBTC, n_tx: numTransactions };

    } catch (error) {
        console.error(`Error fetching balance for ${address}:`, error);
        if (error.name === 'AbortError') {
            throw new Error(`Request for ${address} timed out.`);
        }
        throw new Error(`Network or API error: ${error.message || 'Unknown error'}.`);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background script received message:", request);

    if (request.type === 'GET_BALANCE' && request.address) {
        (async () => {
            const address = request.address;
            try {
                const result = await getAddressBalance(address);
                console.log(`[sendResponse] Sending success response for ${address}:`, result);
                sendResponse({ status: 'success', balance: result.balance, address: address, n_tx: result.n_tx });
            } catch (error) {
                console.error(`[sendResponse] Sending error response for ${address}:`, error.message);
                sendResponse({ status: 'error', message: error.message, address: address });
            }
        })();

        return true;
    }
});