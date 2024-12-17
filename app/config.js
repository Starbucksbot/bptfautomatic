import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';

const CONFIG_FILENAME = 'config.json';
const ACCOUNTS_FILENAME = 'accounts.json';

const defaultConfig = {
    dateFormat: "HH:mm:ss",
    acceptGifts: false,
    declineBanned: true,
    acceptEscrow: false, // or: true, "decline"
    currencyExchange: { "metal->keys": false, "keys->metal": false },
    buyOrders: true,
    confirmations: "all", // or: "own", "own+market", "none"
    logs: {
        console: { level: "verbose" },
        file: { filename: "automatic.log", disabled: false, level: "info" },
        trade: { filename: "automatic.trade.log", disabled: false }
    },
    owners: ["<steamid64s>"]
};

let config = {};
let accounts = {};

// Helper function: Read JSON file safely
async function parseJSON(file) {
    try {
        const data = await readFile(file, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return null; // Return null for error
    }
}

// Helper function: Write JSON to file
async function saveJSON(file, data) {
    await writeFile(file, JSON.stringify(data, null, 4));
}

// Retrieve configuration value
export function get(val, def) {
    return val ? config[val] || def : config;
}

// Write updated config
export async function write(conf) {
    config = conf;
    await saveJSON(CONFIG_FILENAME, config);
}

// Initialize configuration
export async function init() {
    let msg = "";

    try {
        // Load or initialize config
        await access(CONFIG_FILENAME, constants.F_OK);
        const parsedConfig = await parseJSON(CONFIG_FILENAME);
        if (parsedConfig) {
            config = parsedConfig;
            delete config.acceptedKeys;
            delete config.acceptOverpay;
        } else {
            msg = `Cannot load ${CONFIG_FILENAME}. Using default config.`;
            await write(defaultConfig);
        }
    } catch {
        msg = "Config generated.";
        await write(defaultConfig);
    }

    try {
        // Load or initialize accounts
        await access(ACCOUNTS_FILENAME, constants.F_OK);
        const parsedAccounts = await parseJSON(ACCOUNTS_FILENAME);
        accounts = parsedAccounts || {};
    } catch {
        accounts = {};
        msg += " No saved account details are available.";
    }

    return msg.trim();
}

// Get account details
export function account(id) {
    return id ? accounts[id] : accounts[lastUsedAccount()];
}

// Save or update an account
export async function saveAccount(name, details) {
    if (arguments.length === 1) {
        details = name;
        name = lastUsedAccount();
    }

    accounts[name] = details;
    accounts.lastUsedAccount = name;
    await saveJSON(ACCOUNTS_FILENAME, accounts);
}

// Set last used account
export async function setLastUsed(name) {
    accounts.lastUsedAccount = name;
    await saveJSON(ACCOUNTS_FILENAME, accounts);
}

// Get last used account
export function lastUsedAccount() {
    return accounts.lastUsedAccount || "";
}
