import {
    SIKU_DEFAULT_DEVICE_ID,
    SIKU_DEFAULT_PASSWORD,
    SIKU_DEVICE_ID_LENGTH,
    SIKU_DISCOVERY_PARAMETERS,
    SIKU_PACKET_PREFIX,
    SIKU_PROTOCOL_TYPE,
    SIKU_SPECIAL_COMMANDS,
    SikuFunction,
} from './siku-constants';

export interface SikuReadRequestEntry {
    parameter: number;
    requestValue?: Buffer | number[];
    valueSize?: number;
}

export interface SikuWriteRequestEntry {
    parameter: number;
    value: Buffer | number[];
}

export interface SikuPacketEntry {
    parameter: number;
    size: number;
    value: Buffer;
    unsupported: boolean;
    functionCode: SikuFunction;
}

export interface ParsedSikuPacket {
    protocolType: number;
    checksum: number;
    checksumValid: boolean;
    deviceIdBytes: Buffer;
    deviceIdText: string;
    passwordBytes: Buffer;
    passwordText: string;
    functionCode: SikuFunction;
    entries: SikuPacketEntry[];
}

function normalizeAsciiField(input: string | Buffer, expectedLength: number, fieldName: string): Buffer {
    if (Buffer.isBuffer(input)) {
        if (input.length !== expectedLength) {
            throw new Error(`${fieldName} must be exactly ${expectedLength} bytes long`);
        }
        return Buffer.from(input);
    }

    if (input.length !== expectedLength) {
        throw new Error(`${fieldName} must be exactly ${expectedLength} characters long`);
    }

    return Buffer.from(input, 'ascii');
}

function normalizeByteArray(input: Buffer | number[] | undefined): Buffer {
    if (!input) {
        return Buffer.alloc(0);
    }

    const buffer = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input);
    for (const byte of buffer.values()) {
        if (byte < 0x00 || byte > 0xff) {
            throw new Error(`Invalid byte value ${byte}`);
        }
    }
    return buffer;
}

function getParameterPage(parameter: number): number {
    return (parameter >> 8) & 0xff;
}

function getParameterLowByte(parameter: number): number {
    return parameter & 0xff;
}

function requiresValue(functionCode: SikuFunction): boolean {
    return (
        functionCode === SikuFunction.Write ||
        functionCode === SikuFunction.ReadWrite ||
        functionCode === SikuFunction.Response
    );
}

export function decodeAscii(buffer: Buffer): string {
    return buffer.toString('ascii').replace(/\0+$/u, '');
}

export function decodeUnsignedLE(buffer: Buffer): number {
    return buffer.reduce((accumulator, byte, index) => accumulator + byte * 256 ** index, 0);
}

export function toHex(buffer: Buffer): string {
    return buffer.toString('hex').toUpperCase();
}

export function calculateChecksum(packetWithoutChecksum: Buffer): number {
    let checksum = 0;
    for (let index = 2; index < packetWithoutChecksum.length; index++) {
        checksum += packetWithoutChecksum[index];
    }
    return checksum & 0xffff;
}

export function buildPacket(
    deviceId: string | Buffer,
    password: string,
    functionCode: SikuFunction,
    dataPayload: Buffer,
): Buffer {
    if (password.length > 8) {
        throw new Error('Password must be at most 8 characters long');
    }

    const deviceIdBuffer = normalizeAsciiField(deviceId, SIKU_DEVICE_ID_LENGTH, 'deviceId');
    const passwordBuffer = Buffer.from(password, 'ascii');

    const packetWithoutChecksum = Buffer.concat([
        SIKU_PACKET_PREFIX,
        Buffer.from([SIKU_PROTOCOL_TYPE, SIKU_DEVICE_ID_LENGTH]),
        deviceIdBuffer,
        Buffer.from([passwordBuffer.length]),
        passwordBuffer,
        Buffer.from([functionCode]),
        dataPayload,
    ]);

    const checksum = calculateChecksum(packetWithoutChecksum);
    return Buffer.concat([packetWithoutChecksum, Buffer.from([checksum & 0xff, (checksum >> 8) & 0xff])]);
}

export function buildReadPayload(entries: SikuReadRequestEntry[]): Buffer {
    const bytes: number[] = [];
    let currentPage = 0;

    for (const entry of entries) {
        const parameter = entry.parameter;
        const page = getParameterPage(parameter);
        const lowByte = getParameterLowByte(parameter);
        const requestValue = normalizeByteArray(entry.requestValue);
        const valueSize = entry.valueSize ?? requestValue.length;

        if (page !== currentPage) {
            bytes.push(SIKU_SPECIAL_COMMANDS.page, page);
            currentPage = page;
        }

        if (valueSize > 0) {
            if (requestValue.length !== valueSize) {
                throw new Error(
                    `Read request for parameter 0x${parameter.toString(16).padStart(4, '0')} has mismatched valueSize`,
                );
            }
            bytes.push(SIKU_SPECIAL_COMMANDS.valueSize, valueSize, lowByte, ...requestValue);
        } else {
            bytes.push(lowByte);
        }
    }

    return Buffer.from(bytes);
}

