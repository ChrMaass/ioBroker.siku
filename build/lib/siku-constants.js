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
var siku_constants_exports = {};
__export(siku_constants_exports, {
  SIKU_DEFAULT_DEVICE_ID: () => SIKU_DEFAULT_DEVICE_ID,
  SIKU_DEFAULT_PASSWORD: () => SIKU_DEFAULT_PASSWORD,
  SIKU_DEFAULT_PORT: () => SIKU_DEFAULT_PORT,
  SIKU_DEVICE_ID_LENGTH: () => SIKU_DEVICE_ID_LENGTH,
  SIKU_DISCOVERY_PARAMETERS: () => SIKU_DISCOVERY_PARAMETERS,
  SIKU_DISCOVERY_TIMEOUT_MS: () => SIKU_DISCOVERY_TIMEOUT_MS,
  SIKU_PACKET_PREFIX: () => SIKU_PACKET_PREFIX,
  SIKU_PARAMETER_DEVICE_ID: () => SIKU_PARAMETER_DEVICE_ID,
  SIKU_PARAMETER_DEVICE_TYPE: () => SIKU_PARAMETER_DEVICE_TYPE,
  SIKU_PROTOCOL_TYPE: () => SIKU_PROTOCOL_TYPE,
  SIKU_REQUEST_RETRY_DELAYS_MS: () => SIKU_REQUEST_RETRY_DELAYS_MS,
  SIKU_REQUEST_TIMEOUT_MS: () => SIKU_REQUEST_TIMEOUT_MS,
  SIKU_SPECIAL_COMMANDS: () => SIKU_SPECIAL_COMMANDS,
  SikuFunction: () => SikuFunction
});
module.exports = __toCommonJS(siku_constants_exports);
const SIKU_DEFAULT_PORT = 4e3;
const SIKU_DEFAULT_PASSWORD = "1111";
const SIKU_DEFAULT_DEVICE_ID = "DEFAULT_DEVICEID";
const SIKU_PACKET_PREFIX = Buffer.from([253, 253]);
const SIKU_PROTOCOL_TYPE = 2;
const SIKU_DEVICE_ID_LENGTH = 16;
const SIKU_DISCOVERY_TIMEOUT_MS = 1500;
const SIKU_REQUEST_TIMEOUT_MS = 2500;
const SIKU_REQUEST_RETRY_DELAYS_MS = [0, 200, 500];
const SIKU_DISCOVERY_PARAMETERS = [124, 185];
const SIKU_PARAMETER_DEVICE_ID = 124;
const SIKU_PARAMETER_DEVICE_TYPE = 185;
var SikuFunction = /* @__PURE__ */ ((SikuFunction2) => {
  SikuFunction2[SikuFunction2["Read"] = 1] = "Read";
  SikuFunction2[SikuFunction2["Write"] = 2] = "Write";
  SikuFunction2[SikuFunction2["ReadWrite"] = 3] = "ReadWrite";
  SikuFunction2[SikuFunction2["Increment"] = 4] = "Increment";
  SikuFunction2[SikuFunction2["Decrement"] = 5] = "Decrement";
  SikuFunction2[SikuFunction2["Response"] = 6] = "Response";
  return SikuFunction2;
})(SikuFunction || {});
const SIKU_SPECIAL_COMMANDS = {
  changeFunction: 252,
  unsupported: 253,
  valueSize: 254,
  page: 255
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SIKU_DEFAULT_DEVICE_ID,
  SIKU_DEFAULT_PASSWORD,
  SIKU_DEFAULT_PORT,
  SIKU_DEVICE_ID_LENGTH,
  SIKU_DISCOVERY_PARAMETERS,
  SIKU_DISCOVERY_TIMEOUT_MS,
  SIKU_PACKET_PREFIX,
  SIKU_PARAMETER_DEVICE_ID,
  SIKU_PARAMETER_DEVICE_TYPE,
  SIKU_PROTOCOL_TYPE,
  SIKU_REQUEST_RETRY_DELAYS_MS,
  SIKU_REQUEST_TIMEOUT_MS,
  SIKU_SPECIAL_COMMANDS,
  SikuFunction
});
//# sourceMappingURL=siku-constants.js.map
