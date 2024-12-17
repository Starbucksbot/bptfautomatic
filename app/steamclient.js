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

    steam.on('debug', msg => log.debug(msg));
    steam.on('sessionExpired', () => {
        console.log('sessionExpired');
        relogSession();
    });
};

/**
 * Attempts to relog when the session expires.
 */
async function relogSession() {
    log.verbose("Renewing session");
    await main(true);
}

/**
 * Saves the cookies for the Steam session.
 * @param {Array} cookies - The cookies to save.
 * @param {boolean} [quiet=false] - Whether to log the login quietly.
 */
function saveCookies(cookies, quiet = false) {
    communityCookies = cookies;
    steam.setCookies(cookies);
    if (!quiet) log.info("Logged into Steam!");
    else log.debug("Logged into Steam: cookies set");
}

/**
 * Retrieves the backpack.tf token from the account configuration or gets a new one.
 * @returns {string} - The backpack.tf token.
 */
function getBackpackToken() {
    const acc = Config.account();
    return acc?.bptfToken || backpack.getToken();
}

exports.connect = async () => {
    await main(true);
}

/**
 * Reads the account data from a JSON file.
 * @returns {Promise<Object|boolean>} - Parsed account data or false if reading fails.
 */
async function loginData() {
    try {
        const data = await fs.readFile(path.join(__dirname, 'accounts.json'), 'utf8');
        return JSON.parse(data);
    } catch {
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
        let account = accountData[accountData.lastUsedAccount] || {};

        if (!account.name || !account.password) {
            const promtData = await Prompts.accountDetails();
            account.name = promtData.accountName;
            account.password = promtData.password;
        }

        if (!account.bptfToken) account.bptfToken = await Prompts.backpackToken();
        if (!account.bptApiKey) account.bptApiKey = await Prompts.backpackApiKey();

        account.identity_secret = (!account.identity_secret && !account.dont_ask_identity_secret_again) 
            ? await Prompts.identity_secret() 
            : account.identity_secret;
        if (!account.identity_secret || account.identity_secret.length < 10) {
            account.dont_ask_identity_secret_again = true;
        }

        account.sharedSecret = (!account.sharedSecret && !account.dont_ask_sharedSecret_again) 
            ? await Prompts.sharedSecret() 
            : account.sharedSecret;
        if (!account.sharedSecret || account.sharedSecret.length < 10) {
            account.dont_ask_sharedSecret_again = true;
        }

        await Config.saveAccount(account.name, account);

        const session = new SteamSession.LoginSession(SteamSession.EAuthTokenPlatformType.MobileApp);

        session.on('authenticated', async () => {
            const cookies = await session.getWebCookies();
            saveCookies(cookies);
            if (enableTradeManager) await setupTradeManager();
            else manager.setCookies(communityCookies);
        });

        session.on('timeout', () => {
            console.log('This login attempt has timed out.');
            relogSession();
        });

        session.on('error', (err) => {
            console.error(`ERROR: This login attempt has failed! ${err.message}`);
        });

        let startResult = await session.startWithCredentials({ accountName: account.name, password: account.password });
        if (startResult.actionRequired) {
            const codeActionTypes = [SteamSession.EAuthSessionGuardType.EmailCode, SteamSession.EAuthSessionGuardType.DeviceCode];
            const codeAction = startResult.validActions.find(action => codeActionTypes.includes(action.type));
            if (codeAction) {
                if (codeAction.type === SteamSession.EAuthSessionGuardType.EmailCode) {
                    console.log(`A code has been sent to your email address at ${codeAction.detail}.`);
                } else {
                    console.log('You need to provide a Steam Guard Mobile Authenticator code.');
                }

                const sharedSecret = account.sharedSecret;
                if (sharedSecret && sharedSecret.length > 10) {
                    const code = SteamTotp.getAuthCode(sharedSecret);
                    await session.submitSteamGuardCode(code);
                } else {
                    const code = await Prompts.steamGuardCode("SteamGuardMobile");
                    await session.submitSteamGuardCode(code);
                }
            }
        }
    } catch (err) {
        console.error('Login error:', err);
        // Consider implementing a retry mechanism here if needed
    }
}

