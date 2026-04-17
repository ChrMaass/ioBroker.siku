import {
    SIKU_DEFAULT_PASSWORD,
    SIKU_DEVICE_ID_LENGTH,
    SIKU_PARAMETER_DEVICE_ID,
    SIKU_PARAMETER_DEVICE_TYPE,
    SIKU_PARAMETER_FAN_SPEED,
    SIKU_PARAMETER_IP_ADDRESS,
    SIKU_PARAMETER_POWER,
} from './siku-constants';
import { decodeAscii, decodeUnsignedLE, toHex } from './siku-protocol';
import type { ParsedSikuPacket, SikuPacketEntry } from './siku-protocol';

export interface SikuRuntimeDeviceConfig {
    id: string;
    host: string;
    name: string;
    password: string;
    enabled: boolean;
    discoveredType: string;
    lastSeen: string;
    objectId: string;
}

export interface SikuDevicePollSnapshot {
    reportedDeviceId: string;
    power: boolean | null;
    fanSpeed: number | null;
    deviceTypeCode: number | null;
    deviceTypeHex: string | null;
    ipAddress: string | null;
    lastSeen: string;
}

function getPacketEntry(packet: ParsedSikuPacket, parameter: number): SikuPacketEntry | undefined {
    return packet.entries.find(entry => entry.parameter === parameter && !entry.unsupported);
}

function getTrimmedString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${fieldName} must be a non-empty string`);
    }

    return value.trim();
}

/**
 * Normalizes a configured device from the adapter native config.
 *
 * @param device - Raw device entry from the adapter config
 * @param index - Index inside `native.devices`
 */
export function normalizeConfiguredDevice(
    device: Partial<ioBroker.SikuDeviceConfig> | null | undefined,
    index: number,
): SikuRuntimeDeviceConfig {
    if (typeof device !== 'object' || device === null) {
        throw new Error(`devices[${index}] must be an object`);
    }

    const id = getTrimmedString(device.id, `devices[${index}].id`);
    if (id.length !== SIKU_DEVICE_ID_LENGTH) {
        throw new Error(`devices[${index}].id must be exactly ${SIKU_DEVICE_ID_LENGTH} characters long`);
    }

    const host = getTrimmedString(device.host, `devices[${index}].host`);
    const discoveredType = typeof device.discoveredType === 'string' ? device.discoveredType.trim() : '';
    const lastSeen = typeof device.lastSeen === 'string' ? device.lastSeen : '';
    const password =
        typeof device.password === 'string' && device.password.trim().length > 0
            ? device.password.trim()
            : SIKU_DEFAULT_PASSWORD;
    if (password.length > 8) {
        throw new Error(`devices[${index}].password must be at most 8 characters long`);
    }

    return {
        id,
        host,
        name:
            typeof device.name === 'string' && device.name.trim().length > 0
                ? device.name.trim()
                : `Lüfter ${id.slice(-4)}`,
        password,
        enabled: device.enabled !== false,
        discoveredType,
        lastSeen,
        objectId: `devices.${id}`,
    };
}

/**
 * Decodes a 4-byte IPv4 address from the device protocol.
 *
 * @param value - Raw parameter payload
 */
export function decodeIPv4Address(value: Buffer): string | null {
    if (value.length !== 4) {
        return null;
    }

    return Array.from(value.values()).join('.');
}

/**
 * Decodes the core polling snapshot from a valid device response.
 *
 * @param configuredDeviceId - Device ID from the adapter config
 * @param packet - Parsed SIKU response packet
 * @param receivedAt - Timestamp of the successful poll
 */
export function decodePollSnapshot(
    configuredDeviceId: string,
    packet: ParsedSikuPacket,
    receivedAt: Date = new Date(),
): SikuDevicePollSnapshot {
    const idEntry = getPacketEntry(packet, SIKU_PARAMETER_DEVICE_ID);
    const powerEntry = getPacketEntry(packet, SIKU_PARAMETER_POWER);
    const fanSpeedEntry = getPacketEntry(packet, SIKU_PARAMETER_FAN_SPEED);
    const deviceTypeEntry = getPacketEntry(packet, SIKU_PARAMETER_DEVICE_TYPE);
    const ipAddressEntry = getPacketEntry(packet, SIKU_PARAMETER_IP_ADDRESS);

    const reportedDeviceId = decodeAscii(idEntry?.value ?? packet.deviceIdBytes);
    if (!reportedDeviceId) {
        throw new Error('Device response did not contain a usable device ID');
    }
    if (reportedDeviceId !== configuredDeviceId) {
        throw new Error(
            `Configured device ID ${configuredDeviceId} does not match response device ID ${reportedDeviceId}`,
        );
    }

    return {
        reportedDeviceId,
        power: powerEntry ? powerEntry.value.some(byte => byte !== 0x00) : null,
        fanSpeed: fanSpeedEntry ? decodeUnsignedLE(fanSpeedEntry.value) : null,
        deviceTypeCode: deviceTypeEntry ? decodeUnsignedLE(deviceTypeEntry.value) : null,
        deviceTypeHex: deviceTypeEntry ? toHex(deviceTypeEntry.value) : null,
        ipAddress: ipAddressEntry ? decodeIPv4Address(ipAddressEntry.value) : null,
        lastSeen: receivedAt.toISOString(),
    };
}
