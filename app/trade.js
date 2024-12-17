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

    if (fs.existsSync(path.join(__dirname, POLLDATA_FILENAME))) {
        fs.readFile(path.join(__dirname, POLLDATA_FILENAME), 'utf8')
            .then(pollDataContent => {
                try {
                    manager.pollData = JSON.parse(pollDataContent);
                } catch (e) {
                    log.verbose("polldata.json is corrupt: ", e);
                }
            })
            .catch(e => {
                log.error("Error reading polldata.json: ", e);
            });
    }

    manager.on('pollData', savePollData);
    manager.on('newOffer', handleOffer);
    manager.on('receivedOfferChanged', offerStateChanged);
};

async function savePollData(pollData) {
    try {
        await fs.writeFile(path.join(__dirname, POLLDATA_FILENAME), JSON.stringify(pollData));
    } catch (err) {
        log.warn(`Error writing poll data: ${err.message}`);
    }
}

async function handleOffer(tradeoffer) {
    const offer = new AutomaticOffer(tradeoffer);
    if (offer.isGlitched()) {
        offer.log("warn", `received from ${offer.partner64()} is glitched (Steam might be down).`);
        return;
    }

    offer.log("info", `received from ${offer.partner64()}`);

    if (offer.fromOwner()) {
        offer.log("info", `is from owner, accepting`);
        try {
            const status = await offer.accept();
            offer.log("trade", `successfully accepted${status === 'pending' ? "; confirmation required" : ""}`);
            log.debug("Owner offer: not sending confirmation to backpack.tf");
        } catch (msg) {
            offer.log("warn", `(owner offer) couldn't be accepted: ${msg}`);
        }
        return;
    }
    
    if (offer.isOneSided()) {
        if (offer.isGiftOffer() && Config.get("acceptGifts")) {
            offer.log("info", `is a gift offer asking for nothing in return, will accept`);
            try {
                const status = await offer.accept();
                offer.log("trade", `(gift offer) successfully accepted${status === 'pending' ? "; confirmation required" : ""}`);
                log.debug("Gift offer: not sending confirmation to backpack.tf");
            } catch (msg) {
                offer.log("warn", `(gift offer) couldn't be accepted: ${msg}`);
            }
        } else {
            offer.log("info", "is a gift offer, skipping");
        }
        return;
    }
    
    if (offer.games.length !== 1 || offer.games[0] !== 440) {
        offer.log("info", `contains non-TF2 items, skipping`);
        return;
    }

    offer.log("debug", `handling buy orders`);
    let ok = await backpack.handleBuyOrdersFor(offer);

    if (ok === false) return;
    offer.log("debug", `handling sell orders`);
    try {
        const sellOk = await backpack.handleSellOrdersFor(offer);
        if (sellOk) {
            offer.log("debug", `finalizing offer`);
            await backpack.finalizeOffer(offer);
        }
    } catch (er) {
        log.error('Custom error in tradejs:', er);
    }
}

function offerStateChanged(tradeoffer, oldState) {
    const offer = new AutomaticOffer(tradeoffer, {countCurrency: false});
    offer.log("verbose", `state changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${offer.stateName()}`);

    if (offer.state() === TradeOfferManager.ETradeOfferState.InvalidItems) {
        offer.log("info", "is now invalid, declining");
        offer.decline().then(() => {
            offer.log("debug", "declined");
        }).catch(() => {
            offer.log("info", "(Offer was marked invalid after being accepted)");
        });
    }
}