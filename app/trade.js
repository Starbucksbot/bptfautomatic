import { writeFile, readFile, access } from 'fs/promises';
import { constants } from 'fs';
import TradeOfferManager from 'steam-tradeoffer-manager';
import backpack from './backpacktf.js';
import AutomaticOffer from './automatic-offer.js';

const POLLDATA_FILENAME = 'polldata.json';

let manager, log, Config;

// Register trade manager
export const register = async (Automatic) => {
    log = Automatic.log;
    manager = Automatic.manager;
    Config = Automatic.config;

    try {
        await access(POLLDATA_FILENAME, constants.F_OK);
        const data = await readFile(POLLDATA_FILENAME, 'utf-8');
        manager.pollData = JSON.parse(data);
    } catch (err) {
        log.verbose(`Unable to load ${POLLDATA_FILENAME}, starting fresh.`);
    }

    manager.on('pollData', savePollData);
    manager.on('newOffer', handleOffer);
    manager.on('receivedOfferChanged', offerStateChanged);
};

// Save poll data asynchronously
const savePollData = async (pollData) => {
    try {
        await writeFile(POLLDATA_FILENAME, JSON.stringify(pollData, null, 2));
    } catch (err) {
        log.warn(`Error writing poll data: ${err.message}`);
    }
};

// Handle new trade offers
const handleOffer = (tradeoffer) => {
    const offer = new AutomaticOffer(tradeoffer);

    if (offer.isGlitched()) {
        offer.log("warn", `received from ${offer.partner64()} is glitched (Steam might be down).`);
        return;
    }

    offer.log("info", `received from ${offer.partner64()}`);

    if (offer.fromOwner()) {
        offer.log("info", "is from owner, accepting");
        offer.accept()
            .then(status => offer.log("trade", `successfully accepted${status === 'pending' ? "; confirmation required" : ""}`))
            .catch(msg => offer.log("warn", `(owner offer) couldn't be accepted: ${msg}`));
        return;
    }

    if (offer.isOneSided()) {
        if (offer.isGiftOffer() && Config.get("acceptGifts")) {
            offer.log("info", "is a gift offer asking for nothing in return, accepting");
            offer.accept()
                .then(status => offer.log("trade", `(gift offer) successfully accepted${status === 'pending' ? "; confirmation required" : ""}`))
                .catch(msg => offer.log("warn", `(gift offer) couldn't be accepted: ${msg}`));
        } else {
            offer.log("info", "is a gift offer, skipping");
        }
        return;
    }

    if (offer.games.length !== 1 || offer.games[0] !== 440) {
        offer.log("info", "contains non-TF2 items, skipping");
        return;
    }

    offer.log("debug", "handling buy orders");
    const ok = backpack.handleBuyOrdersFor(offer);

    if (ok === false) return;

    offer.log("debug", "handling sell orders");
    backpack.handleSellOrdersFor(offer)
        .then(ok => {
            if (ok) {
                offer.log("debug", "finalizing offer");
                backpack.finalizeOffer(offer);
            }
        })
        .catch(err => log.error(`Error handling sell orders: ${err.message}`));
};

// Handle offer state changes
const offerStateChanged = (tradeoffer, oldState) => {
    const offer = new AutomaticOffer(tradeoffer, { countCurrency: false });
    offer.log("verbose", `state changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${offer.stateName()}`);

    if (offer.state() === TradeOfferManager.ETradeOfferState.InvalidItems) {
        offer.log("info", "is now invalid, declining");
        offer.decline()
            .then(() => offer.log("debug", "declined"))
            .catch(() => offer.log("info", "(Offer was marked invalid after being accepted)"));
    }
};