/**
 * Manages the heartbeat loop to keep the session alive.
 */
function heartbeatLoop() {
    backpack.heartbeat().then(timeout => setTimeout(heartbeatLoop, timeout)).catch(err => {
        console.error('Heartbeat failed:', err);
        setTimeout(heartbeatLoop, 10000); // Retry after 10 seconds
    });
}

/**
 * Sets up the trade manager with necessary configurations.
 */
async function setupTradeManager() {
    try {
        const timeout = await backpack.heartbeat();

        if (timeout === "getToken") {
            await backpack.getToken().then(setupTradeManager);
        } else if (timeout === "getApiKey") {
            await backpack.getApiKey().then(setupTradeManager);
        } else {
            const acc = Config.account();

            if (Confirmations.enabled()) {
                if (acc.identity_secret) {
                    log.info(`Starting Steam confirmation checker (accepting ${automatic.confirmationsMode()})`);
                    Confirmations.setSecret(acc.identity_secret);
                } else {
                    log.warn("Trade offers won't be confirmed automatically. Supply an identity_secret to enable auto-acceptance. Use 'help identity_secret' for guidance. Hide this message with 'confirmations none'.");
                }
            } else {
                log.verbose("Trade confirmations are disabled; confirmation checker not started.");
            }

            log.debug("Launching input console.");
            appConsole.startConsole(automatic);

            if (!g_RelogInterval) {
                //g_RelogInterval = setInterval(relog, 1 * 60 * 60 * 1000); // every hour, currently commented out
            }
            setTimeout(heartbeatLoop, timeout);

            await new Promise((resolve, reject) => {
                manager.setCookies(communityCookies, (err) => {
                    if (err) {
                        log.error("Can't get apiKey from Steam: " + err);
                        reject(err);
                    } else {
                        log.info(`Automatic ready. Sell orders enabled; Buy orders ${automatic.buyOrdersEnabled() ? "enabled" : "disabled (type buyorders toggle to enable, help buyorders for info)"}`);
                        setInterval(checkOfferCount, 5 * 60 * 1000);
                        resolve();
                    }
                });
            });
        }
    } catch(err) {
        console.error('Error in setupTradeManager:', err);
        await Utils.after.timeout(60 * 1000); // Wait for 1 minute before retrying
        await setupTradeManager();
    }
}

/**
 * Relogs the user into Steam if necessary credentials are available.
 */
async function relog() {
    const acc = Config.account();
    if (acc && acc.sentry && acc.oAuthToken) {
        log.verbose("Renewing web session");
        try {
            const cookies = await Login.oAuthLogin(acc.sentry, acc.oAuthToken, true);
            saveCookies(cookies, true);
            log.verbose("Web session renewed");
        } catch (err) {
            log.debug(`Failed to relog (checking login): ${err.message}`);
            try {
                await Login.isLoggedIn();
                log.verbose("Web session still valid");
            } catch {
                log.warn("Web session no longer valid. Steam might be down or session expired. Refresh by logging out, restarting Automatic, and re-entering credentials");
            }
        }
    } else {
        log.verbose("OAuth token not saved, can't renew web session.");
    }
}

/**
 * Checks the number of trade offers and logs the count.
 */
async function checkOfferCount() {
    if (manager.apiKey === null) return;

    try {
        const [_, response] = await Utils.getJSON({
            url: "https://api.steampowered.com/IEconService/GetTradeOffersSummary/v1/?key=" + manager.apiKey
        });

        if (!response) {
            log.warn("Cannot get trade offer count: malformed response");
            log.debug(`apiKey used: ${manager.apiKey}`);
            return;
        }

        const { 
            pending_sent_count: pendingSent, 
            pending_received_count: pendingReceived, 
            escrow_received_count, 
            escrow_sent_count 
        } = response;

        log.verbose(`${pendingReceived} incoming offer${pendingReceived === 1 ? '' : 's'} (${escrow_received_count} on hold), ${pendingSent} sent offer${pendingSent === 1 ? '' : 's'} (${escrow_sent_count} on hold)`);
    } catch (msg) {
        log.warn("Cannot get trade offer count: " + msg);
        log.debug(`apiKey used: ${manager.apiKey}`);
    }
}