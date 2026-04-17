import { SIKU_DEFAULT_PASSWORD } from './siku-constants';
import type { SikuDiscoveredDevice } from './siku-network';

/**
 * Formats the discovered type information for display in the adapter configuration.
 *
 * @param device - Discovered device descriptor from UDP broadcast discovery
 */
export function formatDiscoveredType(device: Pick<SikuDiscoveredDevice, 'deviceTypeCode' | 'deviceTypeHex'>): string {
    if (device.deviceTypeHex && device.deviceTypeCode !== null) {
        return `${device.deviceTypeHex} (${device.deviceTypeCode})`;
    }
    if (device.deviceTypeHex) {
        return device.deviceTypeHex;
    }
    if (device.deviceTypeCode !== null) {
        return String(device.deviceTypeCode);
    }

    return '';
}

/**
 * Merges discovered devices into the current adapter config while preserving
 * user-managed fields like the display name, enabled flag and password.
 * Existing configured devices that were not rediscovered stay in the list.
 *
 * @param configuredDevices - Current adapter config from `native.devices`
 * @param discoveredDevices - Result list of a discovery run
 */
export function mergeDiscoveredDevicesIntoConfig(
    configuredDevices: ioBroker.SikuDeviceConfig[] | undefined,
    discoveredDevices: readonly SikuDiscoveredDevice[],
): ioBroker.SikuDeviceConfig[] {
    const mergedDevices = [...(configuredDevices ?? [])].map(device => ({ ...device }));
    const configuredIndexById = new Map(mergedDevices.map((device, index) => [device.id?.toUpperCase(), index]));

    for (const discoveredDevice of [...discoveredDevices].sort((left, right) =>
        left.deviceId.localeCompare(right.deviceId),
    )) {
        const discoveredType = formatDiscoveredType(discoveredDevice);
        const existingIndex = configuredIndexById.get(discoveredDevice.deviceId.toUpperCase());

        if (existingIndex !== undefined) {
            const existing = mergedDevices[existingIndex];
            mergedDevices[existingIndex] = {
                ...existing,
                id: discoveredDevice.deviceId,
                host: discoveredDevice.host,
                discoveredType,
                lastSeen: discoveredDevice.receivedAt,
            };
            continue;
        }

        mergedDevices.push({
            id: discoveredDevice.deviceId,
            host: discoveredDevice.host,
            name: `Lüfter ${discoveredDevice.deviceId.slice(-4)}`,
            password: SIKU_DEFAULT_PASSWORD,
            enabled: true,
            discoveredType,
            lastSeen: discoveredDevice.receivedAt,
        });
    }

    return mergedDevices;
}
