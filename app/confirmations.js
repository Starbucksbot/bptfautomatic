const SteamTotp = require('steam-totp');
const { ConfirmationType } = require('steamcommunity');

const CONFIRMATION_POLL_INTERVAL = 10000;

let automatic, steam, AutomaticOffer;
let enabled = false;
let offerids = new Set();

let identity_secret = '';

function cm() {
    return automatic.confirmationsMode();
}

function timenow() {
    return Math.floor(Date.now() / 1000);
}

function totpKey(secret, tag) {
    try {
        return SteamTotp.getConfirmationKey(secret, timenow(), tag);
    } catch (err) {
        throw new Error(`Failed to generate TOTP key: ${err.message}`);
    }
}

exports.enabled = () => cm() !== 'none';

/**
 * Accepts a confirmation using the identity secret.
 * @param {Object} confirmation - Confirmation object.
 * @param {string} secret - Identity secret.
 */
const accept = exports.accept = async (confirmation, secret) => {
    const cid = `#${confirmation.id}`;
    automatic.log.verbose(`Accepting confirmation ${cid}...`);

    try {
        const time = timenow();
        const key = totpKey(secret, 'allow');
        await confirmation.respond(time, key, true);

        let creator = confirmation.creator;
        let message = `Confirmation ${cid} accepted`;
        const handledByAutomatic = confirmation.type === ConfirmationType.Trade && offerids.has(creator);

        if (handledByAutomatic) {
            message += ` (belongs to trade offer ${AutomaticOffer.fmtid(creator)})`;
            offerids.delete(creator); // Remove processed offer ID
        }

        automatic.log.verbose(`${message}.`);
    } catch (err) {
        automatic.log.error(`Error accepting confirmation ${cid}: ${err.message}`);
    }
};

/**
 * Enables the confirmation system.
 */
exports.enable = () => {
    if (enabled || !exports.enabled()) return;
    enabled = true;

    steam.on('confKeyNeeded', (tag, callback) => {
        try {
            const time = timenow();
            const key = totpKey(identity_secret, tag);
            callback(null, time, key);
        } catch (err) {
            automatic.log.error(`Error generating confirmation key: ${err.message}`);
            callback(err);
        }
    });

    steam.on('newConfirmation', async (confirmation) => {
        const mode = cm();
        try {
            if (mode === 'all') {
                await accept(confirmation, identity_secret);
            } else if (mode === 'own' && offerids.has(confirmation.creator)) {
                await accept(confirmation, identity_secret);
            } else if (mode === 'own+market' &&
                (offerids.has(confirmation.creator) || confirmation.type === ConfirmationType.MarketListing)) {
                await accept(confirmation, identity_secret);
            }
        } catch (err) {
            automatic.log.warn(`Failed to process new confirmation: ${err.message}`);
        }
    });

    steam.startConfirmationChecker(CONFIRMATION_POLL_INTERVAL);
};

/**
 * Sets the identity secret and enables the confirmation system.
 * @param {string} secret - The identity secret.
 */
exports.setSecret = (secret) => {
    if (!secret || typeof secret !== 'string') {
        throw new Error('Invalid identity secret provided.');
    }

    offerids.clear();
    identity_secret = secret;
    exports.enable();
};

/**
 * Checks for confirmations (legacy support, if required).
 */
exports.check = () => {
    if (!enabled) return;

    if (typeof steam.checkConfirmations === 'function') {
        steam.checkConfirmations().catch((err) => {
            automatic.log.error(`Error checking confirmations: ${err.message}`);
        });
    } else {
        automatic.log.warn('checkConfirmations method is not available in the current SteamCommunity API version.');
    }
};

/**
 * Adds an offer ID to the confirmation list.
 * @param {string} id - The offer ID.
 */
exports.addOffer = (id) => {
    if (id) {
        offerids.add(id);
    }
};

/**
 * Registers the confirmation module with the Automatic system.
 * @param {Object} Automatic - The main Automatic object.
 */
exports.register = (Automatic) => {
    automatic = Automatic;
    steam = automatic.steam;

    AutomaticOffer = require('./automatic-offer');
};
