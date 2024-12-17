const winston = require('winston');
const moment = require('moment');

const LOG_LEVELS = {
    "debug": 5,
    "verbose": 4,
    "info": 3,
    "warn": 2,
    "error": 1,
    "trade": 0
};

const LOG_COLORS = {
    "debug": "blue",
    "verbose": "cyan",
    "info": "green",
    "warn": "yellow",
    "error": "red",
    "trade": "magenta"
};

// Custom levels setup
winston.addColors(LOG_COLORS);
winston.config.npm.levels = LOG_LEVELS;

exports.LOG_LEVELS = LOG_LEVELS;
exports.LOG_COLORS = LOG_COLORS;

exports.register = (Automatic) => {
    let steam = Automatic.steam,
        config = Automatic.config.get();

    const logger = winston.createLogger({
        levels: LOG_LEVELS,
        format: winston.format.combine(
            winston.format.timestamp({
                format: () => getTimestamp(steam.username, config.dateFormat || "HH:mm:ss")
            }),
            winston.format.colorize(),
            winston.format.printf(info => {
                return `[${info.timestamp}] [${info.level}]: ${info.message}`;
            })
        ),
        transports: []
    });

    // Console transport
    logger.add(new winston.transports.Console({
        level: (config.logs && config.logs.console && config.logs.console.level) ? config.logs.console.level : "info",
    }));

    // File transport for general logs
    if (config.logs && config.logs.file && !config.logs.file.disabled) {
        logger.add(new winston.transports.File({
            filename: config.logs.file.filename || "automatic.log",
            level: config.logs.file.level || "warn",
        }));
    }

    // File transport for trade logs
    if (config.logs && config.logs.trade && !config.logs.trade.disabled) {
        logger.add(new winston.transports.File({
            filename: config.logs.trade.filename || "automatic.trade.log",
            level: "trade"
        }));
    }

    Automatic.log = logger;

    // Helper function to get timestamp
    function getTimestamp(username, dateFormat) {
        return (username ? '[' + username + '] ' : '') + moment().format(dateFormat);
    }
};