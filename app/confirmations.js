import SteamTotp from 'steam-totp';
import { ConfirmationType } from 'steamcommunity';

const CONFIRMATION_POLL_INTERVAL = 10000;

let automatic, steam, AutomaticOffer;
let enabled = false;
let offerids = {};
let identity_secret = "";

// Helper functions
const cm = () => automatic.confirmationsMode();
const timenow = () => Math.floor(Date.now() / 1000);
const totpKey = (secret, tag) => SteamTotp.getConfirmationKey(secret, timenow(), tag);

// Check if confirmations are enabled
export const enabledStatus = () => cm() !== "none";

// Accept a confirmation
export const accept = (confirmation, secret) => {
    const cid = `#${confirmation.id}`;
    automatic.log.verbose(`Accepting confirmation ${cid}`);

    const time = timenow();
    confirmation.respond(time, totpKey(secret, "allow"), true, (err) => {
        if (err) {
            return automatic.log.error(`Error accepting confirmation ${cid}.`);
        }

        const creator = confirmation.creator;
        let message = `Confirmation ${cid} accepted`;
        const handledByAutomatic = confirmation.type === ConfirmationType.Trade && offerids[creator];

        if (handledByAutomatic) {
            message += ` (belonging to trade offer ${AutomaticOffer.fmtid(creator)})`;
            offerids[creator] = null;
        }

        automatic.log.verbose(`${message}.`);
    });
};

// Enable confirmation handling
export const enable = () => {
    if (enabled || !enabledStatus()) return;

    enabled = true;

    steam.on('confKeyNeeded', (tag, callback) => {
        callback(null, timenow(), totpKey(identity_secret, tag));
    });

    steam.on('newConfirmation', (confirmation) => {
        const mode = cm();

        if (mode === "all") {
            accept(confirmation, identity_secret);
        } else if (mode === "own" && offerids[confirmation.creator]) {
            accept(confirmation, identity_secret);
        } else if (mode === "own+market") {
            if (offerids[confirmation.creator] || confirmation.type === ConfirmationType.MarketListing) {
                accept(confirmation, identity_secret);
            }
        }
        // "none" mode is ignored
    });

    steam.startConfirmationChecker(CONFIRMATION_POLL_INTERVAL);
};

// Set the identity secret and enable confirmations
export const setSecret = (secret) => {
    offerids = {};
    identity_secret = secret;
    enable();
};

// Check for confirmations manually
export const check = () => {
    if (!enabled) return;
    // Placeholder for future check implementation
    // steam.checkConfirmations();
};

// Add an offer ID to be tracked
export const addOffer = (id) => {
    offerids[id] = true;
};

// Register automatic and steam instances
export const register = (Automatic) => {
    automatic = Automatic;
    steam = automatic.steam;

    // Dynamic import for automatic-offer
    AutomaticOffer = require('./automatic-offer');
};
