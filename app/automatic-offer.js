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
        // Items to be handled
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
        let msg = err.cause || err.message;
        if (err.eresult) {
            msg = TradeOfferManager.EResult[err.eresult];
        }
        return msg;
    }

    static isKey(item) {
        return (item.market_hash_name || item.market_name) === "Mann Co. Supply Crate Key" && this.isUnique(item);
    }

    static isUnique(item) {
        return item.name_color === "7D6D00";
    }

    static getMetalValue(item) {
        if (this.isCraftWeapon(item)) {
            return 1 / 18;
        }

        switch (item.market_hash_name || item.market_name) {
            case "Scrap Metal": return 1 / 9;
            case "Reclaimed Metal": return 1 / 3;
            case "Refined Metal": return 1;
            default: return 0;
        }
    }

    static isMetal(item) {
        const name = item.market_hash_name || item.market_name;
        return (name === "Scrap Metal" || name === "Reclaimed Metal" || name === "Refined Metal") && this.isUnique(item);
    }

    static isCraftWeapon(item) {
        if (item.marketable) return false;
        if (!this.isUnique(item)) return false;

        const type = item.getTag('Type');
        if (!type || typeof type.name !== 'string') return false;
        
        if (item.market_hash_name.match(/(Class|Slot) Token/)) return false;
        if (!this.itemIsUncraftable(item)) return false;

        return ['primary weapon', 'secondary weapon', 'melee weapon', 'primary pda', 'secondary pda'].includes(type.name.toLowerCase());
    }

    static itemHasDescription(item, desc) {
        return item.descriptions && item.descriptions.some(d => d.value === desc);
    }

    static itemHasDescriptionStartingWith(item, desc) {
        return item.descriptions && item.descriptions.some(d => d.value.startsWith(desc));
    }

    static itemKillstreakTier(item) {
        if (this.itemHasDescriptionStartingWith(item, "Killstreaker:")) return 3;
        if (this.itemHasDescriptionStartingWith(item, "Sheen:")) return 2;
        if (this.itemHasDescription(item, "Killstreaks Active")) return 1;
        return 0;
    }

    static itemKillstreakNames(item) {
        switch (this.itemKillstreakTier(item)) {
            case 3: return " Professional Killstreak";
            case 2: return " Specialized Killstreak";
            case 1: return " Killstreak";
            default: return "";
        }
    }

    static itemAustralium(item) {
        const name = item.market_hash_name;
        const AuNames = name.substr(name.indexOf("Australium") + 11) || "";
        
        return name.startsWith("Strange") && name.includes("Australium") ? 1 : 0;
    }

    static StrangeSkin(item) {
        const name = item.market_hash_name;
        const conditions = ["Field-Tested", "Factory New", "Minimal Wear", "Well-Worn", "Battle Scarred"];
        return conditions.some(cond => name.includes(cond)) ? 15 : 0;
    }

    static itemIsUncraftable(item) {
        return this.itemHasDescription(item, "( Not Usable in Crafting )");
    }

    static itemParticleEffect(item) {
        if (!item.descriptions) return "";
        const particleDesc = item.descriptions.find(d => d.value.startsWith("★ Unusual Effect: "));
        return particleDesc ? particleDesc.value.slice(18) : "";
    }

    static toBackpackName(item) {
        let name = item.market_hash_name;
        let particle = this.itemParticleEffect(item);
        if (particle) name = particle + " " + name.substr(name.indexOf(" ") + 1); // Remove "Unusual"
        if (this.itemIsUncraftable(item)) name = "Non-Craftable " + name;
        return name;
    }

    recountCurrency() {
        this._countCurrencies(this.exchange.ours, this.currencies.ours, false);
        this._countCurrencies(this.exchange.theirs, this.currencies.theirs, true);
    }

    summarizeItems(items) {
        const names = {};
        items.forEach(item => {
            let name = AutomaticOffer.toBackpackName(item);
            names[name] = (names[name] || 0) + 1;
        });

        return Object.entries(names).map(([name, count]) => `${name}${count > 1 ? ` x${count}` : ""}`).join(', ');
    }

    summarizeCurrency(currencies) {
        return Object.entries(currencies)
            .filter(([_, amount]) => amount !== 0)
            .map(([currency, amount]) => {
                let formatted = amount.toFixed(2);
                return `${formatted} ${currency === "metal" ? "ref" : (formatted === "1.00" ? "key" : "keys")}`;
            }).join(" ");
    }

    summary(opts = {}) {
        let message = `Asked: ${this.summarizeCurrency(this.currencies.ours)} (${this.summarizeItems(this.exchange.ours)})\nOffered: ${this.summarizeCurrency(this.currencies.theirs)} (${this.summarizeItems(this.exchange.theirs)})`;

        if (opts.includeBuyOrders && this.bought.length) {
            message += `\nBought items (${this.bought.length}): ${this.summarizeItems(this.bought.map(index => this.exchange.theirs[index]))}`;
        }

        return message;
    }

    _countCurrencies(items, cur, includeWeapons) {
        for (const item of items) {
            if (this.games.indexOf(item.appid) === -1) {
                this.games.push(item.appid);
            }

            if (AutomaticOffer.isKey(item)) {
                cur.keys += 1;
            } else {
                let metalValue = includeWeapons ? AutomaticOffer.getMetalValue(item) : (AutomaticOffer.isMetal(item) ? AutomaticOffer.getMetalValue(item) : 0);
                if (metalValue > 0) {
                    cur.metal += metalValue;
                }
            }
        }

        // Fix x.99999 metal values
        if (cur.metal % 1 >= 0.99) {
            cur.metal = Math.round(cur.metal);
        }
    }

    accept() {
        return new Promise((resolve, reject) => {
            this.tradeoffer.accept((err, status) => {
                if (err) {
                    reject(AutomaticOffer.getOfferError(err));
                } else {
                    // Note: Confirmation handling might be implemented differently based on your setup
                    // Confirmations.addOffer(this.tid);
                    // Confirmations.check();
                    // Confirmations.accept_that_offer(this.tid);
                    resolve(status);
                }
            });
        });
    }

    decline() {
        return new Promise((resolve, reject) => {
            this.tradeoffer.decline((err, status) => {
                if (err) {
                    reject(AutomaticOffer.getOfferError(err));
                } else {
                    resolve(status);
                }
            });
        });
    }

    determineEscrowDays() {
        return new Promise((resolve, reject) => {
            this.tradeoffer.getUserDetails((err, my, them) => {
                if (err) reject(err);
                else {
                    let escrowDays = 0;
                    if (this.exchange.theirs.length > 0 && them.escrowDays > escrowDays) escrowDays = them.escrowDays;
                    if (this.exchange.ours.length > 0 && my.escrowDays > escrowDays) escrowDays = my.escrowDays;
                    resolve(escrowDays);
                }
            });
        });
    }

    static fmtid(tid) { 
        return (+tid).toString(36).toUpperCase(); 
    }

    partner64() {
        return this.tradeoffer.partner.toString();
    }

    partner3() {
        return this.tradeoffer.partner.getSteam3RenderedID();
    }

    offerid() {
        return AutomaticOffer.fmtid(this.tid);
    }

    state() {
        return this.tradeoffer.state;
    }

    stateName() {
        return TradeOfferManager.ETradeOfferState[this.state()];
    }

    isGlitched() {
        return this.tradeoffer.isGlitched();
    }

    isOneSided() {
        return this.exchange.ours.length === 0 || this.exchange.theirs.length === 0;
    }

    isGiftOffer() {
        return this.exchange.ours.length === 0 && this.exchange.theirs.length > 0;
    }

    log(level, msg) {
        Automatic.log[level](`${this.partner3()} Offer ${this.offerid()} ${msg}`);
    }

    logDetails(level) {
        this.log(level, `Offer details:\n${this.summary({ includeBuyOrders: false })}`);
    }

    fromOwner() {
        const owners = Automatic.config.get().owners || [];
        return owners.includes(this.partner64());
    }

    abandon(opts = {}) {
        if (opts.recheck) {
            this.log("warn", "Some items are missing app_data (Steam is having issues). Offer will be rechecked in 15 seconds.");
            return Utils.after.seconds(15).then(() => {
                Automatic.manager.pollData = {};
                Automatic.manager._assetCache = {};
                this.log("verbose", "Rechecking offer...");
            });
        }
    }
}

module.exports = AutomaticOffer;
module.exports.register = (automatic) => {
    Automatic = automatic;
};