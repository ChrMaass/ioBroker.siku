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
var siku_runtime_exports = {};
__export(siku_runtime_exports, {
  decodeIPv4Address: () => decodeIPv4Address,
  decodePollSnapshot: () => decodePollSnapshot,
  normalizeConfiguredDevice: () => normalizeConfiguredDevice
});
module.exports = __toCommonJS(siku_runtime_exports);
var import_node_net = require("node:net");
var import_siku_constants = require("./siku-constants");
var import_siku_protocol = require("./siku-protocol");
var import_siku_password_config = require("./siku-password-config");
function getPacketEntry(packet, parameter) {
  return packet.entries.find((entry) => entry.parameter === parameter && !entry.unsupported);
}
function getTrimmedString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}
function normalizeConfiguredDevice(device, index, passwordRegistry = void 0) {
  if (typeof device !== "object" || device === null) {
    throw new Error(`devices[${index}] must be an object`);
  }
  const id = getTrimmedString(device.id, `devices[${index}].id`).toUpperCase();
  if (id.length !== import_siku_constants.SIKU_DEVICE_ID_LENGTH) {
    throw new Error(`devices[${index}].id must be exactly ${import_siku_constants.SIKU_DEVICE_ID_LENGTH} characters long`);
  }
  if (!/^[0-9A-F]+$/u.test(id)) {
    throw new Error(`devices[${index}].id must only contain hexadecimal characters`);
  }
  const host = getTrimmedString(device.host, `devices[${index}].host`);
  if (!(0, import_node_net.isIPv4)(host)) {
    throw new Error(`devices[${index}].host must be an IPv4 address`);
  }
  const discoveredType = typeof device.discoveredType === "string" ? device.discoveredType.trim() : "";
  const lastSeen = typeof device.lastSeen === "string" ? device.lastSeen : "";
  const password = (0, import_siku_password_config.resolveConfiguredDevicePassword)(device, index, (0, import_siku_password_config.normalizeDevicePasswordRegistry)(passwordRegistry));
  const enabled = device.enabled === void 0 ? true : device.enabled;
  if (typeof enabled !== "boolean") {
    throw new Error(`devices[${index}].enabled must be a boolean`);
  }
  return {
    id,
    host,
    name: typeof device.name === "string" && device.name.trim().length > 0 ? device.name.trim() : `L\xFCfter ${id.slice(-4)}`,
    password,
    enabled,
    discoveredType,
    lastSeen,
    objectId: `devices.${id}`
  };
}
function decodeIPv4Address(value) {
  if (value.length !== 4) {
    return null;
  }
  return Array.from(value.values()).join(".");
}
function decodePollSnapshot(configuredDeviceId, packet, receivedAt = /* @__PURE__ */ new Date()) {
  var _a;
  const idEntry = getPacketEntry(packet, import_siku_constants.SIKU_PARAMETER_DEVICE_ID);
  const powerEntry = getPacketEntry(packet, import_siku_constants.SIKU_PARAMETER_POWER);
  const fanSpeedEntry = getPacketEntry(packet, import_siku_constants.SIKU_PARAMETER_FAN_SPEED);
  const deviceTypeEntry = getPacketEntry(packet, import_siku_constants.SIKU_PARAMETER_DEVICE_TYPE);
  const ipAddressEntry = getPacketEntry(packet, import_siku_constants.SIKU_PARAMETER_IP_ADDRESS);
  const reportedDeviceId = (0, import_siku_protocol.decodeAscii)((_a = idEntry == null ? void 0 : idEntry.value) != null ? _a : packet.deviceIdBytes);
  if (!reportedDeviceId) {
    throw new Error("Device response did not contain a usable device ID");
  }
  if (reportedDeviceId !== configuredDeviceId) {
    throw new Error(
      `Configured device ID ${configuredDeviceId} does not match response device ID ${reportedDeviceId}`
    );
  }
  return {
    reportedDeviceId,
    power: powerEntry ? powerEntry.value.some((byte) => byte !== 0) : null,
    fanSpeed: fanSpeedEntry ? (0, import_siku_protocol.decodeUnsignedLE)(fanSpeedEntry.value) : null,
    deviceTypeCode: deviceTypeEntry ? (0, import_siku_protocol.decodeUnsignedLE)(deviceTypeEntry.value) : null,
    deviceTypeHex: deviceTypeEntry ? (0, import_siku_protocol.toHex)(deviceTypeEntry.value) : null,
    ipAddress: ipAddressEntry ? decodeIPv4Address(ipAddressEntry.value) : null,
    lastSeen: receivedAt.toISOString()
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  decodeIPv4Address,
  decodePollSnapshot,
  normalizeConfiguredDevice
});
//# sourceMappingURL=siku-runtime.js.map
