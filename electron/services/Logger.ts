import { Logger } from 'tslog';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

export enum LogLevel {
    Silly = 0,
    Trace = 1,
    Debug = 2,
    Info = 3,
    Warn = 4,
    Error = 5,
    Fatal = 6
}

class LoggerManager {
    private static instance: any;
    private static logFilePath: string;

    private constructor() {}

    static getInstance(): any {
        if (!LoggerManager.instance) {
            const isDev = process.env.NODE_ENV === 'development';

            const logDir = path.join(app.getPath('userData'), 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            const today = new Date().toISOString().split('T')[0];
            LoggerManager.logFilePath = path.join(logDir, `opencowork-${today}.log`);

            LoggerManager.instance = new Logger({
                type: isDev ? 'pretty' : 'hidden',
                minLevel: isDev ? LogLevel.Debug : LogLevel.Info,
                name: 'OpenCowork',
                prettyErrorTemplate: '\n{{errorName}}: {{errorMessage}}\nerror stack:\n{{errorStack}}',
                prettyInspectOptions: {
                    colors: true,
                    compact: false,
                    depth: 4,
                },
            });

            LoggerManager.instance.info('Logger initialized', {
                env: isDev ? 'development' : 'production',
                logFile: LoggerManager.logFilePath,
            });
        }

        return LoggerManager.instance;
    }

    static getLogFilePath(): string {
        return LoggerManager.logFilePath;
    }

    static flush(): Promise<void> {
        if (LoggerManager.instance && typeof LoggerManager.instance.shutdown === 'function') {
            return LoggerManager.instance.shutdown();
        }
        return Promise.resolve();
    }
}

export default LoggerManager.getInstance();
