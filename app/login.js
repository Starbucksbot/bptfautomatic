import Utils from './utils.js';
import Prompts from './prompts.js';

let Automatic, steam, log, Config;

export const register = (automatic) => {
    Automatic = automatic;
    steam = Automatic.steam;
    log = Automatic.log;
    Config = Automatic.config;
    Prompts.register(automatic);
};

export const promptLogin = async () => {
    const details = await Prompts.accountDetails();
    const acc = Config.account(details.accountName);
    if (acc?.sentry && acc?.oAuthToken) return oAuthLogin(acc.sentry, acc.oAuthToken);
    return performLogin(details);
};

const oAuthLogin = async (sentry, token) => {
    return new Promise((resolve, reject) => {
        steam.oAuthLogin(sentry, token, (err, sessionID, cookies) => err ? reject(err) : resolve(cookies));
    });
};

const performLogin = async (details) => {
    steam.login(details, (err, _, cookies, sentry, token) => {
        if (err) log.error(`Login failed: ${err.message}`);
        else saveLoginDetails(details, sentry, token, cookies);
    });
};

const saveLoginDetails = async (details, steamguard, oAuthToken, cookies) => {
    const account = Config.account(details.accountName) || {};
    account.sentry = steamguard;
    if (await Prompts.rememberLogin()) account.oAuthToken = oAuthToken;
    await Config.saveAccount(details.accountName, account);
    log.info("Logged into Steam!");
};
