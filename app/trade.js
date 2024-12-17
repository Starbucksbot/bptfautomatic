const fs = require('fs/promises');
const path = require('path');
const TradeOfferManager = require('steam-tradeoffer-manager');
const backpack = require('./backpacktf');
const AutomaticOffer = require('./automatic-offer');

const POLLDATA_FILENAME = 'polldata.json';

let manager, log, Config;

exports.register = (Automatic) => {
    log = Automatic.log;
    manager = Automatic.manager;
    Config = Automatic.config;

    loadPollData();

    manager.on('pollData', savePollData);
    manager.on('newOffer', handleOffer);
    manager.on('receivedOfferChanged', offerStateChanged);
};

/**
 * Loads poll data from file if it exists.
 */
async function loadPollData() {
    const pollDataPath = path.join(__dirname, POLLDATA_FILENAME);
    try {
        await fs.access(pollDataPath);
        const pollDataContent = await fs.readFile(pollDataPath, 'utf8');
        manager.pollData = JSON.parse(pollDataContent);
    } catch (err) {
        log.warn("Failed to load poll data:", err.message);
    }
}

/**
 * Saves the poll data to file.
 * @param {Object} pollData - The poll data to save.
 */
async function savePollData(pollData) {
    try {
        await fs.writeFile(path.join(__dirname, POLLDATA_FILENAME), JSON.stringify(pollData));
        log.debug("Poll data saved successfully.");
    } catch (err) {
        log.warn(`Error writing poll data: ${err.message}`);
    }
}

/**
 * Handles incoming trade offers.
 * @param {Object} tradeoffer - The trade offer object.
 */
async function handleOffer(tradeoffer) {
    const offer = new AutomaticOffer(tradeoffer);

    try {
        if (offer.isGlitched()) {
            offer.log("warn", `Offer from ${offer.partner64()} is glitched (Steam might be down).`);
            return;
        }

        offer.log("info", `Offer received from ${offer.partner64()}.`);

        if (offer.fromOwner()) {
            await processOwnerOffer(offer);
        } else if (offer.isOneSided()) {
            await processOneSidedOffer(offer);
        } else if (offer.games.length !== 1 || offer.games[0] !== 440) {
            offer.log("info", `Offer contains non-TF2 items, skipping.`);
        } else {
            await processBackpackOrders(offer);
        }
    } catch (err) {
        offer.log("error", `Failed to handle offer: ${err.message}`);
    }
}

/**
 * Processes offers from the owner.
 * @param {Object} offer - The trade offer object.
 */
async function processOwnerOffer(offer) {
    try {
        offer.log("info", "Offer is from owner, accepting.");
        const status = await offer.accept();
        offer.log("trade", `Successfully accepted (Owner offer)${status === 'pending' ? "; confirmation required" : ""}.`);
        log.debug("Owner offer: no confirmation sent to backpack.tf.");
    } catch (err) {
        offer.log("warn", `Couldn't accept owner offer: ${err.message}`);
    }
}

/**
 * Processes one-sided offers (e.g., gifts).
 * @param {Object} offer - The trade offer object.
 */
async function processOneSidedOffer(offer) {
    if (offer.isGiftOffer() && Config.get("acceptGifts")) {
        try {
            offer.log("info", "Gift offer asking for nothing in return, accepting.");
            const status = await offer.accept();
            offer.log("trade", `Gift offer accepted${status === 'pending' ? "; confirmation required" : ""}.`);
        } catch (err) {
            offer.log("warn", `Couldn't accept gift offer: ${err.message}`);
        }
    } else {
        offer.log("info", "Gift offer not accepted (either disabled or rejected).");
    }
}

/**
 * Processes backpack.tf buy/sell orders for an offer.
 * @param {Object} offer - The trade offer object.
 */
async function processBackpackOrders(offer) {
    try {
        offer.log("debug", "Handling buy orders.");
        const buyOk = await backpack.handleBuyOrdersFor(offer);
        if (!buyOk) return;

        offer.log("debug", "Handling sell orders.");
        const sellOk = await backpack.handleSellOrdersFor(offer);
        if (sellOk) {
            offer.log("debug", "Finalizing offer.");
            await backpack.finalizeOffer(offer);
        }
    } catch (err) {
        offer.log("error", `Error processing backpack orders: ${err.message}`);
    }
}

/**
 * Handles changes in the state of received offers.
 * @param {Object} tradeoffer - The trade offer object.
 * @param {number} oldState - The previous state of the offer.
 */
function offerStateChanged(tradeoffer, oldState) {
    const offer = new AutomaticOffer(tradeoffer, { countCurrency: false });
    offer.log("verbose", `State changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${offer.stateName()}.`);

    if (offer.state() === TradeOfferManager.ETradeOfferState.InvalidItems) {
        offer.log("info", "Offer is now invalid, declining.");
        offer.decline()
            .then(() => offer.log("debug", "Offer declined."))
            .catch(() => offer.log("info", "Offer was marked invalid after being accepted."));
    }
}
