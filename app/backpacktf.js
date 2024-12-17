const TradeOfferManager = require('steam-tradeoffer-manager');
const AutomaticOffer = require('./automatic-offer');
const Utils = require('./utils');
const Prompts = require('./prompts');
const fs = require('fs/promises'); // Use fs/promises for asynchronous file operations

let manager, log, Config, automatic, community;

// Export functions at the top for clarity, but define them later in the file
exports.heartbeat = heartbeat;
exports.register = register;
exports.handleBuyOrdersFor = handleBuyOrdersFor;
exports.handleSellOrdersFor = handleSellOrdersFor;
exports.finalizeOffer = finalizeOffer;
exports.getToken = getToken;
exports.getApiKey = getApiKey;
exports.exchangeCurrencies = exchangeCurrencies; // Ensure this function is defined below
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
    const apikey = await Prompts.backpackApiKey();
    return saveCredential('ApiKey', apikey);
}

// Function to update buy orders
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

// Heartbeat function, now async for proper error handling
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

        const keyPrice = resp2?.currencies?.keys?.price?.value;
        if (!keyPrice || typeof keyPrice !== 'number') {
            throw new Error('Invalid key price data from API');
        }
        

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
            let boupdates = [];
            if (buyOrdersChanged.added) boupdates.push(`+${buyOrdersChanged.added} buy order(s)`);
            if (buyOrdersChanged.removed) boupdates.push(`-${buyOrdersChanged.removed} buy order(s)`);
            if (boupdates.length) updates.push(boupdates.join(", ") + ".");
        }

        log[updates.length ? "info" : "verbose"](`Heartbeat sent to backpack.tf. ${updates.join(" ")}`);
        return 1000 * 95; // Return timeout in milliseconds

    } catch (err) {
        const [msg, statusCode, data] = err;
        let retryTimeout = 1000 * 60 * 1; // Default to 1 minute

        if (data?.response?.message) {
            log.warn(`Invalid backpack.tf api: ${data.response.message || "(no reason given)"}`);
            return "getApiKey";
        } else if (data?.message && data.message.includes('access token')) {
            log.warn(`Invalid backpack.tf token: ${data.message || "(no reason given)"}`);
            return "getToken";
        } else if (Array.isArray(msg) && msg.length === 3) { // Cloudflare
            log.warn(`${msg[0]}; backpack.tf may be down, or you are captcha'd by Cloudflare (only if you experience this problem on other sites).`);
        } else if (statusCode >= 500) {
            log.warn(`backpack.tf is down (${statusCode})`);
        } else {
            log.warn(`Error ${statusCode || ""} occurred contacting backpack.tf (${msg}), trying again in 1 minute`.trim());
        }

        return retryTimeout;
    }
}
function handleHeartbeatError(err) {
    const [msg, statusCode, data] = err;

    if (data?.response?.message) {
        log.warn(`Invalid backpack.tf api: ${data.response.message || "(no reason given)"}`);
        return "getApiKey";
    }

    if (data?.message && data.message.includes('access token')) {
        log.warn(`Invalid backpack.tf token: ${data.message || "(no reason given)"}`);
        return "getToken";
    }

    if (Array.isArray(msg) && msg.length === 3) { // Cloudflare
        log.warn(`${msg[0]}; backpack.tf may be down, or you are captcha'd by Cloudflare.`);
    } else if (statusCode >= 500) {
        log.warn(`backpack.tf is down (${statusCode})`);
    } else {
        log.warn(`Error ${statusCode || ""} contacting backpack.tf (${msg}), trying again in 1 minute`.trim());
    }

    return 1000 * 60 * 1; // Retry in 1 minute
}


