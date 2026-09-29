import { SIKU_DEFAULT_PASSWORD, SIKU_DEVICE_ID_LENGTH } from './siku-constants';

export type SikuDevicePasswordRegistry = Record<string, string>;
export type SikuDevicePasswordEntries = ioBroker.SikuDevicePasswordEntry[];

export interface PrepareStoredDevicePasswordsOptions {
    configuredDevices: readonly Partial<ioBroker.SikuDeviceConfig>[];
    decryptedRegistry: unknown;
    storedRegistry: unknown;
    decrypt: (value: string) => string;
    encrypt: (value: string) => string;
}

export interface PreparedStoredDevicePasswords {
    runtimeRegistry: SikuDevicePasswordRegistry;
    storedRegistry: SikuDevicePasswordEntries;
    storageChanged: boolean;
    invalidDeviceIds: string[];
}

const AES_PASSWORD_PREFIX = '$/aes-192-cbc:';

function isProtocolPassword(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9A-Za-z]{1,8}$/u.test(value);
}

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
    if (Array.isArray(registry)) {
        const normalized: SikuDevicePasswordRegistry = {};

        for (const entry of registry) {
            if (typeof entry !== 'object' || entry === null) {
                continue;
            }

            const key = normalizeDevicePasswordRegistryKey((entry as { id?: unknown }).id);
            const password = getTrimmedPasswordValue((entry as { password?: unknown }).password);
            if (!key || !password) {
                continue;
            }

            normalized[key] = password;
        }

        return normalized;
    }

    if (typeof registry !== 'object' || registry === null) {
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
 * Converts the normalized password registry into the schema-compliant JSON-config
 * table format that stores one row per device id.
 *
 * @param registry - Normalized password registry keyed by device id
 */
export function serializeDevicePasswordRegistry(registry: SikuDevicePasswordRegistry): SikuDevicePasswordEntries {
    return Object.entries(registry)
        .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
        .map(([id, password]) => ({ id, password }));
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
 * @param unavailableDeviceIds - Device ids whose stored credential could not be decrypted
 */
export function resolveConfiguredDevicePassword(
    device: Partial<ioBroker.SikuDeviceConfig>,
    index: number,
    registry: SikuDevicePasswordRegistry,
    unavailableDeviceIds: ReadonlySet<string> = new Set(),
): string {
    const normalizedId = normalizeDevicePasswordRegistryKey(device.id);
    if (normalizedId && unavailableDeviceIds.has(normalizedId)) {
        throw new Error(`devicePasswords.${normalizedId} could not be decrypted and must be configured again`);
    }
    const registryPassword = normalizedId ? registry[normalizedId] : undefined;
    const legacyPassword = getTrimmedPasswordValue(device.password);
    const resolvedPassword = registryPassword ?? legacyPassword ?? SIKU_DEFAULT_PASSWORD;

    if (!isProtocolPassword(resolvedPassword)) {
        const source = registryPassword ? `devicePasswords.${normalizedId}` : `devices[${index}].password`;
        throw new Error(`${source} must contain 1 to 8 letters or digits`);
    }

    return resolvedPassword;
}

function getStoredPasswordRows(registry: unknown): Map<string, string> {
    const rows = new Map<string, string>();
    const entries: Array<[unknown, unknown]> = Array.isArray(registry)
        ? registry.map(entry =>
              typeof entry === 'object' && entry !== null
                  ? [(entry as { id?: unknown }).id, (entry as { password?: unknown }).password]
                  : [undefined, undefined],
          )
        : typeof registry === 'object' && registry !== null
          ? Object.entries(registry)
          : [];

    for (const [rawId, rawPassword] of entries) {
        const id = normalizeDevicePasswordRegistryKey(rawId);
        const password = getTrimmedPasswordValue(rawPassword);
        if (id && password) {
            rows.set(id, password);
        }
    }
    return rows;
}

/**
 * Reconciles decrypted runtime values with raw instance storage.
 *
 * Earlier adapter versions declared the whole object-array as `encryptedNative`. The controller
 * cannot decrypt password properties in that shape, while migration code could also persist plain
 * values. Raw protocol-valid values are therefore treated as legacy plaintext and encrypted once;
 * already encrypted rows are retained byte-for-byte to avoid needless config churn.
 *
 * @param options - Raw storage, decrypted runtime data and controller crypto helpers
 */
export function prepareStoredDevicePasswords(
    options: PrepareStoredDevicePasswordsOptions,
): PreparedStoredDevicePasswords {
    const decrypted = normalizeDevicePasswordRegistry(options.decryptedRegistry);
    const storedRows = getStoredPasswordRows(options.storedRegistry);
    const runtimeRegistry: SikuDevicePasswordRegistry = {};
    const storedRegistry: SikuDevicePasswordEntries = [];
    const invalidDeviceIds: string[] = [];
    const configuredIds = new Set<string>();

    for (const device of options.configuredDevices) {
        const id = normalizeDevicePasswordRegistryKey(device.id);
        if (!id || configuredIds.has(id)) {
            continue;
        }
        configuredIds.add(id);

        const storedValue = storedRows.get(id);
        let decryptedStoredValue: string | undefined;
        let password: string | undefined;

        if (isProtocolPassword(storedValue)) {
            password = storedValue;
        } else if (storedValue) {
            try {
                const explicitlyDecrypted = options.decrypt(storedValue);
                if (isProtocolPassword(explicitlyDecrypted)) {
                    decryptedStoredValue = explicitlyDecrypted;
                    password = explicitlyDecrypted;
                }
            } catch {
                // Invalid legacy ciphertext is handled by the validation below.
            }
            password ??= isProtocolPassword(decrypted[id]) ? decrypted[id] : undefined;
        } else if (isProtocolPassword(decrypted[id])) {
            password = decrypted[id];
        } else {
            const legacyInlinePassword = getTrimmedPasswordValue(device.password);
            password = isProtocolPassword(legacyInlinePassword) ? legacyInlinePassword : SIKU_DEFAULT_PASSWORD;
        }

        if (!password) {
            invalidDeviceIds.push(id);
            if (storedValue) {
                // Preserve unreadable ciphertext so a temporary controller-secret mismatch
                // does not destroy credentials that may become readable again after restore.
                storedRegistry.push({ id, password: storedValue });
            }
            continue;
        }

        runtimeRegistry[id] = password;
        storedRegistry.push({
            id,
            password:
                storedValue?.startsWith(AES_PASSWORD_PREFIX) && decryptedStoredValue === password
                    ? storedValue
                    : options.encrypt(password),
        });
    }

    storedRegistry.sort((left, right) => left.id.localeCompare(right.id));
    const normalizedStoredRows = Array.from(storedRows.entries())
        .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
        .map(([id, password]) => ({ id, password }));
    if (configuredIds.size === 0) {
        // An empty device list may be a transient/failed Admin save. Keep encrypted
        // credentials recoverable instead of irreversibly purging every row at once.
        return {
            runtimeRegistry,
            storedRegistry: normalizedStoredRows,
            storageChanged: false,
            invalidDeviceIds,
        };
    }

    return {
        runtimeRegistry,
        storedRegistry,
        storageChanged:
            !Array.isArray(options.storedRegistry) ||
            JSON.stringify(storedRegistry) !== JSON.stringify(normalizedStoredRows),
        invalidDeviceIds,
    };
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
