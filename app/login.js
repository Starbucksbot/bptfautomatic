const Utils = require('./utils');
const Prompts = require('./prompts');
const fs = require('fs/promises');
const path = require('path');

let Automatic, steam, log, Config;

exports.register = (automatic) => {
    Automatic = automatic;
    steam = Automatic.steam;
    log = Automatic.log;
    Config = Automatic.config;
    Prompts.register(automatic);
};

/**
 * Performs OAuth login using the provided sentry file and token.
 * @param {string} sentry - Path to the sentry file.
 * @param {string} token - OAuth token for login.
 * @returns {Promise<Array>} Promise resolving to cookies on success.
 */
async function oAuthLogin(sentry, token) {
    return new Promise((resolve, reject) => {
        steam.oAuthLogin(sentry, token, (err, sessionID, cookies) => {
            if (err) {
                log.error("OAuth login failed:", err.message);
                reject(err);
            } else {
                resolve(cookies);
            }
        });
    });
}

exports.oAuthLogin = oAuthLogin;

/**
 * Checks if the user is logged into Steam.
 * @returns {Promise<void>} Resolves if logged in, rejects with error details if not.
 */
async function isLoggedIn() {
    return new Promise((resolve, reject) => {
        steam.loggedIn((err, loggedIn, familyView) => {
            if (err) {
                log.error("Error checking login status:", err.message);
                return reject(err);
            }
            if (!loggedIn || familyView) {
                log.warn("Not logged in or Family View is enabled.");
                return reject(new Error("Not logged in or Family View active."));
            }
            resolve();
        });
    });
}

exports.isLoggedIn = isLoggedIn;

/**
 * Unlocks Family View on Steam with the provided PIN.
 * @param {string} pin - The Family View PIN.
 * @returns {Promise<void>} Resolves on success, rejects with error on failure.
 */
async function parentalUnlock(pin) {
    return new Promise((resolve, reject) => {
        steam.parentalUnlock(pin, (err) => {
            if (err) {
                log.error("Failed to unlock Family View:", err.message);
                return reject(err);
            }
            resolve();
        });
    });
}

/**
 * Attempts to unlock Family View, prompting for PIN if necessary.
 * Adds a retry limit to avoid infinite recursion.
 * @param {number} retries - Current retry count.
 * @returns {Promise<void>} Promise that resolves when unlocked or rejects on failure.
 */
exports.unlockFamilyView = async (retries = 3) => {
    if (retries <= 0) {
        log.error("Max retries reached for unlocking Family View.");
        throw new Error("Failed to unlock Family View after multiple attempts.");
    }
    try {
        const pin = await Prompts.familyViewPin();
        await parentalUnlock(pin);
    } catch (error) {
        log.error(`Retrying Family View unlock (${retries - 1} attempts left)...`);
        await exports.unlockFamilyView(retries - 1);
    }
};

/**
 * Prompts user for login details and attempts to log in.
 * @returns {Promise<Array>} Promise resolving to cookies after successful login.
 */
async function promptLogin() {
    try {
        const details = await Prompts.accountDetails();
        const acc = Config.account(details.accountName);

        if (acc && acc.sentry && acc.oAuthToken) {
            log.info("Logging into Steam with OAuth token.");
            return await oAuthLogin(acc.sentry, acc.oAuthToken);
        }

        return await performLogin(details);
    } catch (error) {
        log.error("Login prompt failed:", error.message);
        throw error;
    }
}

exports.promptLogin = promptLogin;

/**
 * Performs the actual login with Steam.
 * Adds a retry count for cyclic scenarios like Steam Guard or CAPTCHA.
 * @param {Object} details - Login details including username, password, etc.
 * @param {number} retries - Retry count to avoid infinite loops.
 * @returns {Promise<Array>} Promise resolving to cookies on successful login.
 */
async function performLogin(details, retries = 3) {
    if (retries <= 0) {
        log.error("Max retries reached for login.");
        throw new Error("Login failed after multiple attempts.");
    }

    return new Promise((resolve, reject) => {
        steam.login(details, async (err, sessionID, cookies, steamguard, oAuthToken) => {
            if (err) {
                log.warn("Login attempt failed:", err.message);
                switch (err.message) {
                    case 'SteamGuard':
                    case 'SteamGuardMobile': {
                        const isMobile = err.message === "SteamGuardMobile";
                        const code = await Prompts.steamGuardCode(isMobile);
                        details[isMobile ? "twoFactorCode" : "authCode"] = code;
                        return resolve(await performLogin(details, retries - 1));
                    }
                    case 'CAPTCHA':
                        const captchaCode = await Prompts.CAPTCHA(err.captchaurl);
                        details.captcha = captchaCode;
                        return resolve(await performLogin(details, retries - 1));
                    default:
                        return reject(err);
                }
            }

            const save = await Prompts.rememberLogin();
            const account = Config.account(details.accountName) || {};
            account.sentry = steamguard;
            if (save) account.oAuthToken = oAuthToken;

            try {
                await Config.saveAccount(details.accountName, account);
                log.info("Successfully logged into Steam.");
                resolve(cookies);
            } catch (saveErr) {
                log.error("Failed to save account details:", saveErr.message);
                reject(saveErr);
            }
        });
    });
}
