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
var import_siku_constants = require("./lib/siku-constants");
var import_siku_message_validation = require("./lib/siku-message-validation");
var import_siku_network = require("./lib/siku-network");
var import_siku_protocol = require("./lib/siku-protocol");
var import_siku_runtime = require("./lib/siku-runtime");
class Siku extends utils.Adapter {
  runtimeDevices = /* @__PURE__ */ new Map();
  pollCycleRunning = false;
  pollIntervalHandle;
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
    this.log.info("Starte SIKU-Adapter mit Multi-Device-Runtime");
    this.logSafeConfig();
    await this.initializeRuntimeDevices();
    await this.pollDevices("startup");
    this.startPolling();
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  onUnload(callback) {
    try {
      this.clearPollingTimer();
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
    if (!obj || typeof obj !== "object" || !("command" in obj) || !obj.command) {
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
    var _a, _b;
    const payload = (0, import_siku_message_validation.normalizeDiscoverMessagePayload)((_a = obj.message) != null ? _a : {});
    const devices = await (0, import_siku_network.discoverDevices)({
      broadcastAddress: (_b = payload.broadcastAddress) != null ? _b : this.config.discoveryBroadcastAddress,
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
    const payload = (0, import_siku_message_validation.normalizeReadDeviceMessagePayload)(obj.message);
    const packet = await (0, import_siku_network.readDevicePacket)({
      host: payload.host,
      deviceId: payload.deviceId,
      password: (_a = payload.password) != null ? _a : import_siku_constants.SIKU_DEFAULT_PASSWORD,
      port: payload.port,
      timeoutMs: payload.timeoutMs,
      parameters: this.normalizeReadParameters(payload.parameters)
    });
    this.sendMessageResponse(obj, { ok: true, packet: this.serializePacket(packet) });
  }
  /**
   * Creates the runtime registry from the adapter configuration and prepares the ioBroker object tree.
   */
  async initializeRuntimeDevices() {
    var _a;
    await this.extendObjectAsync("devices", {
      type: "channel",
      common: {
        name: "L\xFCftungsger\xE4te"
      },
      native: {}
    });
    this.runtimeDevices.clear();
    for (const [index, configuredDevice] of ((_a = this.config.devices) != null ? _a : []).entries()) {
      try {
        const runtimeDevice = (0, import_siku_runtime.normalizeConfiguredDevice)(configuredDevice, index);
        if (this.runtimeDevices.has(runtimeDevice.id)) {
          this.log.warn(`Ger\xE4t ${runtimeDevice.id} ist mehrfach konfiguriert und wird nur einmal verwendet.`);
          continue;
        }
        this.runtimeDevices.set(runtimeDevice.id, runtimeDevice);
        await this.ensureDeviceObjects(runtimeDevice);
        await this.applyConfiguredDeviceMetadata(runtimeDevice);
      } catch (error) {
        this.log.warn(`Ung\xFCltige Ger\xE4tekonfiguration unter devices[${index}]: ${error.message}`);
      }
    }
    if (this.runtimeDevices.size === 0) {
      this.log.info(
        "Keine g\xFCltigen L\xFCfter konfiguriert. Discovery und readDevice sind weiterhin \xFCber sendTo nutzbar."
      );
    }
  }
  /**
   * Starts the recurring polling timer for all configured devices.
   */
  startPolling() {
    var _a;
    this.clearPollingTimer();
    if (this.runtimeDevices.size === 0) {
      return;
    }
    const intervalMs = Math.max((_a = this.config.pollIntervalSec) != null ? _a : 30, 5) * 1e3;
    this.pollIntervalHandle = setInterval(() => {
      this.pollDevices("interval").catch((error) => {
        this.log.error(`Fehler beim Polling im Intervall: ${error.message}`);
      });
    }, intervalMs);
    this.log.debug(`Polling gestartet: alle ${intervalMs} ms`);
  }
  /**
   * Stops the recurring polling timer if it is currently active.
   */
  clearPollingTimer() {
    if (this.pollIntervalHandle) {
      clearInterval(this.pollIntervalHandle);
      this.pollIntervalHandle = void 0;
    }
  }
  /**
   * Polls all configured devices sequentially and updates the adapter-wide connection state.
   *
   * @param trigger - Human-readable trigger source for debug logging
   */
  async pollDevices(trigger) {
    if (this.pollCycleRunning) {
      this.log.debug(`Polling (${trigger}) \xFCbersprungen, da bereits ein Zyklus l\xE4uft.`);
      return;
    }
    this.pollCycleRunning = true;
    let anyConnected = false;
    try {
      for (const device of this.runtimeDevices.values()) {
        anyConnected = await this.pollSingleDevice(device, trigger) || anyConnected;
      }
      await this.setStateChangedAsync("info.connection", anyConnected, true);
    } finally {
      this.pollCycleRunning = false;
    }
  }
  /**
   * Polls one configured device and updates its runtime states.
   *
   * @param device - Runtime device configuration
   * @param trigger - Human-readable trigger source for debug logging
   */
  async pollSingleDevice(device, trigger) {
    const pollStartedAt = /* @__PURE__ */ new Date();
    const pollStartedAtIso = pollStartedAt.toISOString();
    const pollStartedMs = Date.now();
    const prefix = device.objectId;
    if (!device.enabled) {
      await this.setStateChangedAsync(`${prefix}.info.connection`, false, true);
      return false;
    }
    await this.setStateChangedAsync(`${prefix}.info.lastPoll`, pollStartedAtIso, true);
    try {
      const packet = await (0, import_siku_network.readDevicePacket)({
        host: device.host,
        deviceId: device.id,
        password: device.password,
        parameters: import_siku_constants.SIKU_RUNTIME_POLL_PARAMETERS.map((parameter) => ({ parameter }))
      });
      const snapshot = (0, import_siku_runtime.decodePollSnapshot)(device.id, packet, pollStartedAt);
      await this.applyPollSnapshot(device, snapshot, pollStartedAtIso, Date.now() - pollStartedMs);
      this.log.debug(`Polling erfolgreich f\xFCr ${device.name} (${device.id}) via ${device.host} [${trigger}]`);
      return true;
    } catch (error) {
      const message = error.message;
      await this.setStateChangedAsync(`${prefix}.info.connection`, false, true);
      await this.setStateChangedAsync(`${prefix}.diagnostics.lastError`, message, true);
      await this.setStateChangedAsync(`${prefix}.diagnostics.pollDurationMs`, Date.now() - pollStartedMs, true);
      this.log.warn(`Polling fehlgeschlagen f\xFCr ${device.name} (${device.id}) via ${device.host}: ${message}`);
      return false;
    }
  }
  /**
   * Writes the static metadata derived from the adapter config into the ioBroker state tree.
   *
   * @param device - Runtime device configuration
   */
  async applyConfiguredDeviceMetadata(device) {
    const prefix = device.objectId;
    await this.setStateChangedAsync(`${prefix}.info.host`, device.host, true);
    await this.setStateChangedAsync(`${prefix}.info.name`, device.name, true);
    await this.setStateChangedAsync(`${prefix}.info.deviceId`, device.id, true);
    await this.setStateChangedAsync(`${prefix}.info.enabled`, device.enabled, true);
    await this.setStateChangedAsync(`${prefix}.info.configuredType`, device.discoveredType, true);
    if (device.lastSeen) {
      await this.setStateChangedAsync(`${prefix}.info.lastSeen`, device.lastSeen, true);
    }
    await this.setStateChangedAsync(`${prefix}.info.connection`, false, true);
  }
  /**
   * Applies a successful poll snapshot to the ioBroker states of one device.
   *
   * @param device - Runtime device configuration
   * @param snapshot - Decoded snapshot from the device response
   * @param pollStartedAtIso - Timestamp of the poll cycle start
   * @param durationMs - Measured poll duration in milliseconds
   */
  async applyPollSnapshot(device, snapshot, pollStartedAtIso, durationMs) {
    const prefix = device.objectId;
    await this.setStateChangedAsync(`${prefix}.info.connection`, true, true);
    await this.setStateChangedAsync(`${prefix}.info.lastSeen`, snapshot.lastSeen, true);
    await this.setStateChangedAsync(`${prefix}.diagnostics.lastSuccessfulPoll`, pollStartedAtIso, true);
    await this.setStateChangedAsync(`${prefix}.diagnostics.lastError`, "", true);
    await this.setStateChangedAsync(`${prefix}.diagnostics.pollDurationMs`, durationMs, true);
    await this.setStateChangedAsync(`${prefix}.diagnostics.reportedDeviceId`, snapshot.reportedDeviceId, true);
    if (snapshot.power !== null) {
      await this.setStateChangedAsync(`${prefix}.control.power`, snapshot.power, true);
    }
    if (snapshot.fanSpeed !== null) {
      await this.setStateChangedAsync(`${prefix}.control.fanSpeed`, snapshot.fanSpeed, true);
    }
    if (snapshot.deviceTypeCode !== null) {
      await this.setStateChangedAsync(`${prefix}.info.deviceTypeCode`, snapshot.deviceTypeCode, true);
    }
    if (snapshot.deviceTypeHex !== null) {
      await this.setStateChangedAsync(`${prefix}.info.deviceTypeHex`, snapshot.deviceTypeHex, true);
    }
    if (snapshot.ipAddress !== null) {
      await this.setStateChangedAsync(`${prefix}.info.ipAddress`, snapshot.ipAddress, true);
    }
  }
  /**
   * Ensures that the base object tree for one device exists.
   *
   * @param device - Runtime device configuration
   */
  async ensureDeviceObjects(device) {
    const prefix = device.objectId;
    await this.extendObjectAsync(prefix, {
      type: "device",
      common: {
        name: device.name
      },
      native: {
        deviceId: device.id
      }
    });
    for (const channelDefinition of [
      { id: "info", name: "Information" },
      { id: "control", name: "Steuerung" },
      { id: "sensors", name: "Sensoren" },
      { id: "timers", name: "Timer" },
      { id: "schedule", name: "Zeitpl\xE4ne" },
      { id: "diagnostics", name: "Diagnose" }
    ]) {
      await this.extendObjectAsync(`${prefix}.${channelDefinition.id}`, {
        type: "channel",
        common: {
          name: channelDefinition.name
        },
        native: {}
      });
    }
    const stateDefinitions = [
      {
        id: `${prefix}.info.connection`,
        common: {
          name: "Verbunden",
          role: "indicator.connected",
          type: "boolean",
          read: true,
          write: false,
          def: false
        }
      },
      {
        id: `${prefix}.info.host`,
        common: {
          name: "Host",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.info.name`,
        common: {
          name: "Name",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.info.deviceId`,
        common: {
          name: "Konfigurierte Ger\xE4te-ID",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.info.configuredType`,
        common: {
          name: "Konfigurierter Typ",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.info.deviceTypeCode`,
        common: {
          name: "Ger\xE4tetyp-Code",
          role: "value",
          type: "number",
          read: true,
          write: false
        }
      },
      {
        id: `${prefix}.info.deviceTypeHex`,
        common: {
          name: "Ger\xE4tetyp Hex",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.info.ipAddress`,
        common: {
          name: "Gemeldete IP-Adresse",
          role: "info.ip",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.info.lastSeen`,
        common: {
          name: "Zuletzt gesehen",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.info.lastPoll`,
        common: {
          name: "Letzter Poll-Versuch",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.info.enabled`,
        common: {
          name: "Aktiviert",
          role: "indicator",
          type: "boolean",
          read: true,
          write: false,
          def: false
        }
      },
      {
        id: `${prefix}.control.power`,
        common: {
          name: "Eingeschaltet",
          role: "switch",
          type: "boolean",
          read: true,
          write: false,
          def: false
        }
      },
      {
        id: `${prefix}.control.fanSpeed`,
        common: {
          name: "L\xFCfterstufe",
          role: "level.speed",
          type: "number",
          read: true,
          write: false,
          def: 0
        }
      },
      {
        id: `${prefix}.diagnostics.reportedDeviceId`,
        common: {
          name: "Zuletzt gemeldete Ger\xE4te-ID",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.diagnostics.lastSuccessfulPoll`,
        common: {
          name: "Letzter erfolgreicher Poll",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.diagnostics.lastError`,
        common: {
          name: "Letzter Fehler",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.diagnostics.pollDurationMs`,
        common: {
          name: "Poll-Dauer",
          role: "value.interval",
          unit: "ms",
          type: "number",
          read: true,
          write: false,
          def: 0
        }
      }
    ];
    for (const stateDefinition of stateDefinitions) {
      await this.extendObjectAsync(stateDefinition.id, {
        type: "state",
        common: stateDefinition.common,
        native: {}
      });
    }
  }
  /**
   * Converts messagebox read parameter definitions into the internal request format.
   *
   * @param parameters - Raw parameter definitions from the message payload
   */
  normalizeReadParameters(parameters) {
    return parameters.map((parameter, index) => {
      const location = `parameters[${index}]`;
      if (typeof parameter === "number") {
        return { parameter: this.validateReadParameterId(parameter, location) };
      }
      if (typeof parameter !== "object" || parameter === null) {
        throw new Error(`${location} must be a number or an object`);
      }
      const entry = parameter;
      const normalized = {
        parameter: this.validateReadParameterId(entry.parameter, `${location}.parameter`)
      };
      if (entry.valueSize !== void 0) {
        if (!Number.isInteger(entry.valueSize) || entry.valueSize < 0 || entry.valueSize > 255) {
          throw new Error(`${location}.valueSize must be an integer between 0 and 255`);
        }
        normalized.valueSize = entry.valueSize;
      }
      if (entry.requestValue !== void 0) {
        const requestValue = this.normalizeRequestValue(entry.requestValue, `${location}.requestValue`);
        const requestValueLength = requestValue.length;
        if (normalized.valueSize !== void 0 && normalized.valueSize !== requestValueLength) {
          throw new Error(
            `${location}.valueSize (${normalized.valueSize}) must match ${location}.requestValue length (${requestValueLength})`
          );
        }
        normalized.requestValue = requestValue;
      }
      return normalized;
    });
  }
  /**
   * Validates a read parameter identifier from a message payload.
   *
   * @param value - Raw parameter identifier
   * @param fieldName - Field name for error reporting
   */
  validateReadParameterId(value, fieldName) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 65535) {
      throw new Error(`${fieldName} must be an integer between 0 and 65535`);
    }
    return value;
  }
  /**
   * Normalizes request payload bytes and rejects invalid byte values early.
   *
   * @param requestValue - Raw request value from the message payload
   * @param fieldName - Field name for error reporting
   */
  normalizeRequestValue(requestValue, fieldName) {
    if (Buffer.isBuffer(requestValue)) {
      return Buffer.from(requestValue);
    }
    if (requestValue instanceof Uint8Array) {
      return new Uint8Array(requestValue);
    }
    if (Array.isArray(requestValue)) {
      requestValue.forEach((value, index) => {
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
          throw new Error(`${fieldName}[${index}] must be an integer between 0 and 255`);
        }
      });
      return requestValue.map((value) => value);
    }
    throw new Error(`${fieldName} must be a Buffer, Uint8Array or array of byte values`);
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
