console.log("Background service worker loaded!");

const balanceCache = new Map();
const cryptoPriceCache = new Map();

const MAX_CACHE_SIZE = 128;
const CACHE_TTL_MS = 5 * 60 * 1000;
const PRICE_CACHE_TTL_MS = 1 * 60 * 1000;

async function getCryptoPriceInUSD(coinId) {
    const cachedPrice = cryptoPriceCache.get(coinId);
    if (cachedPrice && (Date.now() - cachedPrice.timestamp < PRICE_CACHE_TTL_MS)) {
        console.log(`[Price Cache Hit] Price for ${coinId}: $${cachedPrice.price} (from cache).`);
        return cachedPrice.price;
    }

    const priceApiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
    console.log(`[Price Cache Miss/Stale] Fetching price for ${coinId} from: ${priceApiUrl}`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            console.warn(`Price API request for ${coinId} timed out (5 seconds).`);
        }, 5000);

        const response = await fetch(priceApiUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Price API responded with status ${response.status}. Message: ${errorText || 'No additional message.'}`);
        }

        const data = await response.json();
        const price = data[coinId]?.usd;

        if (typeof price === 'number') {
            cryptoPriceCache.set(coinId, { price: price, timestamp: Date.now() });
            console.log(`[Price Cache Set] Price stored for ${coinId}: $${price}.`);
            return price;
        } else {
            throw new Error(`Price data for ${coinId} not found in API response.`);
        }
    } catch (error) {
        console.error(`Error fetching price for ${coinId}:`, error);
        if (error.name === 'AbortError') {
            throw new Error(`Price request for ${coinId} timed out.`);
        }
        throw new Error(`Network or Price API error for ${coinId}: ${error.message || 'Unknown error'}.`);
    }
}

async function getAddressData(address, type) {
    const cachedEntry = balanceCache.get(address);
    if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_TTL_MS) && cachedEntry.type === type) {
        console.log(`[Balance Cache Hit] Data for ${address} (${type}): ${cachedEntry.balance.toFixed(8)} ${cachedEntry.currencySymbol} (from cache).`);
        return { balance: cachedEntry.balance, n_tx: cachedEntry.n_tx, type: cachedEntry.type, usdValue: cachedEntry.usdValue, currencySymbol: cachedEntry.currencySymbol };
    }

    let apiUrl;
    let finalBalanceCrypto;
    let numTransactions;
    let coinId;
    let currencySymbol;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            console.warn(`Address API request for ${address} (${type}) timed out (10 seconds).`);
        }, 10000);

        if (type === 'bitcoin') {
            apiUrl = `https://blockchain.info/balance?active=${address}`;
            coinId = 'bitcoin';
            currencySymbol = 'BTC';
        } else if (type === 'ethereum') {
            apiUrl = `https://api.blockcypher.com/v1/eth/main/addrs/${address}/balance`;
            coinId = 'ethereum';
            currencySymbol = 'ETH';
        } else if (type === 'bitcoincash') {
            const cleanAddress = address.startsWith('bitcoincash:') ? address.substring(12) : address;
            apiUrl = `https://api.blockchair.com/bitcoin-cash/dashboards/address/${cleanAddress}`;
            coinId = 'bitcoin-cash';
            currencySymbol = 'BCH';
        } else {
            throw new Error("Unsupported address type.");
        }

        console.log(`[Balance Cache Miss/Stale] Making API request for ${address} (${type}) from URL: ${apiUrl}`);

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
            const finalBalanceSatoshis = addressData.final_balance || 0;
            numTransactions = addressData.n_tx || 0;
            finalBalanceCrypto = finalBalanceSatoshis / 100_000_000;
        } else if (type === 'ethereum') {
            const balanceWei = data.balance || 0;
            numTransactions = data.n_tx || 0;
            finalBalanceCrypto = balanceWei / 1e18;
        } else if (type === 'bitcoincash') {
            const cleanAddressKey = address.startsWith('bitcoincash:') ? address.substring(12) : address;
            const addressData = data.data?.[cleanAddressKey]?.address;
            const finalBalanceSatoshis = addressData?.balance || 0;
            numTransactions = addressData?.transaction_count || 0;
            finalBalanceCrypto = finalBalanceSatoshis / 100_000_000;
        }

        const usdPrice = await getCryptoPriceInUSD(coinId);
        const usdValue = finalBalanceCrypto * usdPrice;

        if (balanceCache.size >= MAX_CACHE_SIZE) {
            const oldestKey = balanceCache.keys().next().value;
            balanceCache.delete(oldestKey);
            console.log(`[Balance Cache Evict] Evicted ${oldestKey} from cache to make space.`);
        }
        balanceCache.set(address, { balance: finalBalanceCrypto, n_tx: numTransactions, type: type, usdValue: usdValue, currencySymbol: currencySymbol, timestamp: Date.now() });
        console.log(`[Balance Cache Set] Data stored for ${address} (${type}): ${finalBalanceCrypto.toFixed(8)} ${currencySymbol}, $${usdValue.toFixed(2)}, ${numTransactions} txs.`);

        return { balance: finalBalanceCrypto, n_tx: numTransactions, type: type, usdValue: usdValue, currencySymbol: currencySymbol };

    } catch (error) {
        console.error(`Error fetching data for ${address} (${type}):`, error);
        if (error.name === 'AbortError') {
            throw new Error(`Request for ${address} timed out.`);
        }
        throw new Error(`Network or API error for ${address} (${type}): ${error.message || 'Unknown error'}.`);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background script received message:", request);

    if (request.type === 'GET_BALANCE' && request.address && request.addressType) {
        (async () => {
            const address = request.address;
            const type = request.addressType;
            try {
                const result = await getAddressData(address, type);
                console.log(`[sendResponse] Sending success response for ${address} (${type}):`, result);
                sendResponse({ status: 'success', balance: result.balance, address: address, n_tx: result.n_tx, type: result.type, usdValue: result.usdValue, currencySymbol: result.currencySymbol });
            } catch (error) {
                console.error(`[sendResponse] Sending error response for ${address} (${type}):`, error.message);
                sendResponse({ status: 'error', message: error.message, address: address, type: type });
            }
        })();
        return true;
    }
});
