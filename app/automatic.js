let SteamCommunity;
let TradeOfferManager;
let Winston;

try {
    SteamCommunity = require('steamcommunity');
    TradeOfferManager = require('steam-tradeoffer-manager');
    Winston = require('winston');
} catch (ex) {
    console.error("Missing dependencies. Install a version with dependencies (not 'download repository') or use npm install.");
    process.exit(1);
}

const Utils = require('./utils');
const vers = require('../package.json') || {version: "(unknown)", beta: ""};
const version = vers.version + (vers.beta && vers.beta !== vers.version ? ` beta-${vers.betav}` : '');

const Config = require('./config');
const logging = require('./logging');
const trade = require('./trade');
const steam = require('./steamclient');
const backpack = require('./backpacktf');

let configlog = Config.init();

const Automatic = {
    version,
    getOwnSteamID() {
        return Automatic.steam.steamID.getSteamID64();
    },
    apiPath(fn) {
        return (Automatic.config.get().backpackDomain || 'https://backpack.tf') + '/api/' + fn;
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
        let c = Automatic.currencies[cur];
        return c ? (c.low + c.high) / 2 : 0;
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

Automatic.config = Config;
Automatic.steam = new SteamCommunity();
Automatic.steam.username = null;
Automatic.manager = new TradeOfferManager({
    language: "en",
    community: Automatic.steam,
    domain: "backpack.tf",
    pollInterval: 10500
});

// Create Winston logger with custom levels and colors
const logger = Automatic.log = Winston.createLogger({
    levels: logging.LOG_LEVELS,
    format: Winston.format.combine(
        Winston.format.timestamp(),
        Winston.format.colorize(),
        Winston.format.printf(info => `${info.timestamp} [${info.level}]: ${info.message}`)
    ),
    transports: [
        new Winston.transports.Console()
    ]
});

function register(...args) {
    args.forEach(component => {
        if (typeof component === 'string') {
            component = require('./' + component);
        }
        if (typeof component.register === 'function') {
            component.register(Automatic);
        }
    });
}

register(
    logging,
    trade,
    backpack,
    steam,
    'automatic-offer',
    'confirmations'
);

if (configlog) logger.info(configlog);
logger.info("backpack.tf Automatic v%s starting", version);
if (vers.beta) {
    logger.warn("This is a beta version, functionality might be incomplete and/or broken. Release versions can be found here:");

    logger.warn("In case you are running this build to test (or because it fixes a particular bug you have with older versions), you can report issues here:");

}

process.nextTick(() => steam.connect());

// Check if we're up to date
// Note: This functionality is not implemented in the provided code. Add here if needed.

process.on('uncaughtException', (err) => {
    logger.error([
        "backpack.tf Automatic crashed! Please create an issue with the following log:",
        `crash: Automatic.version: ${Automatic.version}; node: ${process.version} ${process.platform} ${process.arch}; Contact: ${Automatic.getOwnSteamID()}`,
        `crash: Stack trace::`,
        require('util').inspect(err)
    ].join('\n'));
    logger.error("Create an issue here: https://bitbucket.org/jessecar/backpack.tf-automatic/issues/new");
    process.exit(1);
});