import { writeFile, readFile, access } from 'fs/promises';
import { constants } from 'fs';
import TradeOfferManager from 'steam-tradeoffer-manager';
import backpack from './backpacktf.js';
import { AutomaticOffer } from './automatic-offer.js';

const POLLDATA_FILENAME = 'polldata.json';

let manager, log, Config;

// Register function to initialize the module
export const register = async (Automatic) => {
    log = Automatic.log;
    manager = Automatic.manager;
    Config = Automatic.config;

    try {
        await access(POLLDATA_FILENAME, constants.F_OK);
        const data = await readFile(POLLDATA_FILENAME, 'utf-8');
        manager.pollData = JSON.parse(data);
    } catch (err) {
        log.verbose(`Unable to load ${POLLDATA_FILENAME}: ${err.message}. Starting fresh.`);
    }

    manager.on('pollData', savePollData);
    manager.on('newOffer', handleOffer);
    manager.on('receivedOfferChanged', offerStateChanged);
};

// Save poll data asynchronously
const savePollData = async (pollData) => {
    try {
        await writeFile(POLLDATA_FILENAME, JSON.stringify(pollData, null, 2));
        log.debug("Poll data successfully saved.");
    } catch (err) {
        log.warn(`Error writing poll data: ${err.message}`);
    }
};

// Dynamically load AutomaticOffer if needed
const getAutomaticOffer = async () => {
    if (!AutomaticOffer) {
        const module = await import('./automatic-offer.js');
        return module.AutomaticOffer;
    }
    return AutomaticOffer;
};

// Handle new trade offers
const handleOffer = async (tradeoffer) => {
    const AutomaticOffer = await getAutomaticOffer();
    const offer = new AutomaticOffer(tradeoffer);

    if (offer.isGlitched()) {
        offer.log("warn", `Received from ${offer.partner64()} is glitched (Steam might be down).`);
        return;
    }

    offer.log("info", `Received from ${offer.partner64()}`);

    // Handle owner offers
    if (offer.fromOwner()) {
        offer.log("info", "Offer is from owner, accepting.");
        offer.accept()
            .then(status => offer.log("trade", `Successfully accepted${status === 'pending' ? "; confirmation required" : ""}`))
            .catch(msg => offer.log("warn", `Couldn't accept owner offer: ${msg}`));
        return;
    }

    // Handle one-sided gift offers
    if (offer.isOneSided()) {
        if (offer.isGiftOffer() && Config.get("acceptGifts")) {
            offer.log("info", "Gift offer detected, accepting.");
            offer.accept()
                .then(status => offer.log("trade", `Gift offer successfully accepted${status === 'pending' ? "; confirmation required" : ""}`))
                .catch(msg => offer.log("warn", `Couldn't accept gift offer: ${msg}`));
        } else {
            offer.log("info", "Gift offer detected, skipping.");
        }
        return;
    }

    // Skip offers with non-TF2 items
    if (offer.games.length !== 1 || offer.games[0] !== 440) {
        offer.log("info", "Offer contains non-TF2 items, skipping.");
        return;
    }

    // Handle buy and sell orders
    offer.log("debug", "Handling buy orders.");
    const ok = backpack.handleBuyOrdersFor(offer);
    if (ok === false) return;

    offer.log("debug", "Handling sell orders.");
    backpack.handleSellOrdersFor(offer)
        .then(ok => {
            if (ok) {
                offer.log("debug", "Finalizing offer.");
                backpack.finalizeOffer(offer);
            }
        })
        .catch(err => log.error(`Error handling sell orders: ${err.message}`));
};

// Handle changes in trade offer states
const offerStateChanged = async (tradeoffer, oldState) => {
    const AutomaticOffer = await getAutomaticOffer();
    const offer = new AutomaticOffer(tradeoffer, { countCurrency: false });
    offer.log("verbose", `State changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${offer.stateName()}`);

    if (offer.state() === TradeOfferManager.ETradeOfferState.InvalidItems) {
        offer.log("info", "Offer is now invalid, declining.");
        offer.decline()
            .then(() => offer.log("debug", "Offer successfully declined."))
            .catch(() => offer.log("info", "Offer was marked invalid after being accepted."));
    }
};
