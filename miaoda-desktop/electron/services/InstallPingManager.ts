/**
 * ================================================================================
 * InstallPingManager - Local install identifier
 * ================================================================================
 *
 * This module used to POST a one-time install ping (app name, install id,
 * version, platform) to an upstream-operated endpoint. That call has been
 * removed: 秒答 ships its own backend and must not report installs to a
 * third-party host.
 *
 * What remains is the local half — a random per-install UUID, written to
 * userData/install_id.txt and never transmitted by this module. HindsightManager
 * uses it to namespace a user's local long-term-memory store so two profiles on
 * one machine don't collide. It is not derived from hardware or identity.
 *
 * The file name is kept for compatibility with the existing require() call sites
 * and with install_id.txt already on disk in shipped installs.
 * ================================================================================
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Local storage path (inside user data directory)
const INSTALL_ID_PATH = path.join(app.getPath('userData'), 'install_id.txt');

/**
 * Get or create a persistent anonymous install ID.
 * This ID is a random UUID with no connection to hardware or user identity.
 * Once created, it never changes.
 */
export function getOrCreateInstallId(): string {
    try {
        // Check if install ID already exists
        if (fs.existsSync(INSTALL_ID_PATH)) {
            const existingId = fs.readFileSync(INSTALL_ID_PATH, 'utf-8').trim();
            if (existingId && existingId.length > 0) {
                return existingId;
            }
        }

        // Generate new UUID
        const newId = uuidv4();
        fs.writeFileSync(INSTALL_ID_PATH, newId, 'utf-8');
        console.log('[InstallPingManager] Generated new install ID');
        return newId;
    } catch (error) {
        console.error('[InstallPingManager] Error managing install ID:', error);
        // Return a temporary ID if we can't persist
        return uuidv4();
    }
}

/**
 * Namespace export for compatibility with require() pattern
 */
export const InstallPingManager = {
    getOrCreateInstallId
};