export function buildWritePayload(entries: SikuWriteRequestEntry[]): Buffer {
    const bytes: number[] = [];
    let currentPage = 0;

    for (const entry of entries) {
        const page = getParameterPage(entry.parameter);
        const lowByte = getParameterLowByte(entry.parameter);
        const valueBuffer = normalizeByteArray(entry.value);

        if (valueBuffer.length === 0) {
            throw new Error('Write payload values may not be empty');
        }

        if (page !== currentPage) {
            bytes.push(SIKU_SPECIAL_COMMANDS.page, page);
            currentPage = page;
        }

        if (valueBuffer.length > 1) {
            bytes.push(SIKU_SPECIAL_COMMANDS.valueSize, valueBuffer.length, lowByte, ...valueBuffer);
        } else {
            bytes.push(lowByte, valueBuffer[0]);
        }
    }

    return Buffer.from(bytes);
}

export function buildReadPacket(deviceId: string | Buffer, password: string, entries: SikuReadRequestEntry[]): Buffer {
    return buildPacket(deviceId, password, SikuFunction.Read, buildReadPayload(entries));
}

export function buildWritePacket(
    deviceId: string | Buffer,
    password: string,
    functionCode: SikuFunction.Write | SikuFunction.ReadWrite,
    entries: SikuWriteRequestEntry[],
): Buffer {
    return buildPacket(deviceId, password, functionCode, buildWritePayload(entries));
}

export function buildDiscoveryPacket(password = SIKU_DEFAULT_PASSWORD): Buffer {
    return buildReadPacket(
        SIKU_DEFAULT_DEVICE_ID,
        password,
        SIKU_DISCOVERY_PARAMETERS.map(parameter => ({ parameter })),
    );
}

export function parsePacket(packet: Buffer): ParsedSikuPacket {
    if (packet.length < 2 + 1 + 1 + SIKU_DEVICE_ID_LENGTH + 1 + 1 + 2) {
        throw new Error('Packet is too short to be valid');
    }

    if (!packet.subarray(0, 2).equals(SIKU_PACKET_PREFIX)) {
        throw new Error(`Invalid packet prefix: ${toHex(packet.subarray(0, 2))}`);
    }

    const protocolType = packet[2];
    if (protocolType !== SIKU_PROTOCOL_TYPE) {
        throw new Error(`Unsupported protocol type: 0x${protocolType.toString(16).padStart(2, '0')}`);
    }

    const storedChecksum = packet[packet.length - 2] + (packet[packet.length - 1] << 8);
    const checksumValid = calculateChecksum(packet.subarray(0, -2)) === storedChecksum;

    let position = 3;
    const deviceIdLength = packet[position++];
    const deviceIdBytes = packet.subarray(position, position + deviceIdLength);
    position += deviceIdLength;

    const passwordLength = packet[position++];
    const passwordBytes = packet.subarray(position, position + passwordLength);
    position += passwordLength;

    const baseFunctionCode = packet[position++] as SikuFunction;
    let currentFunctionCode = baseFunctionCode;
    let currentPage = 0;
    const entries: SikuPacketEntry[] = [];

    while (position < packet.length - 2) {
        const marker = packet[position];

        if (marker === SIKU_SPECIAL_COMMANDS.changeFunction) {
            currentFunctionCode = packet[position + 1] as SikuFunction;
            position += 2;
            continue;
        }

        if (marker === SIKU_SPECIAL_COMMANDS.page) {
            currentPage = packet[position + 1];
            position += 2;
            continue;
        }

        if (marker === SIKU_SPECIAL_COMMANDS.unsupported) {
            entries.push({
                parameter: (currentPage << 8) | packet[position + 1],
                size: 0,
                value: Buffer.alloc(0),
                unsupported: true,
                functionCode: currentFunctionCode,
            });
            position += 2;
            continue;
        }

        if (marker === SIKU_SPECIAL_COMMANDS.valueSize) {
            const valueSize = packet[position + 1];
            const lowByte = packet[position + 2];
            const start = position + 3;
            const end = start + valueSize;
            if (end > packet.length - 2) {
                throw new Error('Packet ended while parsing an extended value');
            }

            entries.push({
                parameter: (currentPage << 8) | lowByte,
                size: valueSize,
                value: packet.subarray(start, end),
                unsupported: false,
                functionCode: currentFunctionCode,
            });
            position = end;
            continue;
        }

        const parameter = (currentPage << 8) | marker;
        if (requiresValue(currentFunctionCode)) {
            if (position + 1 >= packet.length - 1) {
                throw new Error('Packet ended while parsing a single-byte value');
            }

            entries.push({
                parameter,
                size: 1,
                value: packet.subarray(position + 1, position + 2),
                unsupported: false,
                functionCode: currentFunctionCode,
            });
            position += 2;
        } else {
            entries.push({
                parameter,
                size: 0,
                value: Buffer.alloc(0),
                unsupported: false,
                functionCode: currentFunctionCode,
            });
            position += 1;
        }
    }

    return {
        protocolType,
        checksum: storedChecksum,
        checksumValid,
        deviceIdBytes,
        deviceIdText: decodeAscii(deviceIdBytes),
        passwordBytes,
        passwordText: decodeAscii(passwordBytes),
        functionCode: baseFunctionCode,
        entries,
    };
}
