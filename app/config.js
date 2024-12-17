const fs = require('fs/promises');
const path = require('path');

const CONFIG_FILENAME = 'config.json';
const ACCOUNTS_FILENAME = 'accounts.json';

const defaultConfig = {
    "dateFormat": "HH:mm:ss",
    "acceptGifts": false,
    "declineBanned": true,
    "acceptEscrow": false, // or: true, "decline"
    "currencyExchange": {"metal->keys": false, "keys->metal": false},
    "buyOrders": true,
    "confirmations": "all", // or: "own", "own+market", "none"
    "logs": {
        "console": {
            "level": "verbose"
        },
        "file": {
            "filename": "automatic.log",
            "disabled": false,
            "level": "info"
        },
        "trade": {
            "filename": "automatic.trade.log",
            "disabled": false
        }
    },
    "owners": ["<steamid64s>"]
};

let config = {};
let accounts = {};

// Helper function to construct file paths
function getFilePath(filename) {
    return path.join(__dirname, filename);
}

async function parseJSON(file) {
    try {
        const data = await fs.readFile(getFilePath(file), 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error(`Error parsing ${file}: ${e.message}`);
        return e;
    }
}

async function saveJSON(file, conf) {
    try {
        await fs.writeFile(getFilePath(file), JSON.stringify(conf, null, "    "));
    } catch (e) {
        console.error(`Error saving ${file}: ${e.message}`);
    }
}

function get(val, def) {
    if (val) {
        return config[val] || def;
    }
    return config;
}

exports.get = get;

exports.write = async function(conf) {
    config = conf;
    await saveJSON(CONFIG_FILENAME, config);
};

exports.init = async function () {
    let msg = "";
    
    if (await fs.access(getFilePath(CONFIG_FILENAME)).then(() => true).catch(() => false)) {
        config = await parseJSON(CONFIG_FILENAME);
        if (typeof config === "string") {
            msg = `Cannot load ${CONFIG_FILENAME}. ${config.toString()}. Using default config.`;
            config = defaultConfig;
        } else {
            delete config.acceptedKeys;
            delete config.acceptOverpay;
        }
    } else {
        await exports.write(defaultConfig);
        msg = "Config generated.";
    }

    if (await fs.access(getFilePath(ACCOUNTS_FILENAME)).then(() => true).catch(() => false)) {
        accounts = await parseJSON(ACCOUNTS_FILENAME);
        if (typeof accounts === "string") {
            msg += ` Cannot load ${ACCOUNTS_FILENAME}. ${accounts.toString()}. No saved account details are available.`;
            accounts = {};
        }
    } else if (config.steam) {
        for (let name in config.steam.sentries) {
            let identity_secret = "";
            let bptfToken = "";

            let tokens = Object.keys(config.tokens);
            if (tokens.length === 1) bptfToken = config.tokens[tokens[0]];

            let isecrets = Object.keys(config.steam.identitySecret);
            if (isecrets.length === 1) identity_secret = config.steam.identitySecret[isecrets[0]];
            accounts[name] = {
                sentry: config.steam.sentries[name],
                oAuthToken: (config.steam.oAuthTokens && config.steam.oAuthTokens[name]) || "",
                identity_secret,
                bptfToken
            }
        }
        
        accounts.lastUsedAccount = config.steam.last;

        delete config.steam;
        delete config.tokens;
        await exports.write(config);
        await saveJSON(ACCOUNTS_FILENAME, accounts);
        msg += " Initialized new account storage.";
    }
    
    return msg.trim();
};

function getAccount(id) {
    if (id === undefined) {
        return accounts[lastAccount()];
    }
    return accounts[id];
}

async function saveAccount(name, details) {
    if (arguments.length === 1) {
        details = name;
        name = lastAccount();
    }

    accounts[name] = details;
    accounts.lastUsedAccount = name;
    await saveJSON(ACCOUNTS_FILENAME, accounts);
}

function setLastUsed(name) {
    accounts.lastUsedAccount = name;
    saveJSON(ACCOUNTS_FILENAME, accounts);
}

function lastAccount() {
    return accounts.lastUsedAccount || "";
}

exports.account = getAccount;
exports.saveAccount = saveAccount;
exports.lastUsedAccount = lastAccount;
exports.setLastUsed = setLastUsed;