import fs from 'fs/promises'; // Modern fs/promises
import { createLogger, format, transports } from 'winston';

import SteamCommunity from 'steamcommunity';
import TradeOfferManager from 'steam-tradeoffer-manager';

// Load dependencies and error handling
try {
    var logging = await import('./logging.js');
    var Config = await import('./config.js');
    var trade = await import('./trade.js');
    var steam = await import('./steamclient.js');
    var backpack = await import('./backpacktf.js');
    var Utils = await import('./utils.js');
} catch (ex) {
    console.error("Missing dependencies. Install via npm install or check the installation.");
    process.exit(1);
}

// Load version from package.json
let version = "1.1.0"; // Default
try {
    const packageData = JSON.parse(await fs.readFile('../package.json', 'utf-8'));
    const vers = packageData.version || "(unknown)";
    version = packageData.beta ? `${packageData.beta} beta-${packageData.betav}` : vers;
} catch (err) {
    console.error("Failed to load version data:", err.message);
}

const Automatic = {
    version,
    steam: new SteamCommunity(),
    manager: null,
    config: Config,
    currencies: {},
    keyPrice: null,
    buyOrders: [],
    buyOrdersEtag: "",
    getOwnSteamID() {
        return this.steam.steamID.getSteamID64();
    },
    apiPath(fn) {
        return (this.config.get().backpackDomain || 'https://backpack.tf') + '/api/' + fn;
    },
    inverseCurrency(from) {
        return from === "metal" ? "keys" : "metal";
    },
    mayExchangeToCurrency(to) {
        const config = this.config.get();
        return (
            typeof config.currencyExchange === "object" &&
            config.currencyExchange[this.inverseCurrency(to) + "->" + to] === true
        );
    }
};

// Initialize Winston logger (modern syntax)
const log = createLogger({
    levels: logging.LOG_LEVELS,
    format: format.combine(
        format.colorize(),
        format.timestamp(),
        format.printf(({ level, message, timestamp }) => {
            return `[${timestamp}] ${level}: ${message}`;
        })
    ),
    transports: [new transports.Console()]
});

// Set up Steam Offer Manager
Automatic.manager = new TradeOfferManager({
    language: "en",
    community: Automatic.steam,
    domain: "backpack.tf",
    pollInterval: 10500
});

// Register modules
function register(...modules) {
    modules.forEach(component => {
        if (typeof component === "string") {
            component = require(`./${component}`);
        }
        component.register(Automatic);
    });
}

register(logging, trade, backpack, steam, 'automatic-offer', 'confirmations');

// Start and handle uncaught exceptions
log.info(`backpack.tf Automatic v${version} starting`);
process.nextTick(() => steam.connect());

process.on('uncaughtException', err => {
    log.error([
        `backpack.tf Automatic crashed!`,
        `Error: ${err.message}`,
        `Stack: ${err.stack}`,
        `Contact SteamID: ${Automatic.getOwnSteamID()}`,
    ].join('\n'));
    process.exit(1);
});
