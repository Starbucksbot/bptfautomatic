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

            buyItem(offer, item, orig, index, oursignire, theirsignore);
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
            offer.log("info", `doesn't offer enough metal (required = ${ours.metal}, given = ${theirs.metal}), skipping.`);
        }
        if (!keysOk) {
            offer.log("info", `doesn't offer enough keys (required = ${ours.keys}, given = ${theirs.keys}), skipping.`);
        }

        offer.log("info", `doesn't offer enough price (required = ${oursPrice}, given = ${theirsPrice}), skipping.`);
        offer.logDetails("info");
        return false;
    }
    
    offer.log("trade", `required = ${oursPrice}, given = ${theirsPrice}`);

    return true;
}

function handleSellOrdersFor(offer) {
    return getUserTrades(offer).then(([_, response]) => {
        if (!handleOther(offer, response.other)) {
            return false;
        }

        return handleSellOrder(offer, response.store);
    });
}

function obvious_Scammer(offer) {
    let id = offer.partner64();
    
    let profileIs = 0;
    let createdTime = 0;
    let steamLvl = 0;

    const halfYear = 15768000;
    let timeCheck = Math.floor(Date.now() / 1000) - halfYear;
    
    let options = {
        url: `https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${manager.apiKey}&steamid=${id}`
    };
    
    return Promise.all([
        Utils.getJSON(options).then(([body]) => {
            steamLvl = Number(body.response.player_level);
        }),
        Utils.getJSON({
            url: `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v1/?key=${manager.apiKey}&steamids=${id}`
        }).then(([body]) => {
            body = body.response.players[0];
            profileIs = Number(body.communityvisibilitystate) || 0;
            createdTime = Number(body.timecreated) || 0;
        })
    ]).then(() => {
        if (steamLvl < 4 || createdTime > timeCheck || profileIs === 1) {
            offer.log("info", `This trade can be with an obvious scammer, check manually`);
            return false;
        } else {
            return true;
        }
    });
}

function getUserTrades(offer) {
    const selling = offer.items.ours.map(item => item.assetid || item.id);

    let options = {
        url: automatic.apiPath("IGetUserTrades/v1"),
        qs: {
            "steamid": automatic.getOwnSteamID(),
            "steamid_other": offer.partner64(),
            "ids": selling
        },
        checkResponse: true
    };

    return Utils.getJSON(options).catch((msg, statusCode) => {
        let errorMessage = msg;

        if (Array.isArray(msg) && msg.length === 3) { // Cloudflare
            errorMessage = `${msg[0]}; backpack.tf may be down, or you are captcha'd by Cloudflare (only if you experience this problem on other sites).`;
        } else if (statusCode >= 500) {
            errorMessage = `backpack.tf is down (${statusCode})`;
        }

        log.warn(`Error occurred getting sell listings (${errorMessage}), trying again in 1 minute.`);
        return Utils.after.minutes(1).then(() => handleSellOrdersFor(offer));
    });
}

function checkEscrowed(offer) {
    const acceptEscrow = Config.get().acceptEscrow;
    if (acceptEscrow === true || acceptEscrow === "all") {
        return Promise.resolve(false); // User doesn't care about escrow or accepts all
    }

    return offer.determineEscrowDays().then(escrowDays => {
        if (escrowDays > 0) {
            if (acceptEscrow === "decline") {
                offer.log("info", `would incur an escrow period, declining.`);
                return offer.decline()
                    .then(() => offer.log("debug", `declined`))
                    .catch(err => offer.log("warn", "Cannot decline this offer"))
                    .then(() => true);
            } else {
                offer.log("warn", `would incur up to ${escrowDays} escrow. Not accepting.`);
            }
            return true;
        }
        return false;
    });
}

function finalizeOffer(offer) {
    checkEscrowed(offer).then(escrowed => {
        if (!escrowed) {
            acceptOffer(offer);
        }
    }).catch(err => {
        console.log('Error in finalizeOffer', err);
    });
}

function acceptOffer(offer, tryAgain = false) {
    // Everything looks good
    const secret = Config.account().identity_secret;
    let message = offer.summary({includeBuyOrders: true});

    offer.log("trade", "Accepting, summary:\r\n" + message);

    offerSummaries[offer.tid] = message;

    offer.accept().then(status => {
        offer.log("trade", `successfully accepted${status === 'pending' ? "; confirmation required" : ""}`);
        if (status === 'pending') {
            accept_offer(offer, secret);
        }
    }).catch(msg => {
        offer.log("warn", `unable to accept: ${msg}`);
        if (!tryAgain) {
            offer.log("warn", `will try 1 more time in 30 seconds`);
            setTimeout(() => acceptOffer(offer, true), 30000);
        }
    });
}

function accept_offer(offer, secret) {
    let id = offer.tradeoffer.id;
    
    community.acceptConfirmationForObject(secret, id, (err) => {
        if (err) {
            offer.log("warn", `Failed to confirm offer: ${err}`);
        } else {
            offer.log("trade", `Offer ${id} confirmed`);
        }
    });
}

function extractAssetInfo(item) {
    return {
        "appid": item.appid,
        "contextid": item.contextid,
        "assetid": item.assetid || item.id,
        "classid": item.classid,
        "instanceid": item.instanceid || "0",
        "amount": item.amount || "1",
        "missing": item.missing ? "true" : "false"
    };
}

function serializeOffer(offer) {
    return {
        "tradeofferid": offer.id,
        "accountid_other": offer.partner.accountid,
        "steamid_other": offer.partner.getSteamID64(),
        "message": offer.message,
        "expiration_time": Math.floor(offer.expires.getTime() / 1000),
        "trade_offer_state": offer.state,
        "is_our_offer": offer.isOurOffer ? "true" : "false",
        "time_created": Math.floor(offer.created.getTime() / 1000),
        "time_updated": Math.floor(offer.updated.getTime() / 1000),
        "from_real_time_trade": offer.fromRealTimeTrade ? "true" : "false",
        "items_to_give": offer.itemsToGive.map(extractAssetInfo),
        "items_to_receive": offer.itemsToReceive.map(extractAssetInfo),
        "confirmation_method": offer.confirmationMethod || 0,
        "escrow_end_date": offer.escrowEnds ? Math.floor(offer.escrowEnds.getTime() / 1000) : 0
    };
}

function trunc(n) { return Math.floor(n * 100) / 100; }

// Ensure all async functions are properly awaited where necessary