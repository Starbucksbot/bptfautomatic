import readline from 'readline';
import { Config } from './config.js';
import { setSecret } from './confirmations.js';
import { heartbeat } from './backpacktf.js';

const configToggles = ["acceptGifts", "declineBanned", "acceptEscrow", "buyOrders"];
const configToggleNames = configToggles.map(name => name.toLowerCase());

let automatic;

const help = {
    identitysecret: `
To configure identity_secret for trade confirmations, extract your identity_secret key.
Refer to backpack.tf forums for extraction guides:
- Android: http://forums.backpack.tf/index.php?/topic/46354-/
- iOS: http://forums.backpack.tf/index.php?/topic/45995-/`,
    logout: "Logs you out of your account and deletes the OAuth token.",
    toggle: `Toggles a config setting: ${configToggles.join(", ")}`,
};

const commands = {
    async identitysecret(data, acc) {
        if (!data) return console.log("Usage: identity_secret <base64 identity_secret>");
        acc.identity_secret = data;
        await Config.saveAccount(acc);
        console.log("identity_secret saved. Trade confirmation mode updated.");
        await setSecret(data);
    },
    async toggle(data) {
        const name = data.toLowerCase();
        if (!configToggleNames.includes(name)) {
            console.log(`Unknown config toggle: ${name}. List: ${configToggles.join(", ")}`);
            return;
        }
        const enabled = !Config.get(name);
        Config.write({ ...Config.get(), [name]: enabled });
        console.log(`${enabled ? "Enabled" : "Disabled"} ${name}.`);
    },
    heartbeat: async () => {
        console.log("Sending heartbeat to backpack.tf...");
        await heartbeat();
    },
    help(data) {
        if (help[data]) console.log(help[data]);
        else console.log("Available commands: " + Object.keys(commands).join(", "));
    },
    logout() {
        console.log("Logged out successfully.");
        process.exit(0);
    }
};

export const startConsole = (Automatic) => {
    automatic = Automatic;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'automatic> ',
        completer: (line) => {
            const completions = Object.keys(commands);
            const hits = completions.filter(c => c.startsWith(line));
            return [hits.length ? hits : completions, line];
        }
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const [command, ...args] = line.trim().split(" ");
        const acc = Config.account();
        const cmdFunc = commands[command.toLowerCase()];
        if (cmdFunc) await cmdFunc(args.join(" "), acc);
        else console.log(`Unknown command: ${command}`);
        rl.prompt();
    });
};