/* Trading */
function diffBuyOrder(offer, cur, item, allignore) {
    let theirs = offer.currencies.theirs;
    let ignored = [];

    // Remove previously implied value for craft weapons
    if (AutomaticOffer.isCraftWeapon(item)) {
        theirs.metal -= 1/18;
    }

    if (cur.metal) {
        theirs.metal += cur.metal;
    }

    if (cur.keys) {
        theirs.keys += cur.keys;
        let diff = cur.keys;
        for (let i = 0; i < offer.exchange.ours.length; i += 1) {
            const item = offer.exchange.ours[i];
            if (AutomaticOffer.isKey(item, true) && !allignore.includes(i)) {
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

    // Create a list of items to compare with buy orders
    for (let index = 0; index < theirs.length; index += 1) {
        const item = theirs[index];
        const appdata = item.app_data;

        // Abort if app_data is missing due to Steam issues
        if (!appdata) return false;

        let defindex = +appdata.def_index;

        const fixDefindexBug = {
            205: 18, 211: 29, 737: 25, 199: 10, 160: 294, 210: 24, 212: 30
        };
        defindex = fixDefindexBug[defindex] || defindex;

        const isAustralium = AutomaticOffer.itemAustralium(item);
        const quality = +appdata.quality || 0;
        const skin = AutomaticOffer.StrangeSkin(item);
        const effectiveQuality = skin === 15 ? 15 : quality;
        const matchName = AutomaticOffer.toBackpackName(item);

        // Ignore metal items
        if (AutomaticOffer.isMetal(item)) continue;

        let tag = `${defindex}_${effectiveQuality}_${isAustralium}`;
        if (effectiveQuality !== 11) tag += `_${matchName}`;

        (items[tag] = (items[tag] || [])).push(index);
    }
    return items;
}

function applyFilter(obj, prop, arr, filter) {
    obj[prop] = filter.length ? arr.filter((_, index) => !filter.includes(index)) : arr;
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
    // Use find for a more modern approach
    return matches.find(match => eqParticle(item, match));
}

function buyItem(offer, bpItem, invItem, invItemIndex, oursignore, theirsignore) {
    let ignore = diffBuyOrder(offer, bpItem.currencies, invItem, oursignore);

    oursignore = oursignore.concat(ignore);
    theirsignore.push(invItemIndex); // Exclude this item from further handling
    if (!offer.stocklimit) offer.stocklimit = [];
    offer.stocklimit.push(AutomaticOffer.toBackpackName(invItem));
    offer.bought.push(invItemIndex);
}

function handleBuyOrdersFor(offer) {
    loadAutomaticOffer(); // Ensure AutomaticOffer is loaded

    const { ours, theirs } = offer.exchange;
    const bo = automatic.listings;

    if (!automatic.buyOrdersEnabled() || bo.length === 0) {
        offer.items.ours = ours;
        offer.items.theirs = theirs;
        return;
    }

    let oursignore = [];
    let theirsignore = [];
    let items = createUserItemDict(theirs);
    
    // Initialize 'unusuals' as a Map to store unusual items
    let unusuals = new Map();

    if (items === false) {
        offer.abandon({ recheck: true });
        return false;
    }

    // Process buy orders and populate 'unusuals' as needed
    for (const item of bo) {
        const quality = item.item.quality;
        const attributes = item.item.attributes || [];
        const isAustralium = attributes.some(attr => attr.defindex === 2027) ? 1 : 0;
        const matchName = item.item.name;
        let tag = `${item.item.defindex}_${quality}_${isAustralium}`;

        if (quality !== 11) tag += `_${matchName}`;

        const indices = items[tag];
        if (!indices) continue;

        if (matchName === 'Mann Co. Supply Crate Key') continue;

        const listingParticle = attributes[0]?.float_value || 0;
        const uncraft = !!item.item.flag_cannot_craft;
        let killstreak = matchName.includes('Killstreak') ? (attributes[0]?.float_value || 0) : 0;

        for (const index of indices) {
            const orig = theirs[index];

            if (quality === 5) { // Unusual
                orig.__index = index;
                let u = unusuals.get(orig) || [];
                u.push(item);
                unusuals.set(orig, u);
                continue;
            }

            if (uncraft !== AutomaticOffer.itemIsUncraftable(orig)) continue;

            if (Number(killstreak) !== AutomaticOffer.itemKillstreakTier(orig)) continue;

            buyItem(offer, item, orig, index, oursignore, theirsignore);
        }
    }

    // Additional handling for unusuals
    for (let [orig, matches] of unusuals) {
        let match = findParticleMatch(orig, matches);

        if (!match) {
            match = matches.find(item => !item.flags || !item.flags.particle);
        }

        if (match) {
            buyItem(offer, match, orig, orig.__index, oursignore, theirsignore);
        }
    }

    applyFilter(offer.items, 'ours', ours, oursignore);
    applyFilter(offer.items, 'theirs', theirs, theirsignore);
}
applyFilter(offer.items, 'ours', ours, oursignore);
applyFilter(offer.items, 'theirs', theirs, theirsignore);

function handleOther(offer, other) {
    if (other && (other.scammer || other.banned)) {
        const decline = Config.get().declineBanned;
        offer.log("info", `Sender is marked as a scammer or banned${decline ? ", declining" : ""}`);

        if (decline) {
            offer.decline()
                .then(() => offer.log("debug", `Offer declined`))
                .catch((err) => offer.log("warn", "Error declining this offer"));
        }

        return false;
    }

    return true;
}

function exchangeCurrencies(ours, theirs, options) {
    let { keysAverage, mayExchangeToMetal, mayExchangeToKeys } = options;

    // Hard disable for security reasons
    mayExchangeToMetal = false;
    mayExchangeToKeys = false;

    if (!keysAverage) {
        // Disabled currency exchange due to issues
        return { keysOk: false, metalOk: false };
    }

    let metalOk = true;
    let keysOk = true;

    // Check if we need metal
    if (ours.metal !== 0) {
        if (ours.metal > theirs.metal) {
            metalOk = false;
            if (theirs.keys > 0 && mayExchangeToMetal) {
                let tv = trunc(theirs.metal + theirs.keys * keysAverage);
                metalOk = tv >= ours.metal && tv >= 0;

                if (metalOk) {
                    let diff = trunc(ours.metal - theirs.metal);
                    theirs.metal += diff; // Set their metal to match ours
                    theirs.keys -= diff / keysAverage;
                }
            }
        }
    }

    // Check if we need keys
    if (metalOk && ours.keys !== 0) {
        if (ours.keys > theirs.keys) {
            keysOk = false;
            if (theirs.metal > 0 && mayExchangeToKeys) {
                let tv = trunc(theirs.keys + theirs.metal / keysAverage);
                keysOk = tv >= ours.keys && tv >= 0;

                theirs.metal -= trunc((ours.keys - theirs.keys) * keysAverage);

                // Recheck metal if the exchange affected it
                if (ours.metal > theirs.metal) {
                    metalOk = false;
                }
            }
        }
    }

    return { keysOk, metalOk };
}
// Updated for modern Node.js and fixed logic issues
const { trunc } = Math;

function evaluateCurrency(metalOk, ours, theirs, keysAverage, mayExchangeToKeys) {
    let keysOk = true;

    if (metalOk && ours.keys !== 0) {
        if (ours.keys > theirs.keys) {
            keysOk = false;

            if (theirs.metal > 0 && mayExchangeToKeys) {
                const tv = trunc(theirs.keys + theirs.metal / keysAverage);
                keysOk = tv >= ours.keys && tv >= 0;

                if (!keysOk) {
                    const requiredMetal = trunc((ours.keys - theirs.keys) * keysAverage);
                    theirs.metal -= requiredMetal;

                    if (ours.metal > theirs.metal) {
                        metalOk = false;
                    }
                }
            }
        }
    }

    return { keysOk, metalOk };
}

function handleSellOrder(offer, listings) {
    if (listings.length === 0 && offer.bought.length === 0) {
        offer.log("info", "No matching listings found for offer, skipping.");
        offer.logDetails("info");
        return false;
    }

    // Stock limit checking
    const stock = [];
    const stocklimit = offer.stocklimit || [];

    if (stocklimit.length > 1) {
        const stockCount = stocklimit.reduce((acc, item) => {
            acc[item] = (acc[item] || 0) + 1;
            return acc;
        }, {});

        const stockValues = Object.values(stockCount);
        const stockMax = Math.max(...stockValues);

        if (stockMax > 1) {
            offer.log("info", "Too many items were sent. Stock limit exceeded.");
            return false;
        }
    }

    // End stock limit check

    const ours = { ...offer.currencies.ours };
    const theirs = { ...offer.currencies.theirs };
    const listingIds = {};

    listings.forEach((listing) => {
        if (listing.item) {
            listingIds[listing.item.id] = true;
        }

        for (const cur in listing.currencies) {
            if (Object.prototype.hasOwnProperty.call(ours, cur)) {
                ours[cur] += listing.currencies[cur];
            }
        }

        // Adjust for keys being sold for metal
        if (listing.defindex === 5021 && listing.quality === 6) {
            ours.keys -= 1;
        }
    });

    // Perform currency evaluation
    const { keysOk, metalOk } = evaluateCurrency(true, ours, theirs, offer.keysAverage, offer.mayExchangeToKeys);

    if (!keysOk || !metalOk) {
        offer.log("info", "Currency mismatch in offer, rejecting.");
        return false;
    }

    return true;
}

function unique(arr) {
    return [...new Set(arr)];
}

function handleSellOrdersFor(offer) {
    return getUserTrades(offer).then(([_, response]) => {
        if (!handleOther(offer, response.other)) {
            return false;
        }

        return handleSellOrder(offer, response.store);
    });
}

function processLeftoverItems(offer, listingIds) {
    for (const item of offer.items.ours) {
        // Ignore metal & keys as these are handled for currency equivalency
        if (AutomaticOffer.isMetal(item) || AutomaticOffer.isKey(item)) continue;

        const id = item.assetid || item.id;
        if (!listingIds.hasOwnProperty(id)) {
            offer.log("info", `Contains an item that isn't in a listing (${AutomaticOffer.toBackpackName(item)}), skipping.`);
            offer.logDetails("info");
            return false;
        }
    }
    return true;
}

function fixCurrencyValues(ours, theirs, keyPrice) {
    for (const cur in ours) {
        ours[cur] = trunc(ours[cur]);
        theirs[cur] = trunc(theirs[cur]);
    }

    if (!keyPrice || typeof keyPrice !== 'number' || keyPrice < 10) {
        console.warn(`There is a problem with the automatic key price: ${keyPrice}`);
        return false;
    }

    if (ours.metal % 1 >= 0.99) ours.metal = Math.ceil(ours.metal);
    if (theirs.metal % 1 >= 0.99) theirs.metal = Math.ceil(theirs.metal);
    if (theirs.metal % 1 >= 0.1) theirs.metal += 0.01;

    if (theirs.keys === ours.keys && theirs.keys >= 2) {
        if (Math.floor(ours.metal) === Math.floor(theirs.metal) || Math.ceil(ours.metal) === Math.ceil(theirs.metal)) {
            theirs.metal = ours.metal;
        }
    }

    return true;
}

function evaluatePrice(ours, theirs, keyPrice) {
    let theirsPrice = theirs.keys + (theirs.metal / keyPrice);
    let oursPrice = ours.keys + (ours.metal / keyPrice);

    if (theirs.keys === ours.keys && theirs.keys < 2) {
        theirsPrice = Number(theirsPrice.toFixed(3));
        oursPrice = Number(oursPrice.toFixed(3));
    }

    return { priceOk: theirsPrice >= oursPrice, theirsPrice, oursPrice };
}

function obviousScammer(offer) {
    const id = offer.partner64();

    const halfYear = 15768000;
    const timeCheck = Math.floor(Date.now() / 1000) - halfYear;

    const options = {
        url: `https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${manager.apiKey}&steamid=${id}`
    };

    return Utils.getJSON(options).then(([body]) => {
        const steamLevel = Number(body.response.player_level);

        return Utils.getJSON({
            url: `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v1/?key=${manager.apiKey}&steamids=${id}`
        }).then(([body]) => {
            const player = body.response.players.player[0];
            const profileVisibility = Number(player.communityvisibilitystate) || 0;
            const createdTime = Number(player.timecreated) || 0;

            if (steamLevel < 4 || createdTime > timeCheck || profileVisibility === 1) {
                offer.log("info", "This trade may be with an obvious scammer, check manually.");
                return false;
            }

            return true;
        });
    });
}

function getUserTrades(offer) {
    const selling = offer.items.ours.map((item) => item.assetid || item.id);

    const options = {
        url: automatic.apiPath("IGetUserTrades/v1"),
        qs: {
            steamid: automatic.getOwnSteamID(),
            steamid_other: offer.partner64(),
            ids: selling
        },
        checkResponse: true
    };

    return Utils.getJSON(options).catch((msg, statusCode) => {
        let errorMsg = msg;

        if (Array.isArray(msg) && msg.length === 3) {
            errorMsg = `${msg[0]}; backpack.tf may be down, or you are captcha'd by Cloudflare.`;
        } else if (statusCode >= 500) {
            errorMsg = `backpack.tf is down (${statusCode})`;
        }

        log.warn(`Error occurred getting sell listings (${errorMsg}), retrying in 1 minute.`);
        return Utils.after.minutes(1).then(() => handleSellOrdersFor(offer));
    });
}

function checkEscrowed(offer) {
    const acceptEscrow = Config.get().acceptEscrow;
    if (acceptEscrow === true) {
        return Promise.resolve(false);
    }

    return offer.determineEscrowDays().then((escrowDays) => {
        if (escrowDays > 0) {
            if (acceptEscrow === "decline") {
                offer.log("info", "Would incur an escrow period, declining.");
                offer.decline()
                    .then(() => offer.log("debug", "Declined"))
                    .catch((err) => offer.log("warn", "Cannot decline this offer"));
            } else {
                offer.warn("warn", `Would incur up to ${escrowDays} escrow. Not accepting.`);
            }

            return true;
        }

        return false;
    });
}

function finalizeOffer(offer) {
    checkEscrowed(offer).then((escrowed) => {
        if (!escrowed) {
            acceptOffer(offer);
        }
    }).catch(err => {
        console.log('Error in finalizeOffer', err)
    })
}

function acceptOffer(offer, tryAgain) {
    const secret = Config.account().identity_secret;
    let message = offer.summary({ includeBuyOrders: true });

    offer.log("trade", "Accepting, summary:\r\n" + message);

    offerSummaries[offer.tid] = message;
    async function acceptOffer(offer, tryAgain = false) {
        try {
            const status = await offer.accept();
            offer.log(
                "trade",
                `Successfully accepted${status === 'pending' ? "; confirmation required" : ""}`
            );
    
            if (status === 'pending') {
                await confirmOffer(offer);
            }
        } catch (error) {
            offer.log("warn", `Unable to accept: ${error.message || error}`);
            if (!tryAgain) {
                offer.log("warn", "Will try 1 more time in 30 seconds");
                setTimeout(() => acceptOffer(offer, true), 1000 * 30);
            }
        }
    }
    
    // Function to confirm an offer
    async function confirmOffer(offer) {
        const secret = Config.account().identity_secret;
        const offerId = offer.tradeoffer.id;
    
        try {
            await new Promise((resolve, reject) => {
                community.acceptConfirmationForObject(secret, offerId, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
    
            offer.log("trade", `Offer ${offerId} confirmed`);
        } catch (err) {
            offer.log("warn", `Error confirming offer ${offerId}: ${err.message || err}`);
        }
    }
    
    // Function to extract asset info
    function extractAssetInfo(item) {
        return {
            appid: item.appid,
            contextid: item.contextid,
            assetid: item.assetid || item.id,
            classid: item.classid,
            instanceid: item.instanceid || "0",
            amount: item.amount || "1",
            missing: item.missing ? "true" : "false",
        };
    }
    
    // Function to serialize an offer
    function serializeOffer(offer) {
        return {
            tradeofferid: offer.id,
            accountid_other: offer.partner.accountid,
            steamid_other: offer.partner.getSteamID64(),
            message: offer.message,
            expiration_time: Math.floor(offer.expires.getTime() / 1000),
            trade_offer_state: offer.state,
            is_our_offer: offer.isOurOffer ? "true" : "false",
            time_created: Math.floor(offer.created.getTime() / 1000),
            time_updated: Math.floor(offer.updated.getTime() / 1000),
            from_real_time_trade: offer.fromRealTimeTrade ? "true" : "false",
            items_to_give: offer.itemsToGive.map(extractAssetInfo),
            items_to_receive: offer.itemsToReceive.map(extractAssetInfo),
            confirmation_method: offer.confirmationMethod || 0,
            escrow_end_date: offer.escrowEnds ? Math.floor(offer.escrowEnds.getTime() / 1000) : 0,
        };
    }
    
    // Function to truncate a number
    function trunc(n) {
        return Math.floor(n * 100) / 100;}
    }