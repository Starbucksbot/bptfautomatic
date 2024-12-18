// ./confirmation-handler.js
const SteamTotp = require('steam-totp');
const { ConfirmationType } = require('steamcommunity');
const AutomaticOffer = require('./automatic-offer');

const DEFAULT_CONFIRMATION_POLL_INTERVAL = 7000;

let automatic, steam;
let enabled = false;
let offerids = {};
let identity_secret = "";

/**
 * Helper functions
 */
const getCurrentTime = () => Math.floor(Date.now() / 1000);

const generateTotpKey = (secret, tag) =>
    SteamTotp.getConfirmationKey(secret, getCurrentTime(), tag);

const isEnabled = () => automatic.confirmationsMode() !== "none";

/**
 * Log confirmation details and clean up offer IDs.
 */
const handleConfirmation = (confirmation, cid, handledByAutomatic) => {
    const creator = confirmation.creator;
    let message = `Confirmation ${cid} accepted`;
    if (handledByAutomatic) {
        message += ` (belonging to trade offer ${AutomaticOffer.fmtid(creator)})`;
        delete offerids[creator]; // Clean up
    }
    automatic.log.verbose(message + ".");
};

/**
 * Accept a confirmation.
 */
const accept = async (confirmation, secret) => {
    const cid = `#${confirmation.id}`;
    automatic.log.verbose(`Accepting confirmation ${cid}`);

    try {
        const time = getCurrentTime();
        await confirmation.respond(time, generateTotpKey(secret, "allow"), true);
        const handledByAutomatic =
            confirmation.type === ConfirmationType.Trade &&
            offerids[confirmation.creator];
        handleConfirmation(confirmation, cid, handledByAutomatic);
    } catch (err) {
        automatic.log.error(`Error accepting confirmation ${cid}: ${err.message}`);
    }
};

/**
 * Enable the confirmation handler.
 */
const enable = (pollInterval = DEFAULT_CONFIRMATION_POLL_INTERVAL) => {
    if (enabled || !isEnabled()) return;

    enabled = true;

    steam.on("confKeyNeeded", (tag, callback) =>
        callback(null, getCurrentTime(), generateTotpKey(identity_secret, tag))
    );

    steam.on("newConfirmation", (confirmation) => {
        const mode = automatic.confirmationsMode();
        const creatorOffers = offerids[confirmation.creator];
        const isMarket = confirmation.type === ConfirmationType.MarketListing;

        if (
            mode === "all" ||
            (mode === "own" && creatorOffers) ||
            (mode === "own+market" && (creatorOffers || isMarket))
        ) {
            accept(confirmation, identity_secret);
        }
    });

    steam.startConfirmationChecker(pollInterval);
};

/**
 * Public API
 */
exports.enabled = isEnabled;

exports.accept = accept;

exports.enable = () => enable();

exports.setSecret = (secret) => {
    offerids = {};
    identity_secret = secret;
    enable();
};

exports.check = () => {
    if (!enabled) return;
    steam.checkConfirmations();
};

exports.addOffer = (id) => {
    offerids[id] = true;
};

exports.register = (Automatic) => {
    automatic = Automatic;
    steam = automatic.steam;
};
