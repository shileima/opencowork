import path from 'path';
import logger from '../../services/Logger';
import { configStore } from '../../config/ConfigStore';

export class PermissionManager {

    private networkAccess: boolean = false;

    constructor() {
        // No local state needed for persistent folders
    }

    authorizeFolder(folderPath: string): boolean {
        const normalized = path.resolve(folderPath);
        // Security check: never allow root directories
        if (normalized === '/' || normalized === 'C:\\' || normalized.match(/^[A-Z]:\\$/)) {
            logger.warn('Attempted to authorize root directory, denied.');
            return false;
        }
        configStore.addAuthorizedFolder(normalized);
        logger.debug(`Authorized folder: ${normalized}`);
        return true;
    }

    revokeFolder(folderPath: string): void {
        const normalized = path.resolve(folderPath);
        configStore.removeAuthorizedFolder(normalized);
    }

    isPathAuthorized(filePath: string): boolean {
        const normalized = path.resolve(filePath);
        const folders = this.getAuthorizedFolders();
        for (const folder of folders) {
            if (normalized.startsWith(folder)) {
                return true;
            }
        }
        return false;
    }

    getAuthorizedFolders(): string[] {
        return configStore.getAuthorizedFolders().map(f => path.resolve(f.path));
    }

    setNetworkAccess(enabled: boolean): void {
        this.networkAccess = enabled;
    }

    isNetworkAccessEnabled(): boolean {
        return this.networkAccess;
    }
}

export const permissionManager = new PermissionManager();
