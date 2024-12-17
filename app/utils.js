const axios = require('axios');
const querystring = require('querystring');
const { prompt } = require('prompt');
require('colors');

// Configure prompt if it's available
if (prompt) {
    prompt.message = "";
    prompt.delimiter = "";
}

/**
 * Fetches JSON data from a given URL.
 * @param {Object} opts - Options object containing 'url' and optionally 'qs' for query parameters.
 * @returns {Promise<Array>} - An array where the first element is the entire response data, 
 *                             and the second is the 'response' property if it exists.
 */
exports.getJSON = async function (opts) {
    const o = { params: opts.qs };

    try {
        const resp = await axios.get(opts.url, o);
        if (opts.checkResponse && (!resp.data || !resp.data.response || resp.data.response.success === false)) {
            throw new Error('Response check failed');
        }
        return [resp.data, resp.data.response || resp.data];
    } catch (error) {
        const response = error.response || {};
        throw [error.message || `HTTP error ${response.status}`, response.status, response.data];
    }
};

/**
 * Posts JSON data to a given URL. By default, posts JSON, unless specified otherwise.
 * @param {Object} opts - Options object with 'url' and 'form' for form data.
 * @param {boolean} _json - If false, sends form data as x-www-form-urlencoded.
 * @returns {Promise<Array>} - An array where the first element is the response data, 
 *                             and the second is the 'response' property if it exists.
 */
exports.postJSON = async function (opts, _json = true) {
    const o = {};
    if (!_json) {
        o.data = querystring.stringify(opts.form);
        o.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    } else if (opts.form) {
        o.data = opts.form;
    }

    try {
        const resp = await axios.post(opts.url, o.data, o);
        return [resp.data, resp.data.response || resp.data];
    } catch (error) {
        const response = error.response || {};
        throw [error.message || `HTTP error ${response.status}`, response.status, response.data];
    }
};

/**
 * Similar to postJSON but returns the status code as well.
 * @param {Object} opts - Options object with 'url' and 'form' for form data.
 * @param {boolean} _json - If false, sends form data as x-www-form-urlencoded.
 * @returns {Promise<Array>} - An array with response data, response object, and status code.
 */
exports.postJSON2 = async function (opts, _json = true) {
    const o = {};
    if (!_json) {
        o.data = querystring.stringify(opts.form);
        o.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    } else if (opts.form) {
        o.data = opts.form;
    }

    try {
        const resp = await axios.post(opts.url, o.data, o);
        return [resp.data, resp.data.response || resp.data, resp.status];
    } catch (error) {
        const response = error.response || {};
        throw [error.message || `HTTP error ${response.status}`, response.status, response.data];
    }
};

/**
 * Posts form data to a given URL, sending data as x-www-form-urlencoded.
 * @param {Object} opts - Options object with 'url' and 'form' for form data.
 * @returns {Promise<Array>} - An array where the first element is the response data, 
 *                             and the second is the 'response' property if it exists.
 */
exports.postForm = opts => exports.postJSON(opts, false);

/**
 * Prompts user for input using the 'prompt' module.
 * @param {Object} props - Object defining properties to prompt for.
 * @returns {Promise<Object>} - Promise that resolves to the user's input.
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
 */
exports.fatal = (log, msg) => {
    log.error(msg);
    process.exit(1);
};

/**
 * Utility object for creating delay promises.
 */
exports.after = {
    timeout: (time) => new Promise(resolve => setTimeout(resolve, time)),
    seconds: (s) => exports.after.timeout(s * 1000),
    minutes: (m) => exports.after.timeout(m * 60 * 1000)
};