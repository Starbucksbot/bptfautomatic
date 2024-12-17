import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';

const CONFIG_FILENAME = 'config.json';
const ACCOUNTS_FILENAME = 'accounts.json';

const defaultConfig = {
    dateFormat: "HH:mm:ss",
    acceptGifts: false,
    declineBanned: true,
    acceptEscrow: false,
    currencyExchange: { "metal->keys": false, "keys->metal": false },
    buyOrders: true,
    confirmations: "all",
    logs: {
        console: { level: "verbose" },
        file: { filename: "automatic.log", disabled: false, level: "info" },
        trade: { filename: "automatic.trade.log", disabled: false }
    },
    owners: ["<steamid64s>"]
};

let config = {};
let accounts = {};

export async function init() {
    let msg = "";
    try {
        await access(CONFIG_FILENAME, constants.F_OK);
        config = JSON.parse(await readFile(CONFIG_FILENAME, 'utf-8'));
    } catch {
        config = defaultConfig;
        await saveConfig();
        msg = "Config generated.";
    }
    return msg.trim();
}

async function saveConfig() {
    await writeFile(CONFIG_FILENAME, JSON.stringify(config, null, 4));
}

export function get(val, def) {
    return val ? config[val] || def : config;
}

export async function saveAccount(name, details) {
    accounts[name] = details;
    await writeFile(ACCOUNTS_FILENAME, JSON.stringify(accounts, null, 4));
}
