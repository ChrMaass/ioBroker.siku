import { SIKU_DEFAULT_PASSWORD, SIKU_DEVICE_ID_LENGTH, SIKU_DISCOVERY_MAX_PASSWORDS } from './siku-constants';
import type { SikuDevicePasswordRegistry } from './siku-password-config';

/**
 * Finds device roots that belong to devices no longer present in the native config.
 *
 * Only exact `devices.<16 hex chars>` device objects are returned. Custom folders and
 * descendants are intentionally ignored to avoid deleting user-created objects.
 *
 * @param namespace - Adapter namespace, for example `siku.0`
 * @param objects - Objects owned by the adapter instance
 * @param configuredDeviceIds - Normalized configured device IDs
 */
export function findOrphanedDeviceObjectIds(
    namespace: string,
    objects: Record<string, ioBroker.Object>,
    configuredDeviceIds: ReadonlySet<string>,
): string[] {
    const escapedNamespace = namespace.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const deviceRootPattern = new RegExp(`^${escapedNamespace}\\.devices\\.([A-F0-9]{${SIKU_DEVICE_ID_LENGTH}})$`, 'u');
    const orphanedRoots: string[] = [];

    for (const [objectId, object] of Object.entries(objects)) {
        const match = deviceRootPattern.exec(objectId);
        if (match && object.type === 'device' && !configuredDeviceIds.has(match[1])) {
            orphanedRoots.push(`devices.${match[1]}`);
        }
    }

    return orphanedRoots.sort();
}

/**
 * Returns all unique credentials that should be tried during broadcast discovery.
 *
 * An explicitly supplied password narrows discovery to that one credential. Otherwise
 * the default password and every configured device password are tried.
 *
 * @param explicitPassword - Optional messagebox password
 * @param registry - Runtime password registry
 */
export function getDiscoveryPasswords(
    explicitPassword: string | undefined,
    registry: SikuDevicePasswordRegistry,
): string[] {
    if (explicitPassword) {
        return [explicitPassword];
    }

    return Array.from(new Set([SIKU_DEFAULT_PASSWORD, ...Object.values(registry)])).slice(
        0,
        SIKU_DISCOVERY_MAX_PASSWORDS,
    );
}

/**
 * Detects ioBroker custom bindings below one adapter-owned device root.
 *
 * History and database adapters store their activation in `common.custom`. Such
 * object trees must be preserved even after the device leaves native config.
 *
 * @param namespace - Adapter namespace, for example `siku.0`
 * @param relativeDeviceRoot - Relative root, for example `devices.ABC...`
 * @param objects - Objects owned by the adapter instance
 */
export function deviceObjectTreeHasCustomBindings(
    namespace: string,
    relativeDeviceRoot: string,
    objects: Record<string, ioBroker.Object>,
): boolean {
    const fullRoot = `${namespace}.${relativeDeviceRoot}`;

    return Object.entries(objects).some(([objectId, object]) => {
        if (objectId !== fullRoot && !objectId.startsWith(`${fullRoot}.`)) {
            return false;
        }

        const custom = object.common?.custom;
        return typeof custom === 'object' && custom !== null && Object.keys(custom).length > 0;
    });
}

/**
 * Restricts sensitive JSON-config responses to the ioBroker Admin adapter.
 *
 * @param from - Messagebox sender id
 */
export function isAdminMessageOrigin(from: string | undefined): boolean {
    return typeof from === 'string' && /^system\.adapter\.admin\.\d+$/u.test(from);
}
