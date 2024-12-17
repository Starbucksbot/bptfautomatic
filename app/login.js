import Utils from './utils.js';
import Prompts from './prompts.js';
import { promises as fs } from 'fs';

let Automatic, steam, log, Config;

// Register automatic dependencies
export const register = (automatic) => {
    Automatic = automatic;
    steam = Automatic.steam;
    log = Automatic.log;
    Config = Automatic.config;
    Prompts.register(automatic);
};

// OAuth login with sentry and token
export const oAuthLogin = (sentry, token) => {
    return new Promise((resolve, reject) => {
        steam.oAuthLogin(sentry, token, (err, sessionID, cookies) => {
            if (err) reject(err);
            else resolve(cookies);
        });
    });
};

// Check if the user is logged in
export const isLoggedIn = async () => {
    return new Promise((resolve, reject) => {
        steam.loggedIn((err, loggedIn, familyView) => {
            if (err || !loggedIn || familyView) {
                reject([err, loggedIn, familyView]);
            } else {
                resolve();
            }
        });
    });
};

// Unlock parental (family view) mode
const parentalUnlock = async (pin) => {
    return new Promise((resolve, reject) => {
        steam.parentalUnlock(pin, (err) => {
            if (err) {
                log.error(`Unlock failed: ${err.message}`);
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

// Unlock family view with retries
export const unlockFamilyView = async () => {
    try {
        const pin = await Prompts.familyViewPin();
        await parentalUnlock(pin);
    } catch (err) {
        await unlockFamilyView();
    }
};

// Prompt for login details
export const promptLogin = async () => {
    const details = await Prompts.accountDetails();
    const acc = Config.account(details.accountName);

    if (acc?.sentry && acc?.oAuthToken) {
        log.info("Logging into Steam with OAuth token");
        return oAuthLogin(acc.sentry, acc.oAuthToken);
    }

    return performLogin(details);
};

// Perform login process
const performLogin = async (details) => {
    return new Promise((resolve, reject) => {
        steam.login(details, (err, sessionID, cookies, steamguard, oAuthToken) => {
            if (err) {
                handleLoginError(err, details, resolve, reject);
            } else {
                saveLoginDetails(details, steamguard, oAuthToken, cookies).then(() => resolve(cookies));
            }
        });
    });
};

// Handle Steam login errors
const handleLoginError = async (err, details, resolve, reject) => {
    const errcode = err.message;

    switch (errcode) {
        case 'SteamGuard':
        case 'SteamGuardMobile': {
            const isMobile = errcode === 'SteamGuardMobile';
            const code = await Prompts.steamGuardCode(isMobile);
            details[isMobile ? 'twoFactorCode' : 'authCode'] = code;
            performLogin(details).then(resolve, reject);
            break;
        }
        case 'CAPTCHA': {
            const code = await Prompts.CAPTCHA(err.captchaurl);
            details.captcha = code;
            performLogin(details).then(resolve, reject);
            break;
        }
        default: {
            log.error(`Login failed: ${errcode}`);
            await Utils.after.seconds(20);
            performLogin(details).then(resolve, reject);
        }
    }
};

// Save login details if prompted
const saveLoginDetails = async (details, steamguard, oAuthToken, cookies) => {
    const save = await Prompts.rememberLogin();
    const account = Config.account(details.accountName) || {};
    account.sentry = steamguard;

    if (save) account.oAuthToken = oAuthToken;
    await Config.saveAccount(details.accountName, account);

    log.info("Logged into Steam!");
};

