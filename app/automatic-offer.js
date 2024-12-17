import TradeOfferManager from 'steam-tradeoffer-manager';
import Confirmations from './confirmations.js';
import Utils from './utils.js';

let Automatic; // Global placeholder for Automatic reference

class AutomaticOffer {
    constructor(offer, opts = {}) {
        this.tradeoffer = offer;
        this.tid = offer.id;

        // Original offer and items
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

    static getOfferError(err) {
        return err.eresult ? TradeOfferManager.EResult[err.eresult] : err.message || err.cause;
    }

    static isKey(item) {
        return (item.market_hash_name || item.market_name) === "Mann Co. Supply Crate Key" && this.isUnique(item);
    }

    static isUnique(item) {
        return item.name_color === "7D6D00";
    }

    static getMetalValue(item) {
        if (AutomaticOffer.isCraftWeapon(item)) return 1 / 18;

        switch (item.market_hash_name || item.market_name) {
            case "Scrap Metal": return 1 / 9;
            case "Reclaimed Metal": return 1 / 3;
            case "Refined Metal": return 1;
        }
        return 0;
    }

    static isMetal(item) {
        const name = item.market_hash_name || item.market_name;
        return ["Scrap Metal", "Reclaimed Metal", "Refined Metal"].includes(name) && this.isUnique(item);
    }

    recountCurrency() {
        this._countCurrencies(this.exchange.ours, this.currencies.ours, false);
        this._countCurrencies(this.exchange.theirs, this.currencies.theirs, true);
    }

    async accept() {
        return new Promise((resolve, reject) => {
            this.tradeoffer.accept((err, status) => {
                if (err) reject(AutomaticOffer.getOfferError(err));
                else resolve(status);
            });
        });
    }

    async decline() {
        return new Promise((resolve, reject) => {
            this.tradeoffer.decline((err, status) => {
                if (err) reject(AutomaticOffer.getOfferError(err));
                else resolve(status);
            });
        });
    }

    determineEscrowDays() {
        return new Promise((resolve, reject) => {
            this.tradeoffer.getUserDetails((err, my, them) => {
                if (err) return reject(err);

                const myDays = my.escrowDays || 0;
                const theirDays = them.escrowDays || 0;
                let escrowDays = Math.max(myDays, theirDays);
                resolve(escrowDays);
            });
        });
    }

    summarizeItems(items) {
        const names = items.reduce((acc, item) => {
            const name = AutomaticOffer.toBackpackName(item);
            acc[name] = (acc[name] || 0) + 1;
            return acc;
        }, {});

        return Object.entries(names).map(([name, count]) => (count > 1 ? `${name} x${count}` : name)).join(', ');
    }

    summary(opts = {}) {
        let msg = `Asked: ${this.summarizeCurrency(this.currencies.ours)} (${this.summarizeItems(this.exchange.ours)})\n`;
        msg += `Offered: ${this.summarizeCurrency(this.currencies.theirs)} (${this.summarizeItems(this.exchange.theirs)})`;

        if (opts.includeBuyOrders && this.bought.length) {
            msg += `\nBought items (${this.bought.length}): ${this.summarizeItems(this.bought.map(index => this.exchange.theirs[index]))}`;
        }
        return msg;
    }

    summarizeCurrency(currencies) {
        return Object.entries(currencies).reduce((msg, [currency, amount]) => {
            if (amount !== 0) {
                const formatted = (Math.trunc(amount * 100) / 100).toFixed(2);
                msg += `${formatted} ${currency === "metal" ? "ref" : "keys"} `;
            }
            return msg;
        }, "");
    }

    static toBackpackName(item) {
        let name = item.market_hash_name;
        if (AutomaticOffer.itemIsUncraftable(item)) name = `Non-Craftable ${name}`;
        return name;
    }

    _countCurrencies(items, cur, includeWeapons) {
        for (const item of items) {
            if (!this.games.includes(item.appid)) this.games.push(item.appid);

            if (AutomaticOffer.isKey(item)) cur.keys += 1;
            else if (includeWeapons || AutomaticOffer.isMetal(item)) cur.metal += AutomaticOffer.getMetalValue(item);
        }
        if (cur.metal % 1 >= 0.99) cur.metal = Math.round(cur.metal);
    }
}

// Register automatic instance
export default AutomaticOffer;
export function register(automatic) {
    Automatic = automatic;
}
