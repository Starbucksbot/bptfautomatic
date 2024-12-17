const Utils = require('./utils');
const backpack = require('./backpacktf');
const Login = require('./login');
const Confirmations = require('./confirmations');
const appConsole = require('./console');
const Prompts = require('./prompts');
const SteamTotp = require('steam-totp');
const SteamSession = require('steam-session');
const fs = require('fs/promises');
const path = require('path');

let steam, log, Config, manager, automatic;

let communityCookies;
let g_RelogInterval = null;

exports.checkOfferCount = checkOfferCount;
exports.register = (Automatic) => {
    steam = Automatic.steam;
    log = Automatic.log;
    Config = Automatic.config;
    manager = Automatic.manager;
    automatic = Automatic;

    Login.register(Automatic);

    steam.on('debug', (msg) => log.debug(msg));
    steam.on('sessionExpired', () => {
        log.warn("Session expired. Attempting to relog...");
        relogSession();
    });
};

/**
 * Relogs into Steam when the session expires.
 */
async function relogSession() {
    try {
        log.verbose("Renewing session...");
        await main(true);
    } catch (err) {
        log.error("Failed to relog session:", err.message);
        // Retry mechanism with a delay
        setTimeout(relogSession, 60000); // Retry after 1 minute
    }
}

/**
 * Saves the cookies for the Steam session.
 * @param {Array} cookies - The cookies to save.
 * @param {boolean} [quiet=false] - Whether to log the login quietly.
 */
function saveCookies(cookies, quiet = false) {
    communityCookies = cookies;
    steam.setCookies(cookies);
    if (!quiet) log.info("Logged into Steam successfully!");
    else log.debug("Cookies set quietly for Steam session.");
}

/**
 * Reads the account data from a JSON file.
 * @returns {Promise<Object|boolean>} - Parsed account data or false if reading fails.
 */
async function loginData() {
    try {
        const data = await fs.readFile(path.join(__dirname, 'accounts.json'), 'utf8');
        return JSON.parse(data);
    } catch (err) {
        log.error("Failed to read account data:", err.message);
        return false;
    }
}

/**
 * Main function to handle login and setup processes.
 * @param {boolean} [enableTradeManager=false] - Whether to enable trade manager setup.
 */
async function main(enableTradeManager = false) {
    try {
        const accountData = await loginData();
        const account = accountData[accountData.lastUsedAccount] || {};

        if (!account.name || !account.password) {
            log.info("Prompting for account details...");
            const promptData = await Prompts.accountDetails();
            account.name = promptData.accountName;
            account.password = promptData.password;
        }

        // Prompt for missing tokens and secrets
        account.bptfToken = account.bptfToken || (await Prompts.backpackToken());
        account.bptApiKey = account.bptApiKey || (await Prompts.backpackApiKey());

        if (!account.identity_secret || account.identity_secret.length < 10) {
            account.identity_secret = await Prompts.identity_secret();
        }
        if (!account.sharedSecret || account.sharedSecret.length < 10) {
            account.sharedSecret = await Prompts.sharedSecret();
        }

        await Config.saveAccount(account.name, account);

        const session = new SteamSession.LoginSession(SteamSession.EAuthTokenPlatformType.MobileApp);

        session.on('authenticated', async () => {
            try {
                const cookies = await session.getWebCookies();
                saveCookies(cookies);
                if (enableTradeManager) {
                    await setupTradeManager();
                } else {
                    manager.setCookies(communityCookies);
                }
            } catch (err) {
                log.error("Error during authentication:", err.message);
            }
        });

        session.on('timeout', () => {
            log.warn("Login attempt timed out. Retrying...");
            relogSession();
        });

        session.on('error', (err) => {
            log.error("Login attempt failed:", err.message);
        });

        const startResult = await session.startWithCredentials({ accountName: account.name, password: account.password });
        if (startResult.actionRequired) {
            await handleActionRequired(startResult, account, session);
        }
    } catch (err) {
        log.error("Login error:", err.message);
    }
}

/**
 * Handles required actions during login (e.g., Steam Guard codes).
 */
async function handleActionRequired(startResult, account, session) {
    try {
        const codeActionTypes = [SteamSession.EAuthSessionGuardType.EmailCode, SteamSession.EAuthSessionGuardType.DeviceCode];
        const codeAction = startResult.validActions.find((action) => codeActionTypes.includes(action.type));

        if (codeAction) {
            if (codeAction.type === SteamSession.EAuthSessionGuardType.EmailCode) {
                log.info(`Email code required: sent to ${codeAction.detail}`);
            } else {
                log.info("Steam Guard Mobile Authenticator code required.");
            }

            const sharedSecret = account.sharedSecret;
            const code = sharedSecret && sharedSecret.length > 10
                ? SteamTotp.getAuthCode(sharedSecret)
                : await Prompts.steamGuardCode("SteamGuardMobile");

            await session.submitSteamGuardCode(code);
        }
    } catch (err) {
        log.error("Error handling action required:", err.message);
        throw err;
    }
}

/**
 * Checks the number of trade offers and logs the count.
 */
async function checkOfferCount() {
    if (!manager.apiKey) return;

    try {
        const [_, response] = await Utils.getJSON({
            url: `https://api.steampowered.com/IEconService/GetTradeOffersSummary/v1/?key=${manager.apiKey}`,
        });

        if (!response) {
            log.warn("Malformed response while fetching trade offer count.");
            return;
        }

        const {
            pending_sent_count: pendingSent,
            pending_received_count: pendingReceived,
            escrow_received_count,
            escrow_sent_count,
        } = response;

        log.verbose(`${pendingReceived} incoming offer(s) (${escrow_received_count} on hold), ${pendingSent} sent offer(s) (${escrow_sent_count} on hold)`);
    } catch (err) {
        log.warn("Failed to fetch trade offer count:", err.message);
    }
}
