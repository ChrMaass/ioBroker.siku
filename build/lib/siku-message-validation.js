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
var siku_message_validation_exports = {};
__export(siku_message_validation_exports, {
  normalizeDiscoverMessagePayload: () => normalizeDiscoverMessagePayload,
  normalizeReadDeviceMessagePayload: () => normalizeReadDeviceMessagePayload
});
module.exports = __toCommonJS(siku_message_validation_exports);
var import_siku_constants = require("./siku-constants");
function getObjectPayload(message, command) {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    throw new Error(`${command} requires an object payload`);
  }
  return message;
}
function getOptionalStringField(payload, fieldName, options = {}) {
  const value = payload[fieldName];
  if (value === void 0) {
    return void 0;
  }
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  if (!options.allowEmpty && value.length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }
  if (options.exactLength !== void 0 && value.length !== options.exactLength) {
    throw new Error(`${fieldName} must be exactly ${options.exactLength} characters long`);
  }
  if (options.maxLength !== void 0 && value.length > options.maxLength) {
    throw new Error(`${fieldName} must be at most ${options.maxLength} characters long`);
  }
  return value;
}
function getRequiredStringField(payload, fieldName, options = {}) {
  const value = getOptionalStringField(payload, fieldName, options);
  if (value === void 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}
function getOptionalIntegerField(payload, fieldName, minimum, maximum) {
  const value = payload[fieldName];
  if (value === void 0) {
    return void 0;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
function normalizeDiscoverMessagePayload(message) {
  const payload = getObjectPayload(message, "discover");
  return {
    broadcastAddress: getOptionalStringField(payload, "broadcastAddress"),
    password: getOptionalStringField(payload, "password", { maxLength: 8 }),
    timeoutMs: getOptionalIntegerField(payload, "timeoutMs", 1, Number.MAX_SAFE_INTEGER),
    preferredBindPort: getOptionalIntegerField(payload, "preferredBindPort", 0, 65535)
  };
}
function normalizeReadDeviceMessagePayload(message) {
  const payload = getObjectPayload(message, "readDevice");
  const parameters = payload.parameters;
  if (!Array.isArray(parameters)) {
    throw new Error("parameters must be an array");
  }
  if (parameters.length === 0) {
    throw new Error("parameters must not be empty");
  }
  return {
    host: getRequiredStringField(payload, "host"),
    deviceId: getRequiredStringField(payload, "deviceId", { exactLength: import_siku_constants.SIKU_DEVICE_ID_LENGTH }),
    password: getOptionalStringField(payload, "password", { maxLength: 8 }),
    port: getOptionalIntegerField(payload, "port", 1, 65535),
    timeoutMs: getOptionalIntegerField(payload, "timeoutMs", 1, Number.MAX_SAFE_INTEGER),
    parameters
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  normalizeDiscoverMessagePayload,
  normalizeReadDeviceMessagePayload
});
//# sourceMappingURL=siku-message-validation.js.map
