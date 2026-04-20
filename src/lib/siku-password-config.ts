import { SIKU_DEFAULT_PASSWORD, SIKU_DEVICE_ID_LENGTH } from './siku-constants';

export type SikuDevicePasswordRegistry = Record<string, string>;

/**
 * Normalizes a device ID that is intended to be used as a key in the password registry.
 *
 * @param value - Raw key or configured device id
 */
export function normalizeDevicePasswordRegistryKey(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toUpperCase();
    if (normalized.length !== SIKU_DEVICE_ID_LENGTH || !/^[0-9A-F]+$/u.test(normalized)) {
        return null;
    }

    return normalized;
}

/**
 * Extracts a password value from either the new registry structure or the
 * legacy per-device configuration entry.
 *
 * @param value - Raw value from the config
 */
function getTrimmedPasswordValue(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }

    if (typeof value === 'object' && value !== null && 'password' in value) {
        return getTrimmedPasswordValue((value as { password?: unknown }).password);
    }

    return null;
}

/**
 * Normalizes the dedicated password registry from the adapter config.
 *
 * The registry is intentionally tolerant and ignores malformed keys or empty
 * values so that startup is not blocked by stale leftovers from older config
 * experiments. Actual password length validation is done once a device is
 * resolved for runtime usage.
 *
 * @param registry - Raw `native.devicePasswords` value
 */
export function normalizeDevicePasswordRegistry(registry: unknown): SikuDevicePasswordRegistry {
    if (typeof registry !== 'object' || registry === null || Array.isArray(registry)) {
        return {};
    }

    const normalized: SikuDevicePasswordRegistry = {};
    for (const [rawKey, rawValue] of Object.entries(registry)) {
        const key = normalizeDevicePasswordRegistryKey(rawKey);
        const password = getTrimmedPasswordValue(rawValue);
        if (!key || !password) {
            continue;
        }

        normalized[key] = password;
    }

    return normalized;
}

/**
 * Resolves the effective password for one configured device.
 *
 * Preference order:
 * 1. Dedicated password registry
 * 2. Legacy `devices[].password` value
 * 3. Default device password (`1111`)
 *
 * @param device - Raw configured device
 * @param index - Index inside `native.devices`
 * @param registry - Normalized dedicated password registry
 */
export function resolveConfiguredDevicePassword(
    device: Partial<ioBroker.SikuDeviceConfig>,
    index: number,
    registry: SikuDevicePasswordRegistry,
): string {
    const normalizedId = normalizeDevicePasswordRegistryKey(device.id);
    const registryPassword = normalizedId ? registry[normalizedId] : undefined;
    const legacyPassword = getTrimmedPasswordValue(device.password);
    const resolvedPassword = registryPassword ?? legacyPassword ?? SIKU_DEFAULT_PASSWORD;

    if (resolvedPassword.length > 8) {
        const source = registryPassword ? `devicePasswords.${normalizedId}` : `devices[${index}].password`;
        throw new Error(`${source} must be at most 8 characters long`);
    }

    return resolvedPassword;
}

/**
 * Builds a clean password registry for all configured devices.
 *
 * Existing registry entries win over legacy in-row passwords, and all valid
 * configured devices always receive an entry so the adapter can later remove
 * `devices[].password` completely.
 *
 * @param devices - Configured device rows
 * @param currentRegistry - Existing dedicated registry from native config
 */
export function buildDevicePasswordRegistry(
    devices: readonly Partial<ioBroker.SikuDeviceConfig>[] | undefined,
    currentRegistry: unknown,
): SikuDevicePasswordRegistry {
    const normalizedRegistry = normalizeDevicePasswordRegistry(currentRegistry);
    const result: SikuDevicePasswordRegistry = {};

    for (const [index, device] of (devices ?? []).entries()) {
        const normalizedId = normalizeDevicePasswordRegistryKey(device?.id);
        if (!normalizedId) {
            continue;
        }

        result[normalizedId] = resolveConfiguredDevicePassword(device ?? {}, index, normalizedRegistry);
    }

    return result;
}

/**
 * Removes the legacy inline password field from configured device rows.
 *
 * @param devices - Configured device rows
 */
export function stripLegacyPasswordsFromDevices(
    devices: readonly Partial<ioBroker.SikuDeviceConfig>[] | undefined,
): ioBroker.SikuDeviceConfig[] {
    return (devices ?? []).map(device => {
        const { password: _password, ...deviceWithoutPassword } = device ?? {};
        return {
            id: typeof deviceWithoutPassword.id === 'string' ? deviceWithoutPassword.id : '',
            host: typeof deviceWithoutPassword.host === 'string' ? deviceWithoutPassword.host : '',
            name: typeof deviceWithoutPassword.name === 'string' ? deviceWithoutPassword.name : '',
            enabled: typeof deviceWithoutPassword.enabled === 'boolean' ? deviceWithoutPassword.enabled : true,
            discoveredType:
                typeof deviceWithoutPassword.discoveredType === 'string' ? deviceWithoutPassword.discoveredType : '',
            lastSeen: typeof deviceWithoutPassword.lastSeen === 'string' ? deviceWithoutPassword.lastSeen : '',
        };
    });
}
