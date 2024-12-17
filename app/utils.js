const axios = require('axios');
const querystring = require('querystring');
const { prompt } = require('prompt');

// Configure prompt if available
if (prompt) {
    prompt.message = '';
    prompt.delimiter = '';
}

/**
 * Fetches JSON data from a given URL.
 * @param {Object} opts - Options object containing 'url' and optionally 'qs' for query parameters.
 * @returns {Promise<Object>} - The response data object.
 * @throws {Error} - Throws an error with details if the request fails.
 */
exports.getJSON = async function (opts) {
    try {
        const response = await axios.get(opts.url, { params: opts.qs });
        if (opts.checkResponse && (!response.data || !response.data.response || response.data.response.success === false)) {
            throw new Error('Response check failed');
        }
        return response.data;
    } catch (error) {
        throw createHttpError(error);
    }
};

/**
 * Posts JSON data to a given URL.
 * @param {Object} opts - Options object with 'url' and 'form' for form data.
 * @param {boolean} _json - If false, sends form data as x-www-form-urlencoded.
 * @returns {Promise<Object>} - The response data object.
 * @throws {Error} - Throws an error with details if the request fails.
 */
exports.postJSON = async function (opts, _json = true) {
    try {
        const options = preparePostOptions(opts, _json);
        const response = await axios.post(opts.url, options.data, options);
        return response.data;
    } catch (error) {
        throw createHttpError(error);
    }
};

/**
 * Posts JSON data and returns the status code as well.
 * @param {Object} opts - Options object with 'url' and 'form' for form data.
 * @param {boolean} _json - If false, sends form data as x-www-form-urlencoded.
 * @returns {Promise<Object>} - An object containing response data and status code.
 * @throws {Error} - Throws an error with details if the request fails.
 */
exports.postJSON2 = async function (opts, _json = true) {
    try {
        const options = preparePostOptions(opts, _json);
        const response = await axios.post(opts.url, options.data, options);
        return { data: response.data, status: response.status };
    } catch (error) {
        throw createHttpError(error);
    }
};

/**
 * Posts form data to a given URL, sending data as x-www-form-urlencoded.
 * @param {Object} opts - Options object with 'url' and 'form' for form data.
 * @returns {Promise<Object>} - The response data object.
 */
exports.postForm = (opts) => exports.postJSON(opts, false);

/**
 * Prompts the user for input using the 'prompt' module.
 * @param {Object} props - Object defining properties to prompt for.
 * @returns {Promise<Object>} - Resolves to the user's input.
 * @throws {Error} - Throws an error if the prompt fails or is unavailable.
 */
exports.prompt = async function (props) {
    if (!prompt) {
        throw new Error("Prompt module is not available or not properly initialized.");
    }
    prompt.start();
    return new Promise((resolve, reject) => {
        prompt.get({ properties: props }, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
};

/**
 * Logs an error message and exits the process.
 * @param {Object} log - Logging object with an 'error' method.
 * @param {string} msg - Error message to log.
 * @throws {Error} - Throws an error if the log object is invalid.
 */
exports.fatal = (log, msg) => {
    if (!log || typeof log.error !== 'function') {
        throw new Error("Invalid logging object provided.");
    }
    log.error(msg);
    process.exit(1);
};

/**
 * Utility object for creating delay promises.
 */
exports.after = {
    timeout: (time) => new Promise((resolve) => setTimeout(resolve, time)),
    seconds: (s) => exports.after.timeout(s * 1000),
    minutes: (m) => exports.after.timeout(m * 60 * 1000),
};

/**
 * Prepares POST options for axios requests.
 * @param {Object} opts - Options object with 'url' and 'form' for form data.
 * @param {boolean} _json - If false, sends form data as x-www-form-urlencoded.
 * @returns {Object} - Prepared axios options with headers and data.
 */
function preparePostOptions(opts, _json) {
    const options = {};
    if (!_json) {
        options.data = querystring.stringify(opts.form);
        options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    } else if (opts.form) {
        options.data = opts.form;
    }
    return options;
}

/**
 * Creates a standardized error object for HTTP request errors.
 * @param {Error} error - The error object from axios.
 * @returns {Error} - A standardized error object with details.
 */
function createHttpError(error) {
    const response = error.response || {};
    const httpError = new Error(error.message || `HTTP error ${response.status}`);
    httpError.status = response.status;
    httpError.data = response.data;
    return httpError;
}
