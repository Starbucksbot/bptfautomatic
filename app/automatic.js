import fs from 'fs/promises';
import { createLogger, format, transports } from 'winston';
import SteamCommunity from 'steamcommunity';
import TradeOfferManager from 'steam-tradeoffer-manager';

// Dynamic imports for modules
let logging, Config, trade, steam, backpack, Utils;

try {
    logging = (await import('./logging.js')).default;
    Config = (await import('./config.js')).default;
    trade = (await import('./trade.js')).default;
    steam = (await import('./steamclient.js')).default;
    backpack = (await import('./backpacktf.js')).default;
    Utils = (await import('./utils.js')).default;
} catch (ex) {
    console.error("Missing dependencies. Install via npm install or check the installation.", ex);
    process.exit(1);
}

// Load version from package.json
let version = "1.1.0";
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

// Initialize Winston logger
const log = createLogger({
    levels: logging.LOG_LEVELS,
    format: format.combine(
        format.colorize(),
        format.timestamp(),
        format.printf(({ level, message, timestamp }) => `[${timestamp}] ${level}: ${message}`)
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
    modules.forEach(component => component.register(Automatic));
}

await register(logging, trade, backpack, steam, (await import('./automatic-offer.js')).default, (await import('./confirmations.js')).default);

// Start and handle uncaught exceptions
log.info(`backpack.tf Automatic v${version} starting`);
process.nextTick(() => steam.connect());

process.on('uncaughtException', err => {
    log.error(`backpack.tf Automatic crashed!\nError: ${err.message}\nStack: ${err.stack}\nContact SteamID: ${Automatic.getOwnSteamID()}`);
    process.exit(1);
});
