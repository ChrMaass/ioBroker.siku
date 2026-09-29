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
  prepareStoredDevicePasswords: () => prepareStoredDevicePasswords,
  resolveConfiguredDevicePassword: () => resolveConfiguredDevicePassword,
  serializeDevicePasswordRegistry: () => serializeDevicePasswordRegistry,
  stripLegacyPasswordsFromDevices: () => stripLegacyPasswordsFromDevices
});
module.exports = __toCommonJS(siku_password_config_exports);
var import_siku_constants = require("./siku-constants");
const AES_PASSWORD_PREFIX = "$/aes-192-cbc:";
function isProtocolPassword(value) {
  return typeof value === "string" && /^[0-9A-Za-z]{1,8}$/u.test(value);
}
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
function resolveConfiguredDevicePassword(device, index, registry, unavailableDeviceIds = /* @__PURE__ */ new Set()) {
  var _a;
  const normalizedId = normalizeDevicePasswordRegistryKey(device.id);
  if (normalizedId && unavailableDeviceIds.has(normalizedId)) {
    throw new Error(`devicePasswords.${normalizedId} could not be decrypted and must be configured again`);
  }
  const registryPassword = normalizedId ? registry[normalizedId] : void 0;
  const legacyPassword = getTrimmedPasswordValue(device.password);
  const resolvedPassword = (_a = registryPassword != null ? registryPassword : legacyPassword) != null ? _a : import_siku_constants.SIKU_DEFAULT_PASSWORD;
  if (!isProtocolPassword(resolvedPassword)) {
    const source = registryPassword ? `devicePasswords.${normalizedId}` : `devices[${index}].password`;
    throw new Error(`${source} must contain 1 to 8 letters or digits`);
  }
  return resolvedPassword;
}
function getStoredPasswordRows(registry) {
  const rows = /* @__PURE__ */ new Map();
  const entries = Array.isArray(registry) ? registry.map(
    (entry) => typeof entry === "object" && entry !== null ? [entry.id, entry.password] : [void 0, void 0]
  ) : typeof registry === "object" && registry !== null ? Object.entries(registry) : [];
  for (const [rawId, rawPassword] of entries) {
    const id = normalizeDevicePasswordRegistryKey(rawId);
    const password = getTrimmedPasswordValue(rawPassword);
    if (id && password) {
      rows.set(id, password);
    }
  }
  return rows;
}
function prepareStoredDevicePasswords(options) {
  const decrypted = normalizeDevicePasswordRegistry(options.decryptedRegistry);
  const storedRows = getStoredPasswordRows(options.storedRegistry);
  const runtimeRegistry = {};
  const storedRegistry = [];
  const invalidDeviceIds = [];
  const configuredIds = /* @__PURE__ */ new Set();
  for (const device of options.configuredDevices) {
    const id = normalizeDevicePasswordRegistryKey(device.id);
    if (!id || configuredIds.has(id)) {
      continue;
    }
    configuredIds.add(id);
    const storedValue = storedRows.get(id);
    let decryptedStoredValue;
    let password;
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
      }
      password != null ? password : password = isProtocolPassword(decrypted[id]) ? decrypted[id] : void 0;
    } else if (isProtocolPassword(decrypted[id])) {
      password = decrypted[id];
    } else {
      const legacyInlinePassword = getTrimmedPasswordValue(device.password);
      password = isProtocolPassword(legacyInlinePassword) ? legacyInlinePassword : import_siku_constants.SIKU_DEFAULT_PASSWORD;
    }
    if (!password) {
      invalidDeviceIds.push(id);
      if (storedValue) {
        storedRegistry.push({ id, password: storedValue });
      }
      continue;
    }
    runtimeRegistry[id] = password;
    storedRegistry.push({
      id,
      password: (storedValue == null ? void 0 : storedValue.startsWith(AES_PASSWORD_PREFIX)) && decryptedStoredValue === password ? storedValue : options.encrypt(password)
    });
  }
  storedRegistry.sort((left, right) => left.id.localeCompare(right.id));
  const normalizedStoredRows = Array.from(storedRows.entries()).sort(([leftId], [rightId]) => leftId.localeCompare(rightId)).map(([id, password]) => ({ id, password }));
  if (configuredIds.size === 0) {
    return {
      runtimeRegistry,
      storedRegistry: normalizedStoredRows,
      storageChanged: false,
      invalidDeviceIds
    };
  }
  return {
    runtimeRegistry,
    storedRegistry,
    storageChanged: !Array.isArray(options.storedRegistry) || JSON.stringify(storedRegistry) !== JSON.stringify(normalizedStoredRows),
    invalidDeviceIds
  };
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
  prepareStoredDevicePasswords,
  resolveConfiguredDevicePassword,
  serializeDevicePasswordRegistry,
  stripLegacyPasswordsFromDevices
});
//# sourceMappingURL=siku-password-config.js.map
