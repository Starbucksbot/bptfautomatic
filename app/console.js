const Config = require('./config');
const readline = require('readline');

// Define toggles and their corresponding names for consistency
const configToggles = ["acceptGifts", "declineBanned", "acceptEscrow", "buyOrders"];
const configToggleNames = configToggles.map(name => name.toLowerCase());

const help = {
    identitysecret: ``,
    heartbeat: "Force-send a heartbeat to backpack.tf. This refreshes your buy orders, currency conversion data, and bumps your listings if applicable.",
    logout: "Logs you out of your account by deleting your OAuth token and closes Automatic. Use `logout keep` to keep your OAuth token so you can log in again once you enter your credentials.",
    toggle: `Toggles a config setting. Available settings: ${configToggles.join(", ")}. Type help <setting> to find out what it does. Type <setting> (as a command) to find out whether it's enabled. Type toggle <setting> or <setting> toggle to toggle it.`,
    acceptgifts: settingHelp('acceptGifts', 'Enable this setting to accept offers where you will receive items without offering any ("for free")'),
    declinebanned: settingHelp('declineBanned', 'Enable this setting to accept offers from users marked as a scammer or banned on backpack.tf (not recommended)'),
    acceptescrow: settingHelp('acceptEscrow', 'Enable this setting to accept offers even if they incur an escrow period. Type acceptescrow decline to automatically decline escrow offers.'),
    buyorders: settingHelp('buyOrders', 
`Enable this setting to enable or disable buy orders being handled by Automatic. Use the heartbeat commands afterwards to update your buy orders. (Buy orders are handled inside the application)`),
    confirmations: () => 
`<confirmations: ${automatic.confirmationsMode()}>
Accept trade confirmations automatically. identity_secret must be provided first, see help identitysecret.

Possible options are:
- all (default): automatically accept all trade confirmations, including market confirmations
- own: only accept trade confirmations from trade offers accepted by Automatic.
- own+market: accept trade confirmations from trade offers accepted by Automatic, plus all market confirmations
- none: disable this feature`,
    exchange: () => {
        const ce = Config.get('currencyExchange') || {};
        return `<exchange.metal->keys: ${ce["metal->keys"] ? "enabled" : "disabled"}
<exchange.keys->metal: ${ce["keys->metal"] ? "enabled" : "disabled"}
Toggles currency exchange for the sender's side of the trade, using backpack.tf community suggested currency values. The mid price (average price) is used ((low + high)/2). This affects any item values too.`;
    },
    help: "Shows help for entered command."
};

