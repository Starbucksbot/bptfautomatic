import TradeOfferManager from 'steam-tradeoffer-manager';
import Utils from './utils.js';
import Prompts from './prompts.js';

let manager, log, Config, automatic;

export const heartbeat = async () => await sendHeartbeat();
export const register = (Automatic) => initModule(Automatic);
export const handleBuyOrdersFor = (offer) => processBuyOrders(offer);
export const handleSellOrdersFor = (offer) => processSellOrders(offer);
export const finalizeOffer = (offer) => processFinalization(offer);
export const getToken = async () => await fetchToken();
export const getApiKey = async () => await fetchApiKey();
export const exchangeCurrencies = (ours, theirs, options) => diffCurrencies(ours, theirs, options);

// Helper to initialize dependencies
const initModule = (Automatic) => {
    manager = Automatic.manager;
    log = Automatic.log;
    Config = Automatic.config;
    automatic = Automatic;
};

const fetchToken = async () => {
    const token = await Prompts.backpackToken();
    const account = Config.account();
    account.bptfToken = token;
    await Config.saveAccount(account);
    return token;
};

const fetchApiKey = async () => {
    const apiKey = await Prompts.backpackApiKey();
    const account = Config.account();
    account.bptApiKey = apiKey;
    await Config.saveAccount(account);
    return apiKey;
};

// Send a heartbeat to backpack.tf
const sendHeartbeat = async () => {
    try {
        const token = Config.account().bptfToken;
        const apiKey = Config.account().bptApiKey;

        const params = {
            method: "alive",
            token,
            i_understand_the_risks: "true",
            intent: "0",
            item_names: "1",
            automatic: "all"
        };

        if (automatic.buyOrdersEnabled() && automatic.buyOrdersEtag) {
            params.etag = automatic.buyOrdersEtag;
        }

        const [, currenciesResponse] = await Utils.postJSON({
            url: automatic.apiPath("IGetCurrencies/v1"),
            form: { key: apiKey }
        });

        if (!currenciesResponse?.currencies?.keys?.price?.value) {
            throw ['Cannot retrieve key price data.', 403];
        }
        automatic.keyPrice = currenciesResponse.currencies.keys.price.value;

        // Heartbeat
        await Utils.postJSON({
            url: automatic.apiPath("aux/heartbeat/v1"),
            form: params
        });

        const [listingsResponse] = await Utils.postJSON({
            url: automatic.apiPath("classifieds/listings/v1"),
            form: params
        });

        // Update listings and buy orders
        const updates = [];
        const currenciesChanged = JSON.stringify(automatic.listings) !== JSON.stringify(listingsResponse.listings);
        const buyOrdersChanged = updateBuyOrders(listingsResponse);

        if (listingsResponse.bumped) updates.push(`${listingsResponse.bumped} listings bumped.`);
        if (currenciesChanged) updates.push("Community currency exchange rates updated.");
        if (buyOrdersChanged.updated) {
            const additions = buyOrdersChanged.added ? `+${buyOrdersChanged.added}` : "";
            const removals = buyOrdersChanged.removed ? `-${buyOrdersChanged.removed}` : "";
            updates.push(`${additions} ${removals} buy orders updated.`);
        }

        log[updates.length ? "info" : "verbose"](`Heartbeat sent. ${updates.join(" ")}`);
        return 1000 * 95; // Return next heartbeat interval
    } catch (err) {
        const [message, statusCode, data] = err;

        if (data?.response?.message) {
            log.warn("Invalid API Key: " + data.response.message);
            return "getApiKey";
        }

        if (data?.message?.includes('access token')) {
            log.warn("Invalid Token: " + data.message);
            return "getToken";
        }

        log.warn(`Error ${statusCode || ""}: ${message}`);
        return 1000 * 60; // Retry in 1 minute
    }
};

// Update buy orders
const updateBuyOrders = (body) => {
    if (!automatic.buyOrdersEnabled() || !body.listings) return { updated: false, added: 0, removed: 0 };

    const oldOrders = automatic.buyOrders;
    const newOrders = body.listings.filter(item => item.buyout === 1 && item.intent === 0);
    automatic.buyOrdersEtag = body.etag;
    automatic.buyOrders = newOrders;

    const oldIds = oldOrders.map(listing => listing.id);
    const newIds = newOrders.map(listing => listing.id);
    const added = newIds.filter(id => !oldIds.includes(id)).length;
    const removed = oldIds.filter(id => !newIds.includes(id)).length;

    return { updated: added > 0 || removed > 0, added, removed };
};

// Process buy orders
const processBuyOrders = (offer) => {
    if (!automatic.buyOrdersEnabled() || automatic.listings.length === 0) {
        offer.items.ours = offer.exchange.ours;
        offer.items.theirs = offer.exchange.theirs;
        return;
    }

    const userItems = createUserItemDict(offer.exchange.theirs);
    if (!userItems) {
        offer.abandon({ recheck: true });
        return false;
    }

    let oursignore = [];
    let theirsignore = [];

    for (const listing of automatic.listings) {
        const indices = userItems[listing.item.defindex];
        if (!indices) continue;

        indices.forEach(index => {
            const item = offer.exchange.theirs[index];
            offer.bought.push(index);
            theirsignore.push(index);
        });
    }

    applyFilter(offer.items, 'ours', offer.exchange.ours, oursignore);
    applyFilter(offer.items, 'theirs', offer.exchange.theirs, theirsignore);
};

const applyFilter = (obj, prop, arr, filter) => {
    obj[prop] = filter.length ? arr.filter((_, index) => !filter.includes(index)) : arr;
};

const createUserItemDict = (items) => {
    const userItems = {};
    items.forEach((item, index) => {
        const defindex = item.app_data?.def_index;
        if (!defindex) return false;
        (userItems[defindex] = userItems[defindex] || []).push(index);
    });
    return userItems;
};
