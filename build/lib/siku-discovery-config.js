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
var siku_discovery_config_exports = {};
__export(siku_discovery_config_exports, {
  formatDiscoveredType: () => formatDiscoveredType,
  mergeDiscoveredDevicePasswordsIntoConfig: () => mergeDiscoveredDevicePasswordsIntoConfig,
  mergeDiscoveredDevicesIntoConfig: () => mergeDiscoveredDevicesIntoConfig
});
module.exports = __toCommonJS(siku_discovery_config_exports);
var import_siku_constants = require("./siku-constants");
var import_siku_password_config = require("./siku-password-config");
function formatDiscoveredType(device) {
  if (device.deviceTypeHex && device.deviceTypeCode !== null) {
    return `${device.deviceTypeHex} (${device.deviceTypeCode})`;
  }
  if (device.deviceTypeHex) {
    return device.deviceTypeHex;
  }
  if (device.deviceTypeCode !== null) {
    return String(device.deviceTypeCode);
  }
  return "";
}
function mergeDiscoveredDevicesIntoConfig(configuredDevices, discoveredDevices) {
  const mergedDevices = [...configuredDevices != null ? configuredDevices : []].map((device) => ({ ...device }));
  const configuredIndexById = new Map(mergedDevices.map((device, index) => {
    var _a;
    return [(_a = device.id) == null ? void 0 : _a.toUpperCase(), index];
  }));
  for (const discoveredDevice of [...discoveredDevices].sort(
    (left, right) => left.deviceId.localeCompare(right.deviceId)
  )) {
    const discoveredType = formatDiscoveredType(discoveredDevice);
    const existingIndex = configuredIndexById.get(discoveredDevice.deviceId.toUpperCase());
    if (existingIndex !== void 0) {
      const existing = mergedDevices[existingIndex];
      mergedDevices[existingIndex] = {
        ...existing,
        id: discoveredDevice.deviceId,
        host: discoveredDevice.host,
        discoveredType,
        lastSeen: discoveredDevice.receivedAt
      };
      continue;
    }
    mergedDevices.push({
      id: discoveredDevice.deviceId,
      host: discoveredDevice.host,
      name: `L\xFCfter ${discoveredDevice.deviceId.slice(-4)}`,
      enabled: true,
      discoveredType,
      lastSeen: discoveredDevice.receivedAt
    });
  }
  return mergedDevices;
}
function mergeDiscoveredDevicePasswordsIntoConfig(configuredDevices, currentRegistry, mergedDevices) {
  const registry = (0, import_siku_password_config.buildDevicePasswordRegistry)(configuredDevices, currentRegistry);
  for (const device of mergedDevices) {
    const normalizedId = (0, import_siku_password_config.normalizeDevicePasswordRegistryKey)(device.id);
    if (!normalizedId || registry[normalizedId]) {
      continue;
    }
    registry[normalizedId] = import_siku_constants.SIKU_DEFAULT_PASSWORD;
  }
  return registry;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  formatDiscoveredType,
  mergeDiscoveredDevicePasswordsIntoConfig,
  mergeDiscoveredDevicesIntoConfig
});
//# sourceMappingURL=siku-discovery-config.js.map
