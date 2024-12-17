import { createLogger, format, transports, config as winstonConfig } from 'winston';
import moment from 'moment';

export const LOG_LEVELS = {
    debug: 5,
    verbose: 4,
    info: 3,
    warn: 2,
    error: 1,
    trade: 0
};

export const LOG_COLORS = {
    debug: "blue",
    verbose: "cyan",
    info: "green",
    warn: "yellow",
    error: "red",
    trade: "magenta"
};

// Register logger with the Automatic system
export const register = (Automatic) => {
    const steam = Automatic.steam;
    const config = Automatic.config.get();
    const logger = createLogger({
        levels: LOG_LEVELS,
        format: format.combine(
            format.colorize({ all: true }), // Apply colorize
            format.timestamp({
                format: () => getTimestamp(config.dateFormat, steam.username)
            }),
            format.printf(({ timestamp, level, message }) => {
                return `${timestamp} [${level}]: ${message}`;
            })
        ),
        transports: []
    });

    // Add console log
    logger.add(new transports.Console({
        level: (config.logs?.console?.level) || "info"
    }));

    // Add general log file
    if (config.logs?.file && !config.logs.file.disabled) {
        logger.add(new transports.File({
            level: config.logs.file.level || "warn",
            filename: config.logs.file.filename || "automatic.log",
            format: format.combine(
                format.timestamp({
                    format: () => getTimestamp(config.dateFormat, steam.username)
                }),
                format.printf(({ timestamp, level, message }) => {
                    return `${timestamp} [${level}]: ${message}`;
                })
            )
        }));
    }

    // Add trade log file
    if (config.logs?.trade && !config.logs.trade.disabled) {
        logger.add(new transports.File({
            level: "trade",
            filename: config.logs.trade.filename || "automatic.trade.log",
            format: format.combine(
                format.timestamp({
                    format: () => getTimestamp(config.dateFormat, steam.username)
                }),
                format.printf(({ timestamp, level, message }) => {
                    return `${timestamp} [${level}]: ${message}`;
                })
            )
        }));
    }

    // Assign logger to Automatic instance
    Automatic.log = logger;
};

// Generate timestamp
const getTimestamp = (dateFormat = "HH:mm:ss", username = "") => {
    const prefix = username ? `[${username}] ` : "";
    return `${prefix}${moment().format(dateFormat)}`;
};
