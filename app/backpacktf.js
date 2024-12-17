const TradeOfferManager = require('steam-tradeoffer-manager');
const AutomaticOffer = require('./automatic-offer');
const Utils = require('./utils');
const Prompts = require('./prompts');
const fs = require('fs');

let manager, log, Config, automatic, community;

// Exported Functions
exports.heartbeat = heartbeat;
exports.register = register;
exports.handleBuyOrdersFor = handleBuyOrdersFor;
exports.handleSellOrdersFor = handleSellOrdersFor;
exports.finalizeOffer = finalizeOffer;
exports.getToken = getToken;
exports.getApiKey = getApiKey;
exports.exchangeCurrencies = exchangeCurrencies;
exports.handleSellOrder = handleSellOrder;

// Register function to initialize global variables
function register(Automatic) {
    manager = Automatic.manager;
    log = Automatic.log;
    Config = Automatic.config;
    community = Automatic.steam;
    automatic = Automatic;
}

let offerSummaries = {};

// Helper function to save token or API key
async function saveCredential(type, value) {
    const acc = Config.account();
    acc[`bptf${type}`] = value;
    await Config.saveAccount(acc);
    return value;
}

async function getToken() {
    const token = await Prompts.backpackToken();
    return saveCredential('Token', token);
}

async function getApiKey() {
    const apiKey = await Prompts.backpackApiKey();
    return saveCredential('ApiKey', apiKey);
}