const commands = {
    identitysecret: async (data, acc) => {
        if (!data) {
            console.log("Usage: identity_secret <base64 identity_secret for your account>");
            return;
        }

        acc.identity_secret = data;
        try {
            await Config.saveAccount(acc);
            console.log(`identity_secret saved. Using trade confirmation mode: ${automatic.confirmationsMode()}. (help confirmations for info)`);
            require('./confirmations').setSecret(data);
        } catch (error) {
            console.error(`Error saving identity secret: ${error.message}`);
        }
    },
    toggle: (data) => {
        const name = data.toLowerCase();
        if (!configToggleNames.includes(name)) {
            console.log(`Unknown config toggle: ${name}. List: ${configToggles.join(", ")}`);
        } else {
            commands[name]("toggle");
        }
    },
    acceptgifts: settingToggleHandler("acceptGifts"),
    declinebanned: settingToggleHandler("declineBanned"),
    acceptescrow: settingToggleHandler("acceptEscrow", "decline", async () => {
        const config = Config.get();
        config.acceptEscrow = "decline";
        await Config.write(config);
        console.log(`Set acceptEscrow to "decline".`);
    }),
    buyorders: settingToggleHandler("buyOrders"),
    confirmations: async (data) => {
        const mode = data.toLowerCase();
        const validModes = ["all", "own", "own+market", "none"];
        if (!validModes.includes(mode)) {
            return console.log(`Unsupported trade confirmation mode "${mode}". Use "help confirmations".`);
        }
    
        if (mode === automatic.confirmationsMode()) {
            return console.log(`The trade confirmation mode is already "${mode}".`);
        }
    
        const config = await Config.get(); // Ensure Config.get() returns a Promise
        config.confirmations = mode;
        await Config.write(config);
        console.log(`Set confirmations to "${mode}".`);
    },
    exchange: async (data, _, linedata) => {
        const type = (linedata.split(' ')[1] || "").toLowerCase();

        if (data !== "toggle" || !["metal->keys", "keys->metal"].includes(type)) {
            return console.log("Format: exchange toggle {metal->keys,keys->metal}");
        }

        const config = Config.get();
        if (typeof config.currencyExchange !== "object") config.currencyExchange = {};
        const now = (config.currencyExchange[type] = !config.currencyExchange[type]);
        await Config.write(config);
        console.log(`Now ${now ? "allowing" : "disallowing"} currency exchanges from ${type}`);
    },
    heartbeat: () => {
        require('./backpacktf').heartbeat();
    },
    logout: async (data, acc) => {
        try {
            if (data.toLowerCase() === "keep") {
                Config.setLastUsed("");
            } else {
                delete acc.oAuthToken;
                await Config.saveAccount(acc);
            }
            console.log("Logged out successfully.");
            process.exit(0);
        } catch (error) {
            console.error(`Error during logout: ${error.message}`);
        }
    },
    help: (data) => {
        const cmd = serializeCommand(data);
        if (help[cmd]) {
            console.log(typeof help[cmd] === "function" ? help[cmd]() : help[cmd]);
        } else {
            showCommands();
        }
    },
    '.debug': (data, acc, linedata) => {
        try {
            // Safe alternative to eval for debugging
            const debugResult = new Function(`return (${linedata})`)();
            console.log(debugResult);
        } catch (error) {
            console.error(`Debug error: ${error.message}`);
        }
    },
    '.rpd': () => {
        if (automatic && automatic.manager) {
            automatic.manager.pollData = {};
        } else {
            console.log("Automatic or manager not initialized.");
        }
    }
};

function settingHelp(conf, str) {
    return () => `<${conf}: ${Config.get(conf) ? "enabled" : "disabled"}>
\n${str}`;
}

function settingToggleHandler(name, custom, customHandler) {
    return async (data) => {
        data = data.toLowerCase();

        let conf = Config.get(name);
        if (custom && data === custom) {
            await customHandler();
            return;
        }
        if (data !== "toggle") {
            console.log(`${name}: ${typeof conf === "string" ? `"${conf}"` : (conf ? "enabled" : "disabled")}`);
            return;
        }

        if (typeof conf === "string") {
            console.log(`${name} cannot be toggled, its current value is "${conf}".`);
            return;
        }

        const config = Config.get();
        const enabled = (config[name] = !conf);
        await Config.write(config);
        console.log(`${enabled ? "Enabled" : "Disabled"} ${name}.`);
    };
}

function showCommands() {
    console.log("Commands: " + Object.keys(commands).filter(command => !command.startsWith('.')).join(", "));
    console.log("Use help [command name] for help on that command. Use <TAB> to autocomplete.");
}

function serializeCommand(command) {
    return (command || "").replace('_', '').toLowerCase();
}

function completer(line) {
    const completions = Object.keys(commands);
    const hits = completions.filter(c => c.startsWith(line));
    return [hits.length ? hits : completions, line];
}

let automatic, Config;

exports.startConsole = (Automatic) => {
    const input = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'automatic> ',
        completer
    });
    automatic = Automatic;
    Config = Automatic.config;

    input.on('line', async (line) => {
        const acc = Config.account();
        const parts = line.split(' ');

        const command = serializeCommand(parts[0]);
        const data = parts[1] || "";
        const linedata = parts.slice(1).join(' ');

        if (commands[command]) {
            try {
                await commands[command](data, acc, linedata);
            } catch (error) {
                console.error(`Error executing command ${command}: ${error.message}`);
            }
        } else {
            console.log("Unknown command: " + parts[0]);
            showCommands();
        }
        input.prompt();
    }).on('close', () => {
        console.log('Console closed. Exiting...');
        process.exit(0);
    });

    input.prompt();
};
