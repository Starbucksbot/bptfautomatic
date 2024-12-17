import Utils from './utils.js';
import backpack from './backpacktf.js';
import Login from './login.js';
import Confirmations from './confirmations.js';
import appConsole from './console.js';
import Prompts from './prompts.js';

import SteamTotp from 'steam-totp';
import { LoginSession, EAuthTokenPlatformType, EAuthSessionGuardType } from 'steam-session';
import { readFile } from 'fs/promises';

let steam, log, Config, manager, automatic;
let communityCookies = null;
let g_RelogInterval = null;

// Register the Steam Client with Automatic
export const register = (Automatic) => {
    steam = Automatic.steam;
    log = Automatic.log;
    Config = Automatic.config;
    manager = Automatic.manager;
    automatic = Automatic;

    Login.register(Automatic);

    steam.on('debug', msg => log.debug(msg));
    steam.on('sessionExpired', relogSession);
};

// Relogging logic
const relogSession = () => {
    log.verbose("Renewing session");
    main();
};

// Save cookies and set session
const saveCookies = (cookies, quiet = false) => {
    communityCookies = cookies;
    steam.setCookies(cookies);
    log[quiet ? 'debug' : 'info']("Logged into Steam: cookies set");
};

// Retrieve backpack.tf token
const getBackpackToken = () => {
    const acc = Config.account();
    return acc?.bptfToken || backpack.getToken();
};

// Load account data from file
const loadAccountData = async () => {
    try {
        const data = await readFile('./accounts.json', 'utf-8');
        return JSON.parse(data);
    } catch {
        return false;
    }
};

// Main function to manage login and session setup
export const connect = () => main(true);

const main = async (enableTradeManager = false) => {
    try {
        const accountData = await loadAccountData();
        const account = accountData?.[accountData.lastUsedAccount] || {};
        
        // Prompt for missing credentials
        if (!account.name || !account.password) {
            const promptData = await Prompts.accountDetails();
            Object.assign(account, { name: promptData.accountName, password: promptData.password });
        }

        if (!account.bptfToken) account.bptfToken = await Prompts.backpackToken();
        if (!account.bptApiKey) account.bptApiKey = await Prompts.backpackApiKey();
        if (!account.identity_secret && !account.dont_ask_identity_secret_again) {
            account.identity_secret = await Prompts.identity_secret();
            if (!account.identity_secret || account.identity_secret.length < 10)
                account.dont_ask_identity_secret_again = true;
        }

        if (!account.sharedSecret && !account.dont_ask_sharedSecret_again) {
            account.sharedSecret = await Prompts.sharedSecret();
            if (!account.sharedSecret || account.sharedSecret.length < 10)
                account.dont_ask_sharedSecret_again = true;
        }

        Config.saveAccount(account.name, account);

        // Create a LoginSession for Steam
        const session = new LoginSession(EAuthTokenPlatformType.MobileApp);

        session.on('authenticated', async () => {
            const cookies = await session.getWebCookies();
            saveCookies(cookies);
            if (enableTradeManager) setupTradeManager();
            else manager.setCookies(communityCookies);
        });

        session.on('timeout', () => {
            log.error('This login attempt has timed out.');
            relogSession();
        });

        session.on('error', err => log.error(`Login failed: ${err.message}`));

        // Start login process
        const startResult = await session.startWithCredentials({
            accountName: account.name,
            password: account.password
        });

        if (startResult.actionRequired) {
            await handleSteamGuard(session, account);
        }
    } catch (err) {
        log.error(`Error during login: ${err.message}`);
    }
};

// Handle Steam Guard Code
const handleSteamGuard = async (session, account) => {
    const codeActionTypes = [EAuthSessionGuardType.EmailCode, EAuthSessionGuardType.DeviceCode];
    const codeAction = session.startResult?.validActions?.find(action => codeActionTypes.includes(action.type));

    if (codeAction) {
        const code = account.sharedSecret
            ? SteamTotp.getAuthCode(account.sharedSecret)
            : await Prompts.steamGuardCode("SteamGuardMobile");
        await session.submitSteamGuardCode(code);
    }
};

// Try to log in with stored credentials
const tryLogin = async () => {
    try {
        await Login.isLoggedIn();
    } catch ([err, loggedIn, familyView]) {
        if (err) {
            log.error(`Cannot check Steam login: ${err}`);
            await Utils.after.seconds(10);
            return tryLogin();
        }
        if (!loggedIn) {
            log.warn("Saved OAuth token is no longer valid.");
            const cookies = await Login.promptLogin();
            saveCookies(cookies);
            return tryLogin();
        }
        if (familyView) {
            log.warn("This account is protected by Family View.");
            await Login.unlockFamilyView();
            return tryLogin();
        }
    }
};

// Setup trade manager
const setupTradeManager = async () => {
    try {
        const timeout = await backpack.heartbeat();

        if (timeout === "getToken") return backpack.getToken().then(setupTradeManager);
        if (timeout === "getApiKey") return backpack.getApiKey().then(setupTradeManager);

        const acc = Config.account();

        if (Confirmations.enabled()) {
            if (acc.identity_secret) {
                log.info(`Starting Steam confirmation checker (accepting ${automatic.confirmationsMode()})`);
                Confirmations.setSecret(acc.identity_secret);
            } else {
                log.warn("Trade offers won't be confirmed automatically. Add an identity_secret to enable confirmations.");
            }
        }

        log.debug("Launching input console.");
        appConsole.startConsole(automatic);

        manager.setCookies(communityCookies, (err) => {
            if (err) {
                log.error(`Cannot get apiKey from Steam: ${err.message}`);
                process.exit(1);
            }

            log.info(`Automatic ready. Buy orders ${automatic.buyOrdersEnabled() ? "enabled" : "disabled"}.`);
            checkOfferCount();
            setInterval(checkOfferCount, 1000 * 60 * 5);
        });
    } catch (err) {
        log.error(`Trade manager setup failed: ${err.message}`);
        await Utils.after.timeout(60000);
        setupTradeManager();
    }
};

// Check trade offer counts
const checkOfferCount = async () => {
    if (!manager.apiKey) return;

    try {
        const [, response] = await Utils.getJSON({
            url: `https://api.steampowered.com/IEconService/GetTradeOffersSummary/v1/?key=${manager.apiKey}`
        });

        if (response) {
            const pendingSent = response.pending_sent_count;
            const pendingReceived = response.pending_received_count;

            log.verbose(`${pendingReceived} incoming offers (${response.escrow_received_count} on hold), ${pendingSent} sent offers (${response.escrow_sent_count} on hold)`);
        } else {
            log.warn("Malformed response when retrieving trade offer count.");
        }
    } catch (err) {
        log.warn(`Cannot get trade offer count: ${err.message}`);
    }
};
