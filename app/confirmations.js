const SteamTotp = require('steam-totp');
const { ConfirmationType } = require('steamcommunity');
const CONFIRMATION_POLL_INTERVAL = 10000;

let automatic, steam, AutomaticOffer;
let enabled = false;
let offerids = {};

let identity_secret = "";

function cm() { return automatic.confirmationsMode(); }
function timenow() { return Math.floor(Date.now() / 1000); }
function totpKey(secret, tag) {
    return SteamTotp.getConfirmationKey(secret, timenow(), tag);
}

exports.enabled = () => {
    return cm() !== "none";
};

const accept = exports.accept = async (confirmation, secret) => {
    const cid = "#" + confirmation.id;
    automatic.log.verbose(`Accepting confirmation ${cid}`);
    
    try {
        const time = timenow();
        const key = totpKey(secret, "allow");
        
        await confirmation.respond(time, key, true);
        let creator = confirmation.creator;
        let message = `Confirmation ${cid} accepted`;
        let handledByAutomatic = confirmation.type === ConfirmationType.Trade && offerids[creator];

        if (handledByAutomatic) {
            message += ` (belonging to trade offer ${AutomaticOffer.fmtid(creator)})`; 
            offerids[creator] = null;
        }
        
        automatic.log.verbose(message + ".");
    } catch (err) {
        automatic.log.error(`Error accepting confirmation ${cid}: ${err.message}`);
    }
};

exports.enable = () => {
    if (enabled || !exports.enabled()) return;

    enabled = true;

    steam.on('confKeyNeeded', (tag, callback) => {
        try {
            const time = timenow();
            const key = totpKey(identity_secret, tag);
            callback(null, time, key);
        } catch (err) {
            callback(err);
        }
    });

    steam.on('newConfirmation', async (confirmation) => {
        const mode = cm();
        if (mode === "all") {
            await accept(confirmation, identity_secret);
        } else if (mode === "own") {
            if (offerids[confirmation.creator]) {
                await accept(confirmation, identity_secret);
            }
        } else if (mode === "own+market") {
            if (offerids[confirmation.creator] || confirmation.type === ConfirmationType.MarketListing) {
                await accept(confirmation, identity_secret);
            }
        } // ignore for "none"
    });

    steam.startConfirmationChecker(CONFIRMATION_POLL_INTERVAL);
};

exports.setSecret = (secret) => {
    offerids = {};
    identity_secret = secret;
    exports.enable();
};

exports.check = () => {
    if (!enabled) return;
    // Note: 'checkConfirmations' might not exist or be necessary in newer versions of steamcommunity
    // If it's still needed, you would use:
    // steam.checkConfirmations().catch(err => automatic.log.error(err.message));
};

exports.addOffer = (id) => {
    offerids[id] = true;
};

exports.register = (Automatic) => {
    automatic = Automatic;
    steam = automatic.steam;

    // see ./automatic.js for why
    AutomaticOffer = require('./automatic-offer');
};