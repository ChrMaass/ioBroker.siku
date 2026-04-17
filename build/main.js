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
var import_siku_discovery_config = require("./lib/siku-discovery-config");
var import_siku_constants = require("./lib/siku-constants");
var import_siku_message_validation = require("./lib/siku-message-validation");
var import_siku_network = require("./lib/siku-network");
var import_siku_schedule = require("./lib/siku-schedule");
var import_siku_state_mapping = require("./lib/siku-state-mapping");
var import_siku_protocol = require("./lib/siku-protocol");
var import_siku_time = require("./lib/siku-time");
var import_siku_runtime = require("./lib/siku-runtime");
class Siku extends utils.Adapter {
  runtimeDevices = /* @__PURE__ */ new Map();
  deviceOperationQueues = /* @__PURE__ */ new Map();
  pollCycleRunning = false;
  timeCheckRunning = false;
  pollIntervalHandle;
  timeCheckIntervalHandle;
  constructor(options = {}) {
    super({
      ...options,
      name: "siku"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("message", (obj) => {
      void this.onMessage(obj);
    });
    this.on("stateChange", (id, state) => {
      void this.onStateChange(id, state);
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
    await this.subscribeWritableStates();
    await this.pollDevices("startup");
    this.startPolling();
    this.startTimeCheckScheduler();
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  onUnload(callback) {
    try {
      this.clearPollingTimer();
      this.clearTimeCheckTimer();
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
        case "syncTimeAll":
          await this.handleSyncTimeAllMessage(obj);
          break;
        case "syncTimeDevice":
          await this.handleSyncTimeDeviceMessage(obj);
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
   * Handles write requests to writable ioBroker states and forwards them to the device.
   *
   * @param id - Full ioBroker state id
   * @param state - New state value
   */
  async onStateChange(id, state) {
    if (!state || state.ack || !id.startsWith(`${this.namespace}.devices.`)) {
      return;
    }
    const resolved = this.resolveWritableState(id);
    if (!resolved) {
      return;
    }
    const { device, relativeId, fullStateId } = resolved;
    try {
      await this.enqueueDeviceOperation(device.id, async () => {
        var _a;
        const request = (0, import_siku_schedule.isScheduleStateId)(relativeId) ? await this.buildScheduleWriteRequestForState(fullStateId, relativeId, state.val) : (0, import_siku_state_mapping.buildWriteRequestForState)(relativeId, state.val);
        const responsePacket = await (0, import_siku_network.writeDevicePacket)({
          host: device.host,
          deviceId: device.id,
          password: device.password,
          parameters: [request]
        });
        await this.applyMappedStateUpdates(device, (0, import_siku_state_mapping.decodeMappedStateUpdates)(responsePacket));
        await this.applyMappedStateUpdates(device, (0, import_siku_schedule.decodeScheduleUpdates)(responsePacket));
        if ((0, import_siku_schedule.isScheduleStateId)(relativeId)) {
          return;
        }
        if ((0, import_siku_state_mapping.isButtonState)(relativeId)) {
          await this.setStateChangedAsync(fullStateId, false, true);
        } else {
          const updatedValue = (_a = (0, import_siku_state_mapping.decodeMappedStateUpdates)(responsePacket).find(
            (update) => update.relativeId === relativeId
          )) == null ? void 0 : _a.value;
          await this.setStateChangedAsync(fullStateId, updatedValue != null ? updatedValue : state.val, true);
        }
        await this.setStateChangedAsync(`${device.objectId}.diagnostics.lastError`, "", true);
      });
      this.log.info(`Schreibzugriff erfolgreich: ${device.id} -> ${relativeId} = ${JSON.stringify(state.val)}`);
    } catch (error) {
      const message = error.message;
      await this.setStateChangedAsync(`${device.objectId}.diagnostics.lastError`, `Schreiben: ${message}`, true);
      this.log.warn(`Schreibzugriff fehlgeschlagen f\xFCr ${device.id} (${relativeId}): ${message}`);
    }
  }
  /**
   * Performs a network discovery using UDP broadcast, updates matching runtime devices
   * and returns a merged native config payload for the admin UI.
   *
   * @param obj - The original ioBroker message
   */
  async handleDiscoverMessage(obj) {
    var _a, _b, _c;
    const payload = (0, import_siku_message_validation.normalizeDiscoverMessagePayload)((_a = obj.message) != null ? _a : {});
    const devices = await (0, import_siku_network.discoverDevices)({
      broadcastAddress: (_b = payload.broadcastAddress) != null ? _b : this.config.discoveryBroadcastAddress,
      password: payload.password,
      timeoutMs: payload.timeoutMs,
      preferredBindPort: payload.preferredBindPort
    });
    await this.applyDiscoveryResults(devices);
    const mergedDevices = (0, import_siku_discovery_config.mergeDiscoveredDevicesIntoConfig)(this.config.devices, devices);
    const response = {
      ok: true,
      devices
    };
    if (devices.length === 0) {
      response.result = "discoveryNoDevices";
    } else if (JSON.stringify(mergedDevices) !== JSON.stringify((_c = this.config.devices) != null ? _c : [])) {
      response.result = "discoveryUpdated";
      response.saveConfig = true;
      response.native = this.buildNativeConfig(mergedDevices);
    } else {
      response.result = "discoveryUnchanged";
    }
    this.sendMessageResponse(obj, response);
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
   * Executes an on-demand time check for all configured devices.
   *
   * @param obj - The original ioBroker message
   */
  async handleSyncTimeAllMessage(obj) {
    const summary = await this.runTimeChecks("manual");
    this.sendMessageResponse(obj, {
      ok: true,
      result: this.getTimeCheckResultCode(summary),
      summary
    });
  }
  /**
   * Executes an on-demand time check for exactly one configured device.
   *
   * @param obj - The original ioBroker message
   */
  async handleSyncTimeDeviceMessage(obj) {
    var _a;
    const payload = (0, import_siku_message_validation.normalizeSyncTimeDeviceMessagePayload)((_a = obj.message) != null ? _a : {});
    const device = this.runtimeDevices.get(payload.deviceId);
    if (!device) {
      throw new Error(`Device ${payload.deviceId} is not configured in native.devices`);
    }
    const summary = await this.runTimeChecks("manual", [device]);
    this.sendMessageResponse(obj, {
      ok: true,
      result: this.getTimeCheckResultCode(summary),
      summary
    });
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
        await this.applyConfiguredDeviceMetadata(runtimeDevice, { resetConnectionState: true });
      } catch (error) {
        this.log.warn(`Ung\xFCltige Ger\xE4tekonfiguration unter devices[${index}]: ${error.message}`);
      }
    }
    if (this.runtimeDevices.size === 0) {
      this.log.info(
        "Keine g\xFCltigen L\xFCfter konfiguriert. Discovery, readDevice und syncTime bleiben \xFCber sendTo nutzbar."
      );
    }
  }
  /**
   * Subscribes to all writable adapter states once after startup.
   */
  async subscribeWritableStates() {
    for (const relativeId of [...import_siku_state_mapping.SIKU_WRITABLE_STATE_IDS, ...import_siku_schedule.SIKU_SCHEDULE_WRITABLE_STATE_IDS]) {
      await this.subscribeStatesAsync(`devices.*.${relativeId}`);
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
    this.pollIntervalHandle = this.setInterval(() => {
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
      this.clearInterval(this.pollIntervalHandle);
      this.pollIntervalHandle = void 0;
    }
  }
  /**
   * Starts the dedicated periodic RTC check scheduler. The RTC is intentionally not part
   * of the regular polling cycle to avoid unnecessary reads of the clock parameters.
   */
  startTimeCheckScheduler() {
    var _a;
    this.clearTimeCheckTimer();
    if (this.runtimeDevices.size === 0) {
      return;
    }
    const intervalMs = Math.max((_a = this.config.timeCheckIntervalHours) != null ? _a : 24, 1) * 60 * 60 * 1e3;
    this.timeCheckIntervalHandle = this.setInterval(() => {
      this.runTimeChecks("interval").catch((error) => {
        this.log.error(`Fehler bei der Zeitpr\xFCfung im Intervall: ${error.message}`);
      });
    }, intervalMs);
    this.log.debug(`Zeitpr\xFCfung geplant: alle ${intervalMs} ms`);
  }
  /**
   * Stops the recurring time check timer if it is currently active.
   */
  clearTimeCheckTimer() {
    if (this.timeCheckIntervalHandle) {
      this.clearInterval(this.timeCheckIntervalHandle);
      this.timeCheckIntervalHandle = void 0;
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
      const packet = await this.enqueueDeviceOperation(
        device.id,
        async () => (0, import_siku_network.readDevicePacket)({
          host: device.host,
          deviceId: device.id,
          password: device.password,
          parameters: [
            ...Array.from(/* @__PURE__ */ new Set([...import_siku_constants.SIKU_RUNTIME_POLL_PARAMETERS, ...import_siku_state_mapping.SIKU_POLL_PARAMETERS])).map(
              (parameter) => ({ parameter })
            ),
            ...(0, import_siku_schedule.buildScheduleReadRequests)()
          ]
        })
      );
      const snapshot = (0, import_siku_runtime.decodePollSnapshot)(device.id, packet, pollStartedAt);
      await this.applyPollSnapshot(device, snapshot, pollStartedAtIso, Date.now() - pollStartedMs);
      await this.applyMappedStateUpdates(device, (0, import_siku_state_mapping.decodeMappedStateUpdates)(packet));
      await this.applyMappedStateUpdates(device, (0, import_siku_schedule.decodeScheduleUpdates)(packet));
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
   * Executes the dedicated RTC check for one or multiple devices and synchronizes
   * the device clock only if the absolute drift is above the configured threshold.
   *
   * @param trigger - Source of the time check
   * @param targetDevices - Optional subset of configured devices
   */
  async runTimeChecks(trigger, targetDevices = Array.from(this.runtimeDevices.values())) {
    if (this.timeCheckRunning) {
      this.log.debug(`Zeitpr\xFCfung (${trigger}) \xFCbersprungen, da bereits ein Zyklus l\xE4uft.`);
      return {
        trigger,
        total: targetDevices.length,
        checked: 0,
        synced: 0,
        failed: 0,
        skipped: targetDevices.length,
        skippedBecauseBusy: true,
        devices: targetDevices.map((device) => ({
          deviceId: device.id,
          host: device.host,
          checked: false,
          synced: false,
          failed: false,
          skipped: true,
          driftSec: null,
          reason: "busy",
          checkedAt: null,
          syncedAt: null
        }))
      };
    }
    this.timeCheckRunning = true;
    const results = [];
    try {
      for (const device of targetDevices) {
        results.push(await this.runTimeCheckForDevice(device, trigger));
      }
    } finally {
      this.timeCheckRunning = false;
    }
    return {
      trigger,
      total: targetDevices.length,
      checked: results.filter((result) => result.checked).length,
      synced: results.filter((result) => result.synced).length,
      failed: results.filter((result) => result.failed).length,
      skipped: results.filter((result) => result.skipped).length,
      skippedBecauseBusy: false,
      devices: results
    };
  }
  /**
   * Performs the RTC read/optional write sequence for one device.
   *
   * @param device - Runtime device configuration
   * @param trigger - Source of the time check for logging
   */
  async runTimeCheckForDevice(device, trigger) {
    var _a;
    const checkedAt = /* @__PURE__ */ new Date();
    const checkedAtIso = checkedAt.toISOString();
    const prefix = device.objectId;
    await this.setStateChangedAsync(`${prefix}.diagnostics.lastTimeCheck`, checkedAtIso, true);
    if (!device.enabled) {
      return {
        deviceId: device.id,
        host: device.host,
        checked: false,
        synced: false,
        failed: false,
        skipped: true,
        driftSec: null,
        reason: "disabled",
        checkedAt: checkedAtIso,
        syncedAt: null
      };
    }
    try {
      const packet = await this.enqueueDeviceOperation(
        device.id,
        async () => (0, import_siku_network.readDevicePacket)({
          host: device.host,
          deviceId: device.id,
          password: device.password,
          parameters: import_siku_constants.SIKU_TIME_CHECK_PARAMETERS.map((parameter) => ({ parameter }))
        })
      );
      const rtcSnapshot = (0, import_siku_time.decodeRtcSnapshot)(packet);
      const referenceTime = /* @__PURE__ */ new Date();
      const driftSec = (0, import_siku_time.calculateClockDriftSeconds)(rtcSnapshot.deviceDate, referenceTime);
      await this.setStateChangedAsync(`${prefix}.diagnostics.clockDriftSec`, driftSec, true);
      await this.setStateChangedAsync(`${prefix}.diagnostics.lastError`, "", true);
      this.log.debug(
        `Zeitpr\xFCfung ${device.name} (${device.id}) [${trigger}]: Drift ${driftSec}s gegen\xFCber ${referenceTime.toISOString()}`
      );
      if (Math.abs(driftSec) <= Math.max((_a = this.config.timeSyncThresholdSec) != null ? _a : 10, 0)) {
        return {
          deviceId: device.id,
          host: device.host,
          checked: true,
          synced: false,
          failed: false,
          skipped: false,
          driftSec,
          reason: "withinThreshold",
          checkedAt: checkedAtIso,
          syncedAt: null
        };
      }
      const syncDate = /* @__PURE__ */ new Date();
      await this.enqueueDeviceOperation(
        device.id,
        async () => (0, import_siku_network.writeDevicePacket)({
          host: device.host,
          deviceId: device.id,
          password: device.password,
          parameters: [
            { parameter: import_siku_constants.SIKU_PARAMETER_RTC_TIME, value: (0, import_siku_time.encodeRtcTime)(syncDate) },
            { parameter: import_siku_constants.SIKU_PARAMETER_RTC_CALENDAR, value: (0, import_siku_time.encodeRtcCalendar)(syncDate) }
          ]
        })
      );
      const syncedAtIso = syncDate.toISOString();
      await this.setStateChangedAsync(`${prefix}.diagnostics.lastTimeSync`, syncedAtIso, true);
      this.log.info(
        `Zeit von ${device.name} (${device.id}) um ${driftSec}s korrigiert (${device.host}, ${syncedAtIso})`
      );
      return {
        deviceId: device.id,
        host: device.host,
        checked: true,
        synced: true,
        failed: false,
        skipped: false,
        driftSec,
        reason: "synced",
        checkedAt: checkedAtIso,
        syncedAt: syncedAtIso
      };
    } catch (error) {
      const message = error.message;
      await this.setStateChangedAsync(`${prefix}.diagnostics.lastError`, `Zeitpr\xFCfung: ${message}`, true);
      this.log.warn(
        `Zeitpr\xFCfung fehlgeschlagen f\xFCr ${device.name} (${device.id}) via ${device.host}: ${message}`
      );
      return {
        deviceId: device.id,
        host: device.host,
        checked: false,
        synced: false,
        failed: true,
        skipped: false,
        driftSec: null,
        reason: "error",
        checkedAt: checkedAtIso,
        syncedAt: null,
        error: message
      };
    }
  }
  /**
   * Returns the stable result code that the JSON config button should display.
   *
   * @param summary - Summary of a manual or scheduled time check run
   */
  getTimeCheckResultCode(summary) {
    if (summary.skippedBecauseBusy) {
      return "timeCheckBusy";
    }
    if (summary.total === 0) {
      return "timeCheckNoDevices";
    }
    if (summary.failed > 0) {
      return "timeCheckCompletedWithErrors";
    }
    if (summary.synced > 0) {
      return "timeCheckSynced";
    }
    return "timeCheckNoSyncNeeded";
  }
  /**
   * Applies the discovery results to already configured runtime devices so polling,
   * state metadata and diagnostics can immediately reflect the identified host/type.
   *
   * @param devices - Discovered devices from the latest UDP broadcast search
   */
  async applyDiscoveryResults(devices) {
    for (const discoveredDevice of devices) {
      const runtimeDevice = this.runtimeDevices.get(discoveredDevice.deviceId);
      if (!runtimeDevice) {
        continue;
      }
      runtimeDevice.host = discoveredDevice.host;
      runtimeDevice.discoveredType = (0, import_siku_discovery_config.formatDiscoveredType)(discoveredDevice);
      runtimeDevice.lastSeen = discoveredDevice.receivedAt;
      await this.applyConfiguredDeviceMetadata(runtimeDevice);
      if (discoveredDevice.deviceTypeCode !== null) {
        await this.setStateChangedAsync(
          `${runtimeDevice.objectId}.info.deviceTypeCode`,
          discoveredDevice.deviceTypeCode,
          true
        );
      }
      if (discoveredDevice.deviceTypeHex !== null) {
        await this.setStateChangedAsync(
          `${runtimeDevice.objectId}.info.deviceTypeHex`,
          discoveredDevice.deviceTypeHex,
          true
        );
      }
    }
  }
  /**
   * Builds the full native config object that the JSON config sendTo button can reuse.
   *
   * @param devices - Updated device list to send back to the admin UI
   */
  buildNativeConfig(devices) {
    return {
      pollIntervalSec: this.config.pollIntervalSec,
      discoveryBroadcastAddress: this.config.discoveryBroadcastAddress,
      timeCheckIntervalHours: this.config.timeCheckIntervalHours,
      timeSyncThresholdSec: this.config.timeSyncThresholdSec,
      devices
    };
  }
  /**
   * Writes the static metadata derived from the adapter config into the ioBroker state tree.
   *
   * @param device - Runtime device configuration
   * @param options - Optional behavior switches for initial setup
   */
  async applyConfiguredDeviceMetadata(device, options = {}) {
    const prefix = device.objectId;
    await this.setStateChangedAsync(`${prefix}.info.host`, device.host, true);
    await this.setStateChangedAsync(`${prefix}.info.name`, device.name, true);
    await this.setStateChangedAsync(`${prefix}.info.deviceId`, device.id, true);
    await this.setStateChangedAsync(`${prefix}.info.enabled`, device.enabled, true);
    await this.setStateChangedAsync(`${prefix}.info.configuredType`, device.discoveredType, true);
    if (device.lastSeen) {
      await this.setStateChangedAsync(`${prefix}.info.lastSeen`, device.lastSeen, true);
      await this.setStateChangedAsync(`${prefix}.diagnostics.lastDiscovery`, device.lastSeen, true);
    }
    if (options.resetConnectionState) {
      await this.setStateChangedAsync(`${prefix}.info.connection`, false, true);
    }
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
   * Applies protocol-level mapped state updates from a packet to the ioBroker object tree.
   *
   * @param device - Runtime device configuration
   * @param updates - Decoded state/value pairs from the packet
   */
  async applyMappedStateUpdates(device, updates) {
    for (const update of updates) {
      await this.setStateChangedAsync(`${device.objectId}.${update.relativeId}`, update.value, true);
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
    for (const dayDefinition of (0, import_siku_schedule.getScheduleDayDefinitions)()) {
      await this.extendObjectAsync(`${prefix}.schedule.${dayDefinition.key}`, {
        type: "channel",
        common: {
          name: dayDefinition.name
        },
        native: {}
      });
      for (const periodNumber of [1, 2, 3, 4]) {
        await this.extendObjectAsync(`${prefix}.schedule.${dayDefinition.key}.p${periodNumber}`, {
          type: "channel",
          common: {
            name: `Periode ${periodNumber}`
          },
          native: {}
        });
      }
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
        id: `${prefix}.diagnostics.lastDiscovery`,
        common: {
          name: "Letzte Discovery",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.diagnostics.lastTimeCheck`,
        common: {
          name: "Letzte Zeitpr\xFCfung",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.diagnostics.lastTimeSync`,
        common: {
          name: "Letzter Zeitsync",
          role: "text",
          type: "string",
          read: true,
          write: false,
          def: ""
        }
      },
      {
        id: `${prefix}.diagnostics.clockDriftSec`,
        common: {
          name: "Uhrzeitabweichung",
          role: "value.interval",
          unit: "s",
          type: "number",
          read: true,
          write: false,
          def: 0
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
    for (const channelId of ["info", "control", "sensors", "timers", "diagnostics"]) {
      for (const definition of (0, import_siku_state_mapping.getStateDefinitionsByChannel)(channelId)) {
        stateDefinitions.push({
          id: `${prefix}.${definition.relativeId}`,
          common: definition.common
        });
      }
    }
    for (const definition of (0, import_siku_schedule.getScheduleStateDefinitions)()) {
      stateDefinitions.push({
        id: `${prefix}.${definition.relativeId}`,
        common: definition.common
      });
    }
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
   * Resolves a state id to a configured runtime device plus the relative mapped state id.
   *
   * @param id - Full ioBroker state id
   */
  resolveWritableState(id) {
    const relativeNamespaceId = id.slice(`${this.namespace}.`.length);
    const match = /^devices\.([A-F0-9]{16})\.(.+)$/u.exec(relativeNamespaceId);
    if (!match) {
      return void 0;
    }
    const [, deviceId, relativeId] = match;
    const device = this.runtimeDevices.get(deviceId);
    if (!device || !import_siku_state_mapping.SIKU_WRITABLE_STATE_IDS.includes(relativeId) && !(0, import_siku_schedule.isScheduleStateId)(relativeId)) {
      return void 0;
    }
    return {
      device,
      relativeId,
      fullStateId: `${this.namespace}.${relativeNamespaceId}`
    };
  }
  /**
   * Builds a complete schedule write request by combining the changed state with the
   * current sibling states of the same weekday/period snapshot.
   *
   * @param fullStateId - Full ioBroker id of the changed state
   * @param relativeId - Relative schedule state id
   * @param value - New user-provided value
   */
  async buildScheduleWriteRequestForState(fullStateId, relativeId, value) {
    var _a;
    const values = {};
    for (const snapshotRelativeId of (0, import_siku_schedule.getScheduleSnapshotStateIds)(relativeId)) {
      const state = await this.getStateAsync(fullStateId.replace(relativeId, snapshotRelativeId));
      values[snapshotRelativeId] = (_a = state == null ? void 0 : state.val) != null ? _a : 0;
    }
    values[relativeId] = value;
    return (0, import_siku_schedule.buildScheduleWriteRequest)(relativeId, values);
  }
  /**
   * Serializes operations per device to avoid overlapping reads and writes on the same UDP target.
   *
   * @param deviceId - Device queue key
   * @param operation - Async operation that should run exclusively for the device
   */
  async enqueueDeviceOperation(deviceId, operation) {
    var _a;
    const previous = (_a = this.deviceOperationQueues.get(deviceId)) != null ? _a : Promise.resolve();
    const next = previous.catch(() => void 0).then(operation);
    const settled = next.finally(() => {
      if (this.deviceOperationQueues.get(deviceId) === settled) {
        this.deviceOperationQueues.delete(deviceId);
      }
    });
    this.deviceOperationQueues.set(deviceId, settled);
    return next;
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
