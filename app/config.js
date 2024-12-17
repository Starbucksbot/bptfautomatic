const fs = require('fs/promises');
const path = require('path');

const CONFIG_FILENAME = 'config.json';
const ACCOUNTS_FILENAME = 'accounts.json';

const defaultConfig = {
    "dateFormat": "HH:mm:ss",
    "acceptGifts": true,
    "declineBanned": true,
    "acceptEscrow": false, // or: true, "decline"
    "currencyExchange": { "metal->keys": false, "keys->metal": false },
    "buyOrders": true,
    "confirmations": "all", // or: "own", "own+market", "none"
    "logs": {
        "console": { "level": "verbose" },
        "file": { "filename": "automatic.log", "disabled": false, "level": "info" },
        "trade": { "filename": "automatic.trade.log", "disabled": false }
    },
    "owners": ["<steamid64s>"]
};

let config = {};
let accounts = {};

/**
 * Constructs the full file path for a given filename.
 * @param {string} filename - The name of the file.
 * @returns {string} - The full file path.
 */
function getFilePath(filename) {
    return path.join(__dirname, filename);
}

/**
 * Reads and parses JSON from a file.
 * @param {string} file - The file name.
 * @returns {Promise<Object>} - Parsed JSON data.
 * @throws {Error} - Throws an error if parsing fails.
 */
async function parseJSON(file) {
    try {
        const data = await fs.readFile(getFilePath(file), 'utf8');
        return JSON.parse(data);
    } catch (err) {
        throw new Error(`Error parsing ${file}: ${err.message}`);
    }
}

/**
 * Saves JSON data to a file.
 * @param {string} file - The file name.
 * @param {Object} content - The content to save.
 * @returns {Promise<void>}
 * @throws {Error} - Throws an error if saving fails.
 */
async function saveJSON(file, content) {
    try {
        await fs.writeFile(getFilePath(file), JSON.stringify(content, null, 4));
    } catch (err) {
        throw new Error(`Error saving ${file}: ${err.message}`);
    }
}

/**
 * Retrieves a value from the configuration, or the entire config if no key is provided.
 * @param {string} [key] - The configuration key.
 * @param {any} [defaultValue] - The default value to return if the key doesn't exist.
 * @returns {any} - The configuration value or the entire config object.
 */
function getConfig(key, defaultValue) {
    if (!key) return config;
    return config[key] !== undefined ? config[key] : defaultValue;
}

exports.get = getConfig;

/**
 * Writes new configuration data to the file.
 * @param {Object} newConfig - The new configuration object.
 * @returns {Promise<void>}
 */
exports.write = async function (newConfig) {
    config = newConfig;
    await saveJSON(CONFIG_FILENAME, config);
};

/**
 * Initializes the configuration and accounts data.
 * @returns {Promise<string>} - A message indicating the initialization status.
 */
exports.init = async function () {
    let messages = [];

    try {
        // Load config
        config = await parseJSON(CONFIG_FILENAME);
        delete config.acceptedKeys; // Remove legacy keys
        delete config.acceptOverpay;
    } catch (err) {
        messages.push(`Config file not found or corrupted: ${err.message}. Using default config.`);
        config = defaultConfig;
        await saveJSON(CONFIG_FILENAME, config);
    }

    try {
        // Load accounts
        accounts = await parseJSON(ACCOUNTS_FILENAME);
    } catch (err) {
        messages.push(`Accounts file not found or corrupted: ${err.message}. No saved accounts available.`);
        accounts = {};
    }

    return messages.join(' ');
};

/**
 * Retrieves account details by ID or the last used account if no ID is provided.
 * @param {string} [id] - The account ID.
 * @returns {Object} - The account details.
 */
function getAccount(id) {
    return id ? accounts[id] : accounts[accounts.lastUsedAccount] || {};
}

/**
 * Saves account details.
 * @param {string} name - The account name.
 * @param {Object} details - The account details to save.
 * @returns {Promise<void>}
 */
async function saveAccount(name, details) {
    accounts[name] = details;
    accounts.lastUsedAccount = name;
    await saveJSON(ACCOUNTS_FILENAME, accounts);
}

/**
 * Sets the last used account.
 * @param {string} name - The account name.
 * @returns {Promise<void>}
 */
function setLastUsed(name) {
    accounts.lastUsedAccount = name;
    return saveJSON(ACCOUNTS_FILENAME, accounts);
}

/**
 * Retrieves the last used account name.
 * @returns {string} - The last used account name.
 */
function lastUsedAccount() {
    return accounts.lastUsedAccount || '';
}

exports.account = getAccount;
exports.saveAccount = saveAccount;
exports.lastUsedAccount = lastUsedAccount;
exports.setLastUsed = setLastUsed;
