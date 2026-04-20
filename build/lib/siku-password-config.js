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
var siku_password_config_exports = {};
__export(siku_password_config_exports, {
  buildDevicePasswordRegistry: () => buildDevicePasswordRegistry,
  normalizeDevicePasswordRegistry: () => normalizeDevicePasswordRegistry,
  normalizeDevicePasswordRegistryKey: () => normalizeDevicePasswordRegistryKey,
  resolveConfiguredDevicePassword: () => resolveConfiguredDevicePassword,
  serializeDevicePasswordRegistry: () => serializeDevicePasswordRegistry,
  stripLegacyPasswordsFromDevices: () => stripLegacyPasswordsFromDevices
});
module.exports = __toCommonJS(siku_password_config_exports);
var import_siku_constants = require("./siku-constants");
function normalizeDevicePasswordRegistryKey(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized.length !== import_siku_constants.SIKU_DEVICE_ID_LENGTH || !/^[0-9A-F]+$/u.test(normalized)) {
    return null;
  }
  return normalized;
}
function getTrimmedPasswordValue(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "object" && value !== null && "password" in value) {
    return getTrimmedPasswordValue(value.password);
  }
  return null;
}
function normalizeDevicePasswordRegistry(registry) {
  if (Array.isArray(registry)) {
    const normalized2 = {};
    for (const entry of registry) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const key = normalizeDevicePasswordRegistryKey(entry.id);
      const password = getTrimmedPasswordValue(entry.password);
      if (!key || !password) {
        continue;
      }
      normalized2[key] = password;
    }
    return normalized2;
  }
  if (typeof registry !== "object" || registry === null) {
    return {};
  }
  const normalized = {};
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
function serializeDevicePasswordRegistry(registry) {
  return Object.entries(registry).sort(([leftId], [rightId]) => leftId.localeCompare(rightId)).map(([id, password]) => ({ id, password }));
}
function resolveConfiguredDevicePassword(device, index, registry) {
  var _a;
  const normalizedId = normalizeDevicePasswordRegistryKey(device.id);
  const registryPassword = normalizedId ? registry[normalizedId] : void 0;
  const legacyPassword = getTrimmedPasswordValue(device.password);
  const resolvedPassword = (_a = registryPassword != null ? registryPassword : legacyPassword) != null ? _a : import_siku_constants.SIKU_DEFAULT_PASSWORD;
  if (resolvedPassword.length > 8) {
    const source = registryPassword ? `devicePasswords.${normalizedId}` : `devices[${index}].password`;
    throw new Error(`${source} must be at most 8 characters long`);
  }
  return resolvedPassword;
}
function buildDevicePasswordRegistry(devices, currentRegistry) {
  const normalizedRegistry = normalizeDevicePasswordRegistry(currentRegistry);
  const result = {};
  for (const [index, device] of (devices != null ? devices : []).entries()) {
    const normalizedId = normalizeDevicePasswordRegistryKey(device == null ? void 0 : device.id);
    if (!normalizedId) {
      continue;
    }
    result[normalizedId] = resolveConfiguredDevicePassword(device != null ? device : {}, index, normalizedRegistry);
  }
  return result;
}
function stripLegacyPasswordsFromDevices(devices) {
  return (devices != null ? devices : []).map((device) => {
    const { password: _password, ...deviceWithoutPassword } = device != null ? device : {};
    return {
      id: typeof deviceWithoutPassword.id === "string" ? deviceWithoutPassword.id : "",
      host: typeof deviceWithoutPassword.host === "string" ? deviceWithoutPassword.host : "",
      name: typeof deviceWithoutPassword.name === "string" ? deviceWithoutPassword.name : "",
      enabled: typeof deviceWithoutPassword.enabled === "boolean" ? deviceWithoutPassword.enabled : true,
      discoveredType: typeof deviceWithoutPassword.discoveredType === "string" ? deviceWithoutPassword.discoveredType : "",
      lastSeen: typeof deviceWithoutPassword.lastSeen === "string" ? deviceWithoutPassword.lastSeen : ""
    };
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildDevicePasswordRegistry,
  normalizeDevicePasswordRegistry,
  normalizeDevicePasswordRegistryKey,
  resolveConfiguredDevicePassword,
  serializeDevicePasswordRegistry,
  stripLegacyPasswordsFromDevices
});
//# sourceMappingURL=siku-password-config.js.map
