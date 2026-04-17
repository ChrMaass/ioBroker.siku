"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_siku_network = require("./lib/siku-network");
var import_siku_protocol = require("./lib/siku-protocol");
class Siku extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "siku"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("message", (obj) => {
      void this.onMessage(obj);
    });
    this.on("unload", this.onUnload.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    await this.setState("info.connection", false, true);
    this.log.info("Starte SIKU-Adapter im Bootstrap-Modus");
    this.logSafeConfig();
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  onUnload(callback) {
    try {
      callback();
    } catch (error) {
      this.log.error(`Error during unloading: ${error.message}`);
      callback();
    }
  }
  /**
   * Handles adapter messages from the admin UI or other instances.
   *
   * @param obj - The incoming ioBroker message object
   */
  async onMessage(obj) {
    if (typeof obj !== "object" || !obj.command) {
      return;
    }
    try {
      switch (obj.command) {
        case "discover":
          await this.handleDiscoverMessage(obj);
          break;
        case "readDevice":
          await this.handleReadDeviceMessage(obj);
          break;
        default:
          this.sendMessageResponse(obj, {
            ok: false,
            error: `Unknown command: ${obj.command}`
          });
          break;
      }
    } catch (error) {
      const message = error.message;
      this.log.error(`Fehler bei Nachricht ${obj.command}: ${message}`);
      this.sendMessageResponse(obj, { ok: false, error: message });
    }
  }
  /**
   * Performs a network discovery using UDP broadcast and returns JSON-serializable results.
   *
   * @param obj - The original ioBroker message
   */
  async handleDiscoverMessage(obj) {
    var _a;
    const payload = typeof obj.message === "object" ? obj.message : {};
    const devices = await (0, import_siku_network.discoverDevices)({
      broadcastAddress: (_a = payload.broadcastAddress) != null ? _a : this.config.discoveryBroadcastAddress,
      password: payload.password,
      timeoutMs: payload.timeoutMs,
      preferredBindPort: payload.preferredBindPort
    });
    this.sendMessageResponse(obj, { ok: true, devices });
  }
  /**
   * Sends a read-only UDP request to a specific device.
   *
   * @param obj - The original ioBroker message
   */
  async handleReadDeviceMessage(obj) {
    var _a;
    if (typeof obj.message !== "object" || obj.message === null) {
      throw new Error("readDevice requires an object payload");
    }
    const payload = obj.message;
    if (!payload.host || !payload.deviceId || !Array.isArray(payload.parameters)) {
      throw new Error("readDevice requires host, deviceId and parameters");
    }
    const packet = await (0, import_siku_network.readDevicePacket)({
      host: payload.host,
      deviceId: payload.deviceId,
      password: (_a = payload.password) != null ? _a : "1111",
      port: payload.port,
      timeoutMs: payload.timeoutMs,
      parameters: this.normalizeReadParameters(payload.parameters)
    });
    this.sendMessageResponse(obj, { ok: true, packet: this.serializePacket(packet) });
  }
  /**
   * Converts messagebox read parameter definitions into the internal request format.
   *
   * @param parameters - Raw parameter definitions from the message payload
   */
  normalizeReadParameters(parameters) {
    return parameters.map(
      (parameter) => typeof parameter === "number" ? { parameter } : {
        parameter: parameter.parameter,
        valueSize: parameter.valueSize,
        requestValue: parameter.requestValue
      }
    );
  }
  /**
   * Converts a parsed packet into a JSON-serializable payload for sendTo callbacks.
   *
   * @param packet - Parsed SIKU packet
   */
  serializePacket(packet) {
    return {
      protocolType: packet.protocolType,
      checksum: packet.checksum,
      checksumValid: packet.checksumValid,
      deviceId: packet.deviceIdText,
      passwordLength: packet.passwordBytes.length,
      functionCode: packet.functionCode,
      entries: packet.entries.map((entry) => ({
        parameter: entry.parameter,
        parameterHex: `0x${entry.parameter.toString(16).padStart(4, "0")}`,
        size: entry.size,
        unsupported: entry.unsupported,
        functionCode: entry.functionCode,
        valueHex: (0, import_siku_protocol.toHex)(entry.value)
      }))
    };
  }
  /**
   * Sends a messagebox response if the caller provided a callback.
   *
   * @param obj - The original ioBroker message
   * @param response - JSON-serializable response payload
   */
  sendMessageResponse(obj, response) {
    if (obj.callback) {
      this.sendTo(obj.from, obj.command, response, obj.callback);
    }
  }
  /**
   * Logs a sanitized configuration snapshot without leaking device passwords into debug logs.
   */
  logSafeConfig() {
    var _a;
    const devices = (_a = this.config.devices) != null ? _a : [];
    const enabledDevices = devices.filter((device) => device.enabled).length;
    this.log.debug(
      `Konfiguration: ${JSON.stringify({
        pollIntervalSec: this.config.pollIntervalSec,
        discoveryBroadcastAddress: this.config.discoveryBroadcastAddress,
        timeCheckIntervalHours: this.config.timeCheckIntervalHours,
        timeSyncThresholdSec: this.config.timeSyncThresholdSec,
        configuredDevices: devices.length,
        enabledDevices
      })}`
    );
  }
}
if (require.main !== module) {
  module.exports = (options) => new Siku(options);
} else {
  (() => new Siku())();
}
//# sourceMappingURL=main.js.map