function updateBuyOrders(body) {
    if (!automatic.buyOrdersEnabled() || !body.listings) {
        return { updated: false, added: 0, removed: 0 };
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

    return { updated: added > 0 || removed > 0, added, removed };
}

async function heartbeat() {
    try {
        const { bptfToken: token, bptApiKey: apiKey } = Config.account();
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
            form: { key: apiKey }
        });

        if (!resp2?.currencies?.keys?.price?.value) throw ['Cannot get keys data', 403];

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

// Trading functions
function diffBuyOrder(offer, cur, item, allignore) {
    let theirs = offer.currencies.theirs;
    let ignored = [];

    if (AutomaticOffer.isCraftWeapon(item)) {
        theirs.metal -= 1/18; // Remove previously implied value for craft weapons
    }

    if (cur.metal) theirs.metal += cur.metal;
    if (cur.keys) {
        theirs.keys += cur.keys;
        let diff = cur.keys;
        for (let i = 0; i < offer.exchange.ours.length; i += 1) {
            const checkItem = offer.exchange.ours[i];
            if (AutomaticOffer.isKey(checkItem, true) && allignore.indexOf(i) === -1) {
                diff -= 1;
                ignored.push(i);
                if (diff === 0) break;
            }
        }
    }

    return ignored;
}

function createUserItemDict(theirs) {
    let items = {};

    for (let index = 0; index < theirs.length; index += 1) {
        const item = theirs[index];
        const appdata = item.app_data;

        if (!appdata) return false; // Abort if app_data is missing

        let defindex = +appdata.def_index;

        const fixDefindexBug = {
            205: 18, 211: 29, 737: 25, 199: 10, 160: 294, 210: 24, 212: 30
        };
        defindex = fixDefindexBug[defindex] || defindex;

        const isAustralium = AutomaticOffer.itemAustralium(item);
        const quality = +appdata.quality || 0; // Normal quality items don't have a 'quality'
        const skin = AutomaticOffer.StrangeSkin(item);
        const effectiveQuality = skin === 15 ? 15 : quality;
        const matchName = AutomaticOffer.toBackpackName(item);

        if (AutomaticOffer.isMetal(item)) continue; // Ignore metal

        let tag = defindex + "_" + effectiveQuality + "_" + isAustralium;
        if (effectiveQuality !== 11) tag += "_" + matchName;

        (items[tag] = (items[tag] || [])).push(index);
    }
    return items;
}

function applyFilter(obj, prop, arr, filter) {
    obj[prop] = filter.length ? arr.filter((_, index) => filter.indexOf(index) === -1) : arr;
}

function eqParticle(item, bpItem) {
    let particle = AutomaticOffer.itemParticleEffect(item);
    if (particle) {
        let bpName = AutomaticOffer.toBackpackName(item);
        return bpName === bpItem.item.name; // Check if particle names match
    }
    return false;
}

function findParticleMatch(item, matches) {
    return matches.find(match => eqParticle(item, match));
}

function buyItem(offer, bpItem, invItem, invItemIndex, oursignore, theirsignore) {
    let ignore = diffBuyOrder(offer, bpItem.currencies, invItem, oursignore);

    oursignore = oursignore.concat(ignore);
    theirsignore.push(invItemIndex);
    if (!offer.stocklimit) offer.stocklimit = [];
    offer.stocklimit.push(AutomaticOffer.toBackpackName(invItem));
    offer.bought.push(invItemIndex);
}

function handleBuyOrdersFor(offer) {
    const { ours, theirs } = offer.exchange;
    const bo = automatic.listings;

    if (!automatic.buyOrdersEnabled() || bo.length === 0) {
        offer.items.ours = ours;
        offer.items.theirs = theirs;
        return;
    }

    let oursignore = [], theirsignore = [];
    let items = createUserItemDict(theirs);
    let unusuals = new Map();

    if (items === false) {
        offer.abandon({ recheck: true });
        return false;
    }

    for (let i = 0; i < bo.length; i += 1) {
        const item = bo[i];
        const quality = item.item.quality;
        const attributes = item.item.attributes || [];
        const isAustralium = attributes.find(attr => attr.defindex === 2027) ? 1 : 0;
        const matchName = item.item.name;
        let tag = `${item.item.defindex}_${quality}_${isAustralium}`;

        if (quality !== 11) tag += `_${matchName}`;

        const indices = items[tag];
        if (!indices) continue;

        if (item.item.name === 'Mann Co. Supply Crate Key') continue;

        const listingParticle = attributes[0]?.float_value || 0;
        const uncraft = !!item.item.flag_cannot_craft;
        let killstreak = matchName.includes('Killstreak') ? (attributes[0]?.float_value || 0) : 0;

        for (let i2 = 0; i2 < indices.length; i2 += 1) {
            const index = indices[i2];
            const orig = theirs[index];

            if (quality === 5) { // Unusual
                orig.__index = index;
                let u = unusuals.get(orig) || [];
                u.push(item);
                unusuals.set(orig, u);
                continue;
            }

            if (quality === 5 && listingParticle && !eqParticle(orig, item)) continue;
            if (uncraft !== AutomaticOffer.itemIsUncraftable(orig)) continue;
            if (killstreak !== AutomaticOffer.itemKillstreakTier(orig)) continue;

            buyItem(offer, item, orig, index, oursignore, theirsignore);
        }
    }

    let oursPrice = ours.keys + (ours.metal / automatic.keyPrice);

    if (theirs.keys === ours.keys && theirs.keys < 2) {
        theirsPrice = Number(theirsPrice.toFixed(3));
        oursPrice = Number(oursPrice.toFixed(3));
    }

    let priceOk = theirsPrice >= oursPrice;

    let { metalOk, keysOk } = exchangeCurrencies(ours, theirs, {
        keysAverage: automatic.currencyAvg("keys"),
        mayExchangeToMetal: automatic.mayExchangeToCurrency("metal"),
        mayExchangeToKeys: automatic.mayExchangeToCurrency("keys")
    });

    if (!priceOk) {
        if (!metalOk) {
            offer.log("info", `doesn't offer enough metal (required = ${ours.metal}, given = ${theirs.metal}), skipping this offer.`);
            offer.abandon({ recheck: true });
            return;
        }

        if (!keysOk) {
            offer.log("info", `doesn't offer enough keys (required = ${ours.keys}, given = ${theirs.keys}), skipping this offer.`);
            offer.abandon({ recheck: true });
            return;
        }
    }

    if (offer.stocklimit && offer.stocklimit.length) {
        let stockLimitReached = offer.stocklimit.some(itemName => {
            return offer.items.ours.some(ourItem => ourItem.name === itemName);
        });

        if (stockLimitReached) {
            offer.log("info", "Stock limit reached for some items, rejecting offer.");
            offer.abandon({ recheck: true });
            return;
        }
    }

    // Handle finalizing the offer with all adjustments
    finalizeOffer(offer);
}

// Function to finalize offer after processing
async function finalizeOffer(offer) {
    const { exchange, items } = offer;
    const { ours, theirs } = exchange;

    if (offer.bought.length > 0) {
        offer.log("info", `Successfully bought items: ${offer.bought.join(", ")}`);
    }

    const offerSummary = {
        ours: items.ours,
        theirs: items.theirs,
        bought: offer.bought,
        rejected: offer.rejected || [],
    };

    offerSummaries[offer.id] = offerSummary;

    // Log offer details for debugging or record keeping
    fs.appendFileSync('offer_log.txt', `Offer ID: ${offer.id}\n`);
    fs.appendFileSync('offer_log.txt', `Ours: ${JSON.stringify(offerSummary.ours)}\n`);
    fs.appendFileSync('offer_log.txt', `Theirs: ${JSON.stringify(offerSummary.theirs)}\n`);
    fs.appendFileSync('offer_log.txt', `Bought: ${JSON.stringify(offerSummary.bought)}\n`);
    fs.appendFileSync('offer_log.txt', `Rejected: ${JSON.stringify(offerSummary.rejected)}\n`);
    fs.appendFileSync('offer_log.txt', `\n`);
}

// Function to handle sell orders for the offer
function handleSellOrdersFor(offer) {
    const { ours, theirs } = offer.exchange;

    // If there are no sell orders, we just pass the offer as it is
    if (!automatic.sellOrdersEnabled()) {
        offer.items.ours = ours;
        offer.items.theirs = theirs;
        return;
    }

    let updatedOurs = [...ours];
    let updatedTheirs = [...theirs];

    // Logic for handling sell orders
    updatedOurs = updatedOurs.filter(item => !automatic.sellOrders.some(order => order.id === item.id));
    updatedTheirs = updatedTheirs.filter(item => !automatic.sellOrders.some(order => order.id === item.id));

    offer.items.ours = updatedOurs;
    offer.items.theirs = updatedTheirs;

    // Log the changes for debugging purposes
    offer.log("info", `Sell orders processed. Updated 'ours' and 'theirs' lists.`);
}

// Example function for converting between currencies
function exchangeCurrencies(ours, theirs, options) {
    const result = { metalOk: true, keysOk: true };

    // Here, perform any necessary calculations based on the options
    if (ours.metal > theirs.metal) result.metalOk = false;
    if (ours.keys > theirs.keys) result.keysOk = false;

    return result;
}
