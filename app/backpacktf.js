const TradeOfferManager = require('steam-tradeoffer-manager');
const AutomaticOffer = require('./automatic-offer');
const Utils = require('./utils');
const Prompts = require('./prompts');
const fs = require('fs/promises'); // Using promises for fs operations

let manager, log, Config, automatic, community;

exports.heartbeat = heartbeat;
exports.register = register;
exports.handleBuyOrdersFor = handleBuyOrdersFor;
exports.handleSellOrdersFor = handleSellOrdersFor;
exports.finalizeOffer = finalizeOffer;
exports.getToken = getToken;
exports.getApiKey = getApiKey;
exports.exchangeCurrencies = exchangeCurrencies;
exports.handleSellOrder = handleSellOrder;

function register(Automatic) {
    manager = Automatic.manager;
    log = Automatic.log;
    Config = Automatic.config;
    community = Automatic.steam;
    automatic = Automatic;
}

let offerSummaries = {};

async function getToken() {
    const token = await Prompts.backpackToken();
    const acc = Config.account();
    acc.bptfToken = token;
    await Config.saveAccount(acc);
    return token;
}

async function getApiKey() {
    const apikey = await Prompts.backpackApiKey();
    const acc = Config.account();
    acc.bptApiKey = apikey;
    await Config.saveAccount(acc);
    return apikey;
}

function updateBuyOrders(body) {
    if (!automatic.buyOrdersEnabled() || !body.listings) {
        return {updated: false, added: 0, removed: 0};
    }

    const oldOrders = automatic.buyOrders || [];
    const newOrders = body.listings.filter(item => item.buyout === 1 && item.intent === 0);
    automatic.buyOrdersEtag = body.etag;
    automatic.buyOrders = newOrders;

    const oldIds = oldOrders.map(listing => listing.id);
    const newIds = newOrders.map(listing => listing.id);
    let added = 0, removed = 0;

    oldIds.forEach(id => { if (newIds.indexOf(id) === -1) removed += 1; });
    newIds.forEach(id => { if (oldIds.indexOf(id) === -1) added += 1; });

    return {updated: added > 0 || removed > 0, added, removed};
}

async function heartbeat() {
    try {
        const {bptfToken: token, bptApiKey: apiKey} = Config.account();
        const boEnabled = automatic.buyOrdersEnabled();
        const etag = automatic.buyOrdersEtag;

        let params = {
            method: "alive",
            token,
            i_understand_the_risks: "true",
            intent: "0",
            item_names: "1",
            automatic: "all"
        };
        
        if (boEnabled && etag) params.etag = etag;

        const [resp, resp2] = await Utils.postJSON({
            url: automatic.apiPath("IGetCurrencies/v1"),
            checkResponse: true,
            form: {key: apiKey}
        });

        if (!resp2?.currencies?.keys?.price?.value) throw ["Cannot get keys data", 403];

        automatic.keyPrice = resp2.currencies.keys.price.value;

        await Utils.postJSON2({
            url: automatic.apiPath("aux/heartbeat/v1"),
            form: params
        });

        const [body] = await Utils.postJSON({
            url: automatic.apiPath("classifieds/listings/v1"),
            form: params
        });

        let updates = [];
        let currenciesChanged = JSON.stringify(automatic.listings) !== JSON.stringify(body.listings);
        let buyOrdersChanged = updateBuyOrders(body);
        let bumped = body.bumped;

        automatic.listings = body.listings;

        if (bumped) updates.push(`${bumped} listing${bumped === 1 ? '' : 's'} bumped.`);
        if (body.listings) log.info("Your listings were updated.");
        if (currenciesChanged) updates.push("Community suggested currency exchange rates updated.");
        if (buyOrdersChanged.updated) {
            updates.push(`${buyOrdersChanged.added > 0 ? `+${buyOrdersChanged.added} buy order(s)` : ''}${buyOrdersChanged.removed > 0 ? `, -${buyOrdersChanged.removed} buy order(s)` : ''}.`);
        }

        log[updates.length ? "info" : "verbose"](`Heartbeat sent to backpack.tf. ${updates.join(" ")}`);
        return 1000 * 95;
    } catch (err) {
        const [msg, statusCode, data] = err;
        let retryTimeout = 1000 * 60 * 1; // Default to 1 minute

        if (data?.response?.message) {
            log.warn("Invalid backpack.tf api: " + (data.response.message || "(no reason given)"));
            return "getApiKey";
        }
        
        if (data?.message && data.message.includes('access token')) {
            log.warn("Invalid backpack.tf token: " + (data.message || "(no reason given)"));
            return "getToken";
        }

        if (Array.isArray(msg) && msg.length === 3) { // Cloudflare
            log.warn(`${msg[0]}; backpack.tf may be down, or you are captcha'd by Cloudflare (only if you experience this problem on other sites).`);
        } else if (statusCode >= 500) {
            log.warn(`backpack.tf is down (${statusCode})`);
        } else {
            log.warn(`Error ${statusCode || ""} occurred contacting backpack.tf (${msg}), trying again in 1 minute`.trim());
        }

        return retryTimeout;
    }
}

// ... (continued below)