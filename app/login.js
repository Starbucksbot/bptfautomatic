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
            if (err) reject(err);
            else resolve(cookies);
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
            if (err || !loggedIn || familyView) {
                return reject([err, loggedIn, familyView]);
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
                log.error("Unlock failed: " + err.message);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Attempts to unlock Family View, prompting for PIN if necessary.
 * @returns {Promise<void>} Promise that resolves when unlocked or rejects on failure.
 */
exports.unlockFamilyView = async () => {
    try {
        const pin = await Prompts.familyViewPin();
        await parentalUnlock(pin);
    } catch (error) {
        log.error("Failed to unlock Family View:", error.message);
        // Recursive call if unlock fails, but be cautious with recursion depth
        await exports.unlockFamilyView();
    }
};

/**
 * Prompts user for login details and attempts to log in.
 * @returns {Promise<Array>} Promise resolving to cookies after successful login.
 */
async function promptLogin() {
    const details = await Prompts.accountDetails();
    const acc = Config.account(details.accountName);

    if (acc && acc.sentry && acc.oAuthToken) {
        log.info("Logging into Steam with OAuth token");
        return await oAuthLogin(acc.sentry, acc.oAuthToken);
    }

    return await performLogin(details);
}

exports.promptLogin = promptLogin;

/**
 * Performs the actual login with Steam.
 * @param {Object} details - Login details including username, password, etc.
 * @returns {Promise<Array>} Promise resolving to cookies on successful login.
 */
async function performLogin(details) {
    return new Promise(async (resolve, reject) => {
        steam.login(details, async (err, sessionID, cookies, steamguard, oAuthToken) => {
            if (err) {
                let errcode = err.message;
                switch (errcode) {
                    case 'SteamGuard':
                    case 'SteamGuardMobile': {
                        const isMobile = errcode === "SteamGuardMobile";
                        const code = await Prompts.steamGuardCode(isMobile);
                        details[isMobile ? "twoFactorCode" : "authCode"] = code;
                        try {
                            const result = await performLogin(details);
                            resolve(result);
                        } catch (error) {
                            reject(error);
                        }
                        return;
                    }
                    case 'CAPTCHA':
                        const captchaCode = await Prompts.CAPTCHA(err.captchaurl);
                        details.captcha = captchaCode;
                        try {
                            const result = await performLogin(details);
                            resolve(result);
                        } catch (error) {
                            reject(error);
                        }
                        return;
                    default:
                        log.error("Login failed: " + errcode);
                        await Utils.after.seconds(20);
                        try {
                            const result = await performLogin(details);
                            resolve(result);
                        } catch (error) {
                            reject(error);
                        }
                        return;
                }
            }
            
            const save = await Prompts.rememberLogin();
            let account = Config.account(details.accountName) || {};
            account.sentry = steamguard;
            if (save) account.oAuthToken = oAuthToken;
            try {
                await Config.saveAccount(details.accountName, account);
                log.info("Logged into Steam!");
                resolve(cookies);
            } catch (saveErr) {
                log.error("Failed to save account details:", saveErr.message);
                reject(saveErr);
            }
        });
    });
}