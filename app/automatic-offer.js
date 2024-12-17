import TradeOfferManager from 'steam-tradeoffer-manager';
import Confirmations from './confirmations.js';
import Utils from './utils.js';

let Automatic;

class AutomaticOffer {
    constructor(offer, opts = {}) {
        this.tradeoffer = offer;
        this.tid = offer.id;

        this.exchange = { ours: offer.itemsToGive, theirs: offer.itemsToReceive };
        this.items = { ours: [], theirs: [] };

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
}

export default AutomaticOffer;
export function register(automatic) {
    Automatic = automatic;
}
