const TradeOfferManager = require('steam-tradeoffer-manager');
const Confirmations = require('./confirmations');
const Utils = require('./utils');
let Automatic;

class AutomaticOffer {
    constructor(offer, opts = {}) {
        this.tradeoffer = offer;
        this.tid = offer.id;

        // Original offer
        this.exchange = { ours: offer.itemsToGive, theirs: offer.itemsToReceive };
        this.items = { ours: [], theirs: [] };

        // Offer values
        this.currencies = { ours: { keys: 0, metal: 0 }, theirs: { keys: 0, metal: 0 } };
        this.bought = [];
        this.games = [];

        if (opts.countCurrency !== false) {
            this.recountCurrency();
        }
    }

    /**
     * Extracts a user-friendly error message from the error object.
     * @param {Error} err - The error object.
     * @returns {string} - Extracted error message.
     */
    static getOfferError(err) {
        if (err.eresult) {
            return TradeOfferManager.EResult[err.eresult] || `Unknown EResult: ${err.eresult}`;
        }
        return err.message || "Unknown error";
    }

    /**
     * Checks if an item is a Mann Co. Supply Crate Key.
     * @param {Object} item - The item object.
     * @returns {boolean} - True if the item is a key.
     */
    static isKey(item) {
        return (
            (item.market_hash_name || item.market_name) === "Mann Co. Supply Crate Key" &&
            AutomaticOffer.isUnique(item)
        );
    }

    /**
     * Checks if an item is unique.
     * @param {Object} item - The item object.
     * @returns {boolean} - True if the item is unique.
     */
    static isUnique(item) {
        return item.name_color === "7D6D00";
    }

    static isMetal(item) {
        const name = item.market_hash_name || item.market_name;
        return ["Scrap Metal", "Reclaimed Metal", "Refined Metal"].includes(name) && this.isUnique(item);
    }

    /**
     * Recalculates the currency values for the trade offer.
     */
    recountCurrency() {
        this._countCurrencies(this.exchange.ours, this.currencies.ours, false);
        this._countCurrencies(this.exchange.theirs, this.currencies.theirs, true);
    }

    /**
     * Counts the currencies (keys and metal) in a list of items.
     * @param {Array} items - The list of items.
     * @param {Object} cur - The currencies object to populate.
     * @param {boolean} includeWeapons - Whether to include craft weapons.
     */
    _countCurrencies(items, cur, includeWeapons) {
        items.forEach((item) => {
            if (!this.games.includes(item.appid)) {
                this.games.push(item.appid);
            }

            if (AutomaticOffer.isKey(item)) {
                cur.keys += 1;
            } else if (AutomaticOffer.isMetal(item)) {
                cur.metal += AutomaticOffer.getMetalValue(item);
            } else if (includeWeapons && AutomaticOffer.isCraftWeapon(item)) {
                cur.metal += AutomaticOffer.getMetalValue(item);
            }
        });

        // Round near-integer metal values
        if (cur.metal % 1 >= 0.99) {
            cur.metal = Math.round(cur.metal);
        }
    }

    /**
     * Accepts the trade offer.
     * @returns {Promise<string>} - Resolves with the trade status.
     */
    accept() {
        return new Promise((resolve, reject) => {
            this.tradeoffer.accept((err, status) => {
                if (err) {
                    return reject(new Error(AutomaticOffer.getOfferError(err)));
                }
                resolve(status);
            });
        });
    }

    /**
     * Declines the trade offer.
     * @returns {Promise<string>} - Resolves with the decline status.
     */
    decline() {
        return new Promise((resolve, reject) => {
            this.tradeoffer.decline((err, status) => {
                if (err) {
                    return reject(new Error(AutomaticOffer.getOfferError(err)));
                }
                resolve(status);
            });
        });
    }

    /**
     * Determines the escrow days for the trade offer.
     * @returns {Promise<number>} - Resolves with the escrow days.
     */
    determineEscrowDays() {
        return new Promise((resolve, reject) => {
            this.tradeoffer.getUserDetails((err, my, them) => {
                if (err) return reject(new Error(AutomaticOffer.getOfferError(err)));
                const maxEscrow = Math.max(my.escrowDays || 0, them.escrowDays || 0);
                resolve(maxEscrow);
            });
        });
    }

    /**
     * Logs offer details at the specified level.
     * @param {string} level - The log level (e.g., "info", "warn").
     * @param {string} msg - The log message.
     */
    log(level, msg) {
        const partner = this.tradeoffer.partner.toString();
        const offerID = AutomaticOffer.fmtid(this.tid);
        Automatic.log[level](`[Partner: ${partner}] [Offer ID: ${offerID}] ${msg}`);
    }

    // Additional static and instance methods are unchanged for brevity.
}

module.exports = AutomaticOffer;
module.exports.register = (automatic) => {
    Automatic = automatic;
};
