import { createLogger, format, transports } from 'winston';
import moment from 'moment';

const getTimestamp = (dateFormat = "HH:mm:ss", username = "") => {
    const prefix = username ? `[${username}] ` : "";
    return `${prefix}${moment().format(dateFormat)}`;
};

export const register = (Automatic) => {
    const steam = Automatic.steam;
    const config = Automatic.config.get();

    const logger = createLogger({
        levels: {
            debug: 5, verbose: 4, info: 3, warn: 2, error: 1, trade: 0
        },
        format: format.combine(
            format.colorize(),
            format.timestamp({ format: () => getTimestamp(config.dateFormat, steam.username) }),
            format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
        ),
        transports: [
            new transports.Console({ level: config.logs?.console?.level || "info" }),
            ...(config.logs?.file?.disabled ? [] : [
                new transports.File({
                    level: config.logs.file.level || "warn",
                    filename: config.logs.file.filename || "automatic.log",
                })
            ])
        ]
    });

    Automatic.log = logger;
};
