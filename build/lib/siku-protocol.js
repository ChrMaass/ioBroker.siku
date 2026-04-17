"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var siku_protocol_exports = {};
__export(siku_protocol_exports, {
  buildDiscoveryPacket: () => buildDiscoveryPacket,
  buildPacket: () => buildPacket,
  buildReadPacket: () => buildReadPacket,
  buildReadPayload: () => buildReadPayload,
  buildWritePacket: () => buildWritePacket,
  buildWritePayload: () => buildWritePayload,
  calculateChecksum: () => calculateChecksum,
  decodeAscii: () => decodeAscii,
  decodeUnsignedLE: () => decodeUnsignedLE,
  parsePacket: () => parsePacket,
  toHex: () => toHex
});
module.exports = __toCommonJS(siku_protocol_exports);
var import_siku_constants = require("./siku-constants");
function normalizeAsciiField(input, expectedLength, fieldName) {
  if (Buffer.isBuffer(input)) {
    if (input.length !== expectedLength) {
      throw new Error(`${fieldName} must be exactly ${expectedLength} bytes long`);
    }
    return Buffer.from(input);
  }
  if (input.length !== expectedLength) {
    throw new Error(`${fieldName} must be exactly ${expectedLength} characters long`);
  }
  return Buffer.from(input, "ascii");
}
function normalizeByteArray(input) {
  if (!input) {
    return Buffer.alloc(0);
  }
  const buffer = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input);
  for (const byte of buffer.values()) {
    if (byte < 0 || byte > 255) {
      throw new Error(`Invalid byte value ${byte}`);
    }
  }
  return buffer;
}
function getParameterPage(parameter) {
  return parameter >> 8 & 255;
}
function getParameterLowByte(parameter) {
  return parameter & 255;
}
function requiresValue(functionCode) {
  return functionCode === import_siku_constants.SikuFunction.Write || functionCode === import_siku_constants.SikuFunction.ReadWrite || functionCode === import_siku_constants.SikuFunction.Response;
}
function decodeAscii(buffer) {
  return buffer.toString("ascii").replace(/\0+$/u, "");
}
function decodeUnsignedLE(buffer) {
  return buffer.reduce((accumulator, byte, index) => accumulator + byte * 256 ** index, 0);
}
function toHex(buffer) {
  return buffer.toString("hex").toUpperCase();
}
function calculateChecksum(packetWithoutChecksum) {
  let checksum = 0;
  for (let index = 2; index < packetWithoutChecksum.length; index++) {
    checksum += packetWithoutChecksum[index];
  }
  return checksum & 65535;
}
function buildPacket(deviceId, password, functionCode, dataPayload) {
  if (password.length > 8) {
    throw new Error("Password must be at most 8 characters long");
  }
  const deviceIdBuffer = normalizeAsciiField(deviceId, import_siku_constants.SIKU_DEVICE_ID_LENGTH, "deviceId");
  const passwordBuffer = Buffer.from(password, "ascii");
  const packetWithoutChecksum = Buffer.concat([
    import_siku_constants.SIKU_PACKET_PREFIX,
    Buffer.from([import_siku_constants.SIKU_PROTOCOL_TYPE, import_siku_constants.SIKU_DEVICE_ID_LENGTH]),
    deviceIdBuffer,
    Buffer.from([passwordBuffer.length]),
    passwordBuffer,
    Buffer.from([functionCode]),
    dataPayload
  ]);
  const checksum = calculateChecksum(packetWithoutChecksum);
  return Buffer.concat([packetWithoutChecksum, Buffer.from([checksum & 255, checksum >> 8 & 255])]);
}
function buildReadPayload(entries) {
  var _a;
  const bytes = [];
  let currentPage = 0;
  for (const entry of entries) {
    const parameter = entry.parameter;
    const page = getParameterPage(parameter);
    const lowByte = getParameterLowByte(parameter);
    const requestValue = normalizeByteArray(entry.requestValue);
    const valueSize = (_a = entry.valueSize) != null ? _a : requestValue.length;
    if (page !== currentPage) {
      bytes.push(import_siku_constants.SIKU_SPECIAL_COMMANDS.page, page);
      currentPage = page;
    }
    if (valueSize > 0) {
      if (requestValue.length !== valueSize) {
        throw new Error(
          `Read request for parameter 0x${parameter.toString(16).padStart(4, "0")} has mismatched valueSize`
        );
      }
      bytes.push(import_siku_constants.SIKU_SPECIAL_COMMANDS.valueSize, valueSize, lowByte, ...requestValue);
    } else {
      bytes.push(lowByte);
    }
  }
  return Buffer.from(bytes);
}
function buildWritePayload(entries) {
  const bytes = [];
  let currentPage = 0;
  for (const entry of entries) {
    const page = getParameterPage(entry.parameter);
    const lowByte = getParameterLowByte(entry.parameter);
    const valueBuffer = normalizeByteArray(entry.value);
    if (valueBuffer.length === 0) {
      throw new Error("Write payload values may not be empty");
    }
    if (page !== currentPage) {
      bytes.push(import_siku_constants.SIKU_SPECIAL_COMMANDS.page, page);
      currentPage = page;
    }
    if (valueBuffer.length > 1) {
      bytes.push(import_siku_constants.SIKU_SPECIAL_COMMANDS.valueSize, valueBuffer.length, lowByte, ...valueBuffer);
    } else {
      bytes.push(lowByte, valueBuffer[0]);
    }
  }
  return Buffer.from(bytes);
}
function buildReadPacket(deviceId, password, entries) {
  return buildPacket(deviceId, password, import_siku_constants.SikuFunction.Read, buildReadPayload(entries));
}
function buildWritePacket(deviceId, password, functionCode, entries) {
  return buildPacket(deviceId, password, functionCode, buildWritePayload(entries));
}
function buildDiscoveryPacket(password = import_siku_constants.SIKU_DEFAULT_PASSWORD) {
  return buildReadPacket(
    import_siku_constants.SIKU_DEFAULT_DEVICE_ID,
    password,
    import_siku_constants.SIKU_DISCOVERY_PARAMETERS.map((parameter) => ({ parameter }))
  );
}
function parsePacket(packet) {
  if (packet.length < 2 + 1 + 1 + import_siku_constants.SIKU_DEVICE_ID_LENGTH + 1 + 1 + 2) {
    throw new Error("Packet is too short to be valid");
  }
  if (!packet.subarray(0, 2).equals(import_siku_constants.SIKU_PACKET_PREFIX)) {
    throw new Error(`Invalid packet prefix: ${toHex(packet.subarray(0, 2))}`);
  }
  const protocolType = packet[2];
  if (protocolType !== import_siku_constants.SIKU_PROTOCOL_TYPE) {
    throw new Error(`Unsupported protocol type: 0x${protocolType.toString(16).padStart(2, "0")}`);
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
  const baseFunctionCode = packet[position++];
  let currentFunctionCode = baseFunctionCode;
  let currentPage = 0;
  const entries = [];
  while (position < packet.length - 2) {
    const marker = packet[position];
    if (marker === import_siku_constants.SIKU_SPECIAL_COMMANDS.changeFunction) {
      currentFunctionCode = packet[position + 1];
      position += 2;
      continue;
    }
    if (marker === import_siku_constants.SIKU_SPECIAL_COMMANDS.page) {
      currentPage = packet[position + 1];
      position += 2;
      continue;
    }
    if (marker === import_siku_constants.SIKU_SPECIAL_COMMANDS.unsupported) {
      entries.push({
        parameter: currentPage << 8 | packet[position + 1],
        size: 0,
        value: Buffer.alloc(0),
        unsupported: true,
        functionCode: currentFunctionCode
      });
      position += 2;
      continue;
    }
    if (marker === import_siku_constants.SIKU_SPECIAL_COMMANDS.valueSize) {
      const valueSize = packet[position + 1];
      const lowByte = packet[position + 2];
      const start = position + 3;
      const end = start + valueSize;
      if (end > packet.length - 2) {
        throw new Error("Packet ended while parsing an extended value");
      }
      entries.push({
        parameter: currentPage << 8 | lowByte,
        size: valueSize,
        value: packet.subarray(start, end),
        unsupported: false,
        functionCode: currentFunctionCode
      });
      position = end;
      continue;
    }
    const parameter = currentPage << 8 | marker;
    if (requiresValue(currentFunctionCode)) {
      if (position + 1 >= packet.length - 1) {
        throw new Error("Packet ended while parsing a single-byte value");
      }
      entries.push({
        parameter,
        size: 1,
        value: packet.subarray(position + 1, position + 2),
        unsupported: false,
        functionCode: currentFunctionCode
      });
      position += 2;
    } else {
      entries.push({
        parameter,
        size: 0,
        value: Buffer.alloc(0),
        unsupported: false,
        functionCode: currentFunctionCode
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
    entries
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildDiscoveryPacket,
  buildPacket,
  buildReadPacket,
  buildReadPayload,
  buildWritePacket,
  buildWritePayload,
  calculateChecksum,
  decodeAscii,
  decodeUnsignedLE,
  parsePacket,
  toHex
});
//# sourceMappingURL=siku-protocol.js.map
