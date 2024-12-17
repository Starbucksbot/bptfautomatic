const Utils = require('./utils');

let log, config;

/**
 * Prompts the user for input and handles potential errors.
 * @param {Object} prop - The properties object for the prompt.
 * @param {string} errmsg - The error message template.
 * @returns {Promise<string>} A promise that resolves with the user input or rejects with an error.
 */
async function prompt(prop, errmsg) {
    try {
        const res = await Utils.prompt(prop);
        return res[prop.prop];
    } catch (err) {
        Utils.fatal(log, errmsg.replace('%e', err.message));
    }
}

exports.register = (automatic) => {
    log = automatic.log;
    config = automatic.config;
};

/**
 * Prompts for Family View PIN.
 * @returns {Promise<string>} Resolves with the entered PIN.
 */
exports.familyViewPin = async () => {
    return prompt({
        "prop": "pin",
        "description": "Family View PIN (hidden)",
        "type": "string",
        "required": true,
        "hidden": true
    }, "Cannot read PIN: %e");
};

/**
 * Prompts for Steam Guard code.
 * @param {boolean} isMobile - Whether the Steam Guard code is from the mobile app.
 * @returns {Promise<string>} Resolves with the entered Steam Guard code.
 */
exports.steamGuardCode = async (isMobile) => {
    return prompt({
        "prop": "code",
        "description": (`Steam Guard${isMobile ? " app" : ""} code`).green,
        "type": "string",
        "required": true
    }, "Cannot read auth code: %e");
};

/**
 * Prompts for CAPTCHA input.
 * @param {string} url - URL of the CAPTCHA image.
 * @returns {Promise<string>} Resolves with the entered CAPTCHA.
 */
exports.CAPTCHA = async (url) => {
    return prompt({
        "prop": "captcha",
        "description": "CAPTCHA".green,
        "type": "string",
        "required": true
    }, "Cannot read CAPTCHA: %e");
};

/**
 * Prompts for backpack.tf token.
 * @returns {Promise<string>} Resolves with the backpack.tf token.
 */
exports.backpackToken = async () => {
    return prompt({
        "prop": "token",
        "description": "backpack.tf token".green,
        "type": "string",
        "required": true,
        message: "Find yours at backpack.tf/settings > Advanced"
    }, "Cannot read backpack.tf token: %e");
};

/**
 * Prompts for backpack.tf API key.
 * @returns {Promise<string>} Resolves with the backpack.tf API key.
 */
exports.backpackApiKey = async () => {
    return prompt({
        "prop": "apikey",
        "description": "backpack.tf apikey".green,
        "type": "string",
        "required": true,
        message: "Find yours at https://backpack.tf/developer/apikey/view"
    }, "Cannot read backpack.tf apikey: %e");
};

/**
 * Prompts for Steam shared secret.
 * @returns {Promise<string|null>} Resolves with the shared secret or null if not provided.
 */
exports.sharedSecret = async () => {
    return prompt({
        "prop": "sharedSecret",
        "description": "steam sharedSecret".green,
        "type": "string",
        "required": false,
        message: ""
    });
};

/**
 * Prompts for Steam identity secret.
 * @returns {Promise<string|null>} Resolves with the identity secret or null if not provided.
 */
exports.identity_secret = async () => {
    return prompt({
        "prop": "identity_secret",
        "description": "steam identity_secret".green,
        "type": "string",
        "required": false,
        message: ""
    });
};

/**
 * Prompts for Steam account details.
 * @returns {Promise<Object>} Resolves with an object containing accountName and password.
 */
exports.accountDetails = async () => {
    try {
        const result = await Utils.prompt({
            "username": {
                "description": "Steam username".green,
                "type": "string",
                "required": true,
                "default": config.lastUsedAccount()
            },
            "password": {
                "description": "Steam password".green + " (hidden)".red,
                message: "Password is hidden",
                "type": "string",
                "required": true,
                "hidden": true
            }
        });
        return {
            accountName: result.username.toLowerCase(),
            password: result.password
        };
    } catch (err) {
        Utils.fatal(log, "Cannot read Steam details: " + err.message);
    }
};

/**
 * Prompts user if they want to remember their login.
 * @returns {Promise<boolean>} Resolves with true if login should be remembered, false otherwise.
 */
exports.rememberLogin = async () => {
    try {
        const { default: prompt } = await import('prompt');
        prompt.start();
        const { save } = await prompt.get({
            properties: {
                save: {
                    description: "Remember login?".green,
                    type: 'boolean',
                    default: true,
                    message: 'Do you want to remember this login for next time?'
                }
            }
        });
        return save;
    } catch (err) {
        Utils.fatal(log, "Cannot get answer: " + err.message);
    }
};