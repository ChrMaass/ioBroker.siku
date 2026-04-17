import { SIKU_DEVICE_ID_LENGTH } from './siku-constants';

/**
 * Normalized payload for the broadcast based discovery command.
 */
export interface DiscoverMessagePayload {
    /** Optional IPv4 broadcast address that should be used for discovery. */
    broadcastAddress?: string;
    /** Optional device password used while discovering secured devices. */
    password?: string;
    /** Optional receive timeout in milliseconds. */
    timeoutMs?: number;
    /** Preferred local UDP bind port for discovery traffic. */
    preferredBindPort?: number;
}

/**
 * Normalized payload for reading a specific device via the messagebox API.
 */
export interface ReadDeviceMessagePayload {
    /** Target IPv4 address of the device. */
    host: string;
    /** SIKU device identifier string for the target device. */
    deviceId: string;
    /** Optional device password. */
    password?: string;
    /** Optional target UDP port. */
    port?: number;
    /** Optional request timeout in milliseconds. */
    timeoutMs?: number;
    /** Requested raw protocol parameters. */
    parameters: unknown[];
}

/**
 * Normalized payload for synchronizing the time of one configured device.
 */
export interface SyncTimeDeviceMessagePayload {
    /** Uppercase hexadecimal SIKU device identifier. */
    deviceId: string;
}

interface StringFieldOptions {
    allowEmpty?: boolean;
    exactLength?: number;
    maxLength?: number;
}

function getObjectPayload(message: unknown, command: string): Record<string, unknown> {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
        throw new Error(`${command} requires an object payload`);
    }

    return message as Record<string, unknown>;
}

/**
 * Reads an optional string field and validates basic length constraints.
 *
 * @param payload - Object payload to validate
 * @param fieldName - Name of the expected field
 * @param options - Additional field constraints
 */
function getOptionalStringField(
    payload: Record<string, unknown>,
    fieldName: string,
    options: StringFieldOptions = {},
): string | undefined {
    const value = payload[fieldName];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new Error(`${fieldName} must be a string`);
    }
    if (!options.allowEmpty && value.length === 0) {
        throw new Error(`${fieldName} must not be empty`);
    }
    if (options.exactLength !== undefined && value.length !== options.exactLength) {
        throw new Error(`${fieldName} must be exactly ${options.exactLength} characters long`);
    }
    if (options.maxLength !== undefined && value.length > options.maxLength) {
        throw new Error(`${fieldName} must be at most ${options.maxLength} characters long`);
    }

    return value;
}

/**
 * Reads a required string field and applies the same validation as the optional variant.
 *
 * @param payload - Object payload to validate
 * @param fieldName - Name of the expected field
 * @param options - Additional field constraints
 */
function getRequiredStringField(
    payload: Record<string, unknown>,
    fieldName: string,
    options: StringFieldOptions = {},
): string {
    const value = getOptionalStringField(payload, fieldName, options);
    if (value === undefined) {
        throw new Error(`${fieldName} is required`);
    }

    return value;
}

/**
 * Reads an optional integer field and validates the accepted numeric range.
 *
 * @param payload - Object payload to validate
 * @param fieldName - Name of the expected field
 * @param minimum - Minimum allowed integer value
 * @param maximum - Maximum allowed integer value
 */
function getOptionalIntegerField(
    payload: Record<string, unknown>,
    fieldName: string,
    minimum: number,
    maximum: number,
): number | undefined {
    const value = payload[fieldName];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
    }

    return value;
}

/**
 * Validates and normalizes the payload of a `discover` messagebox command.
 *
 * @param message - Raw message payload from the admin UI or sendTo
 */
export function normalizeDiscoverMessagePayload(message: unknown): DiscoverMessagePayload {
    const payload = getObjectPayload(message, 'discover');

    return {
        broadcastAddress: getOptionalStringField(payload, 'broadcastAddress'),
        password: getOptionalStringField(payload, 'password', { maxLength: 8 }),
        timeoutMs: getOptionalIntegerField(payload, 'timeoutMs', 1, Number.MAX_SAFE_INTEGER),
        preferredBindPort: getOptionalIntegerField(payload, 'preferredBindPort', 0, 65535),
    };
}

/**
 * Validates and normalizes the payload of a `readDevice` messagebox command.
 *
 * @param message - Raw message payload from the admin UI or sendTo
 */
export function normalizeReadDeviceMessagePayload(message: unknown): ReadDeviceMessagePayload {
    const payload = getObjectPayload(message, 'readDevice');
    const parameters = payload.parameters;
    if (!Array.isArray(parameters)) {
        throw new Error('parameters must be an array');
    }
    if (parameters.length === 0) {
        throw new Error('parameters must not be empty');
    }

    return {
        host: getRequiredStringField(payload, 'host'),
        deviceId: getRequiredStringField(payload, 'deviceId', { exactLength: SIKU_DEVICE_ID_LENGTH }),
        password: getOptionalStringField(payload, 'password', { maxLength: 8 }),
        port: getOptionalIntegerField(payload, 'port', 1, 65535),
        timeoutMs: getOptionalIntegerField(payload, 'timeoutMs', 1, Number.MAX_SAFE_INTEGER),
        parameters,
    };
}

/**
 * Validates and normalizes the payload of a `syncTimeDevice` messagebox command.
 *
 * @param message - Raw message payload from the admin UI or sendTo
 */
export function normalizeSyncTimeDeviceMessagePayload(message: unknown): SyncTimeDeviceMessagePayload {
    const payload = getObjectPayload(message, 'syncTimeDevice');

    return {
        deviceId: getRequiredStringField(payload, 'deviceId', { exactLength: SIKU_DEVICE_ID_LENGTH }).toUpperCase(),
    };
}
