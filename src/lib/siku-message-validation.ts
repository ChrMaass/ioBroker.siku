import { SIKU_DEVICE_ID_LENGTH } from './siku-constants';

export interface DiscoverMessagePayload {
    broadcastAddress?: string;
    password?: string;
    timeoutMs?: number;
    preferredBindPort?: number;
}

export interface ReadDeviceMessagePayload {
    host: string;
    deviceId: string;
    password?: string;
    port?: number;
    timeoutMs?: number;
    parameters: unknown[];
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
