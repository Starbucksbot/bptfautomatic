const SteamCommunity = require('steamcommunity');
const TradeOfferManager = require('steam-tradeoffer-manager');
const Winston = require('winston');
const Utils = require('./utils');
const vers = require('../package.json') || { version: "(unknown)", beta: "" };

const Config = require('./config');
const logging = require('./logging');
const trade = require('./trade');
const steam = require('./steamclient');
const backpack = require('./backpacktf');

const version = vers.version + (vers.beta && vers.beta !== vers.version ? ` beta-${vers.beta}` : '');
let configlog = null;

// Initialize configuration
try {
    configlog = Config.init();
} catch (err) {
    console.error(`Failed to initialize config: ${err.message}`);
    process.exit(1);
}

// Define the main Automatic object
const Automatic = {
    version,
    getOwnSteamID() {
        return Automatic.steam.steamID?.getSteamID64() || 'Unknown SteamID';
    },
    apiPath(fn) {
        const domain = Automatic.config.get().backpackDomain || 'https://backpack.tf';
        return `${domain}/api/${fn}`;
    },
    buyOrdersEnabled() {
        return !!Automatic.config.get().buyOrders;
    },
    confirmationsMode() {
        return Automatic.config.get().confirmations || "all";
    },
    inverseCurrency(from) {
        return from === "metal" ? "keys" : "metal";
    },
    currencyAvg(cur) {
        const currency = Automatic.currencies[cur];
        return currency ? (currency.low + currency.high) / 2 : 0;
    },
    mayExchangeToCurrency(to) {
        const config = Automatic.config.get();
        if (typeof config.currencyExchange !== "object") return false;
        return config.currencyExchange[`${Automatic.inverseCurrency(to)}->${to}`] === true;
    },
    keyPrice: null,
    currencies: {},
    buyOrders: [],
    buyOrdersEtag: "",
};

// Initialize components
Automatic.config = Config;
Automatic.steam = new SteamCommunity();
Automatic.manager = new TradeOfferManager({
    language: "en",
    community: Automatic.steam,
    domain: "backpack.tf",
    pollInterval: 10500,
});

// Create Winston logger
const logger = (Automatic.log = Winston.createLogger({
    levels: logging.LOG_LEVELS,
    format: Winston.format.combine(
        Winston.format.timestamp(),
        Winston.format.colorize(),
        Winston.format.printf((info) => `${info.timestamp} [${info.level}]: ${info.message}`)
    ),
    transports: [new Winston.transports.Console()],
}));

// Register modules
function register(...modules) {
    modules.forEach((module) => {
        try {
            if (typeof module === 'string') {
                module = require(`./${module}`);
            }
            if (typeof module.register === 'function') {
                module.register(Automatic);
            }
        } catch (err) {
            logger.error(`Failed to register module ${module}: ${err.message}`);
        }
    });
}

register(logging, trade, backpack, steam, 'automatic-offer', 'confirmations');

// Log initialization messages
if (configlog) logger.info(configlog);
logger.info(`backpack.tf Automatic v${version} starting...`);
if (vers.beta) {
    logger.warn("This is a beta version. Functionality might be incomplete or broken.");
    logger.warn("Report issues here: https://bitbucket.org/jessecar/backpack.tf-automatic/issues/new");
}

// Connect to Steam
process.nextTick(() => {
    try {
        steam.connect();
    } catch (err) {
        logger.error(`Failed to connect to Steam: ${err.message}`);
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error([
        "backpack.tf Automatic crashed! Please report the issue with the following log:",
        `Version: ${Automatic.version}, Node.js: ${process.version}, Platform: ${process.platform}, Arch: ${process.arch}`,
        `SteamID: ${Automatic.getOwnSteamID()}`,
        `Stack Trace:\n${err.stack}`,
    ].join('\n'));
    process.exit(1);
});
