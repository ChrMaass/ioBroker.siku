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
var import_siku_display = require("./lib/siku-display");
var import_siku_password_config = require("./lib/siku-password-config");
var import_siku_schedule = require("./lib/siku-schedule");
var import_siku_state_mapping = require("./lib/siku-state-mapping");
var import_siku_protocol = require("./lib/siku-protocol");
var import_siku_time = require("./lib/siku-time");
var import_siku_timer = require("./lib/siku-timer");
var import_siku_time_scheduler = require("./lib/siku-time-scheduler");
var import_siku_operation_queue = require("./lib/siku-operation-queue");
var import_siku_objects = require("./lib/siku-objects");
var import_siku_runtime = require("./lib/siku-runtime");
var import_siku_runtime_safety = require("./lib/siku-runtime-safety");
class Siku extends utils.Adapter {
  runtimeDevices = /* @__PURE__ */ new Map();
  operationCoordinator = new import_siku_operation_queue.SikuOperationCoordinator();
  lastScheduleRefreshMs = /* @__PURE__ */ new Map();
  pendingScheduleWrites = /* @__PURE__ */ new Map();
  unavailablePasswordDeviceIds = /* @__PURE__ */ new Set();
  shutdownController = new AbortController();
  runtimePasswordRegistry = {};
  unloading = false;
  pollCycleRunning = false;
  timeCheckRunning = false;
  pollIntervalHandle;
  timeCheckTimeoutHandle;
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
    try {
      await this.setState("info.connection", false, true);
      this.log.info("Starting SIKU adapter with multi-device runtime");
      await this.migrateLegacyPasswordConfig();
      this.logSafeConfig();
      await this.initializeRuntimeDevices();
      await this.subscribeWritableStates();
      this.startPolling();
      await this.startTimeCheckScheduler();
      await this.pollDevices("startup");
    } catch (error) {
      const message = `Adapter startup failed: ${error.message}`;
      this.log.error(message);
      this.terminate(message, utils.EXIT_CODES.START_IMMEDIATELY_AFTER_STOP);
    }
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  onUnload(callback) {
    try {
      this.unloading = true;
      this.shutdownController.abort();
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
    if (this.unloading) {
      this.sendMessageResponse(obj, { ok: false, error: "Adapter is shutting down" });
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
      this.log.error(`Error while handling message ${obj.command}: ${message}`);
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
    if (this.unloading || !state || state.ack || !id.startsWith(`${this.namespace}.devices.`)) {
      return;
    }
    const resolved = this.resolveWritableState(id);
    if (!resolved) {
      return;
    }
    const { device, relativeId, fullStateId } = resolved;
    if ((0, import_siku_schedule.isScheduleStateId)(relativeId)) {
      this.registerPendingScheduleWrite(device.id, relativeId, state.val);
    }
    try {
      await this.executeStateWrite(device, relativeId, fullStateId, state.val);
      this.log.info(`Write successful: ${device.id} -> ${relativeId} = ${JSON.stringify(state.val)}`);
    } catch (error) {
      const message = error.message;
      if ((0, import_siku_schedule.isScheduleStateId)(relativeId)) {
        this.lastScheduleRefreshMs.delete(device.id);
        await this.refreshScheduleAfterWriteFailure(device);
      }
      if (!this.unloading) {
        await this.setStateChangedAsync(
          `${device.objectId}.diagnostics.lastError`,
          this.limitDiagnosticError(`Write: ${message}`),
          true
        );
      }
      this.log.warn(`Write failed for ${device.id} (${relativeId}): ${message}`);
    } finally {
      if (!this.unloading && (0, import_siku_state_mapping.isButtonState)(relativeId)) {
        await this.setStateChangedAsync(fullStateId, false, true);
      }
    }
  }
  async executeStateWrite(device, relativeId, fullStateId, value) {
    const scheduleState = (0, import_siku_schedule.isScheduleStateId)(relativeId);
    let operationStarted = false;
    try {
      await this.enqueueDeviceOperation(device.id, async () => {
        var _a;
        operationStarted = true;
        try {
          const request = scheduleState ? await this.buildScheduleWriteRequestForState(device.id, fullStateId, relativeId, value) : (0, import_siku_state_mapping.buildWriteRequestForState)(relativeId, value);
          const writeDefinition = scheduleState ? void 0 : (_a = (0, import_siku_state_mapping.getWritableStateDefinition)(relativeId)) == null ? void 0 : _a.write;
          let responsePacket;
          if ((writeDefinition == null ? void 0 : writeDefinition.function) === import_siku_constants.SikuFunction.Write) {
            await this.enqueueNetworkOperation(
              (signal) => (0, import_siku_network.sendWriteOnlyDevicePacket)({
                host: device.host,
                deviceId: device.id,
                password: device.password,
                parameters: [request],
                signal
              })
            );
            if (writeDefinition.verificationParameter === void 0) {
              throw new Error(`W-only state ${relativeId} has no verification parameter`);
            }
            responsePacket = await this.enqueueNetworkOperation(
              (signal) => (0, import_siku_network.readDevicePacket)({
                host: device.host,
                deviceId: device.id,
                password: device.password,
                parameters: [{ parameter: writeDefinition.verificationParameter }],
                signal
              })
            );
          } else {
            responsePacket = await this.enqueueNetworkOperation(
              (signal) => (0, import_siku_network.writeDevicePacket)({
                host: device.host,
                deviceId: device.id,
                password: device.password,
                parameters: [request],
                signal
              })
            );
          }
          await this.applyMappedStateUpdates(device, (0, import_siku_state_mapping.decodeMappedStateResult)(responsePacket).updates);
          await this.applyMappedStateUpdates(device, (0, import_siku_schedule.decodeScheduleUpdates)(responsePacket));
          await this.setStateChangedAsync(`${device.objectId}.diagnostics.lastError`, "", true);
        } finally {
          if (scheduleState) {
            this.releasePendingScheduleWrite(device.id, relativeId, value);
          }
        }
      });
    } finally {
      if (scheduleState && !operationStarted) {
        this.releasePendingScheduleWrite(device.id, relativeId, value);
      }
    }
  }
  /**
   * Performs a network discovery using UDP broadcast, updates matching runtime devices
   * and returns a merged native config payload for the admin UI.
   *
   * @param obj - The original ioBroker message
   */
  async handleDiscoverMessage(obj) {
    var _a, _b, _c, _d;
    const payload = (0, import_siku_message_validation.normalizeDiscoverMessagePayload)((_a = obj.message) != null ? _a : {});
    const configuredBroadcastAddress = (_b = this.config.discoveryBroadcastAddress) == null ? void 0 : _b.trim();
    const broadcastAddress = (_c = payload.broadcastAddress) != null ? _c : configuredBroadcastAddress || import_siku_constants.SIKU_DEFAULT_BROADCAST_ADDRESS;
    const devices = await this.enqueueNetworkOperation(
      (signal) => (0, import_siku_network.discoverDevices)({
        broadcastAddress,
        passwords: (0, import_siku_runtime_safety.getDiscoveryPasswords)(payload.password, this.getConfiguredPasswordRegistry()),
        timeoutMs: payload.timeoutMs,
        preferredBindPort: payload.preferredBindPort,
        signal
      })
    );
    const adminOrigin = (0, import_siku_runtime_safety.isAdminMessageOrigin)(obj.from);
    if (adminOrigin) {
      await this.applyDiscoveryResults(devices);
    }
    const mergedDevices = (0, import_siku_discovery_config.mergeDiscoveredDevicesIntoConfig)(this.config.devices, devices);
    const mergedDevicePasswords = (0, import_siku_discovery_config.mergeDiscoveredDevicePasswordsIntoConfig)(
      this.config.devices,
      this.config.devicePasswords,
      mergedDevices
    );
    const response = {
      ok: true,
      devices
    };
    if (devices.length === 0) {
      response.result = "discoveryNoDevices";
    } else if (JSON.stringify(mergedDevices) !== JSON.stringify((_d = this.config.devices) != null ? _d : []) || JSON.stringify(mergedDevicePasswords) !== JSON.stringify(this.getConfiguredPasswordRegistry())) {
      if (adminOrigin) {
        response.result = "discoveryUpdated";
        response.saveConfig = true;
        response.native = this.buildNativeConfig(mergedDevices, mergedDevicePasswords);
      } else {
        response.result = "discoveryFoundNotSaved";
      }
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
    const payload = (0, import_siku_message_validation.normalizeReadDeviceMessagePayload)(obj.message);
    const packet = await this.enqueueNetworkOperation(
      (signal) => {
        var _a;
        return (0, import_siku_network.readDevicePacket)({
          host: payload.host,
          deviceId: payload.deviceId,
          password: (_a = payload.password) != null ? _a : import_siku_constants.SIKU_DEFAULT_PASSWORD,
          port: payload.port,
          timeoutMs: payload.timeoutMs,
          parameters: this.normalizeReadParameters(payload.parameters),
          signal
        });
      }
    );
    this.sendMessageResponse(obj, { ok: true, packet: this.serializePacket(packet) });
  }
  /**
   * Executes an on-demand time check for all configured devices.
   *
   * @param obj - The original ioBroker message
   */
  async handleSyncTimeAllMessage(obj) {
    const summary = await this.runTimeChecks("manual");
    await this.startTimeCheckScheduler(this.getTimeCheckRetryDelayMs(summary));
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
    await this.startTimeCheckScheduler(this.getTimeCheckRetryDelayMs(summary));
    this.sendMessageResponse(obj, {
      ok: true,
      result: this.getTimeCheckResultCode(summary),
      summary
    });
  }
  /**
   * Returns the normalized dedicated device password registry from the current adapter config.
   */
  getConfiguredPasswordRegistry() {
    return { ...this.runtimePasswordRegistry };
  }
  /**
   * Migrates legacy inline device passwords from `devices[].password` into the dedicated
   * top-level password registry so RepoChecker warnings can be avoided without losing
   * existing credentials on already configured installations.
   */
  async migrateLegacyPasswordConfig() {
    this.unavailablePasswordDeviceIds.clear();
    const currentDevices = Array.isArray(this.config.devices) ? this.config.devices : [];
    const strippedDevices = (0, import_siku_password_config.stripLegacyPasswordsFromDevices)(currentDevices);
    const hadLegacyInlinePasswords = currentDevices.some(
      (device) => typeof device.password === "string" && device.password.trim().length > 0
    );
    const instanceObjectId = `system.adapter.${this.namespace}`;
    const instanceObject = await this.getForeignObjectAsync(instanceObjectId);
    const storedNative = instanceObject == null ? void 0 : instanceObject.native;
    let preparedPasswords;
    try {
      preparedPasswords = (0, import_siku_password_config.prepareStoredDevicePasswords)({
        configuredDevices: currentDevices,
        decryptedRegistry: this.config.devicePasswords,
        storedRegistry: storedNative == null ? void 0 : storedNative.devicePasswords,
        decrypt: (value) => this.decrypt(value),
        encrypt: (value) => this.encrypt(value)
      });
    } catch (error) {
      this.log.warn(`Device passwords could not be migrated automatically: ${error.message}`);
      this.runtimePasswordRegistry = (0, import_siku_password_config.normalizeDevicePasswordRegistry)(this.config.devicePasswords);
      return;
    }
    this.runtimePasswordRegistry = preparedPasswords.runtimeRegistry;
    for (const deviceId of preparedPasswords.invalidDeviceIds) {
      this.unavailablePasswordDeviceIds.add(deviceId);
      this.log.warn(
        `Stored password for device ${deviceId} could not be decrypted. The encrypted value was preserved; configure the password again before controlling this device.`
      );
    }
    const devicesChanged = JSON.stringify(strippedDevices) !== JSON.stringify(currentDevices);
    this.config.devices = strippedDevices;
    this.config.devicePasswords = (0, import_siku_password_config.serializeDevicePasswordRegistry)(this.runtimePasswordRegistry);
    if (!devicesChanged && !preparedPasswords.storageChanged) {
      return;
    }
    if (!instanceObject) {
      this.log.warn("The adapter configuration could not be saved automatically after password migration.");
      return;
    }
    instanceObject.native = {
      ...instanceObject.native,
      ...this.buildNativeConfig(strippedDevices, this.runtimePasswordRegistry),
      devicePasswords: preparedPasswords.storedRegistry
    };
    await this.setForeignObjectAsync(instanceObjectId, instanceObject);
    if (hadLegacyInlinePasswords) {
      this.log.info("Device passwords were migrated to the dedicated encrypted password registry.");
    } else {
      this.log.info("Device password registry was normalized to the new configuration structure.");
    }
  }
  /**
   * Creates the runtime registry from the adapter configuration and prepares the ioBroker object tree.
   */
  async initializeRuntimeDevices() {
    var _a;
    await this.extendObjectAsync("devices", {
      type: "folder",
      common: {
        name: "Ventilation devices"
      },
      native: {}
    });
    this.runtimeDevices.clear();
    this.lastScheduleRefreshMs.clear();
    this.pendingScheduleWrites.clear();
    const passwordRegistry = this.getConfiguredPasswordRegistry();
    for (const [index, configuredDevice] of ((_a = this.config.devices) != null ? _a : []).entries()) {
      try {
        const runtimeDevice = (0, import_siku_runtime.normalizeConfiguredDevice)(
          configuredDevice,
          index,
          passwordRegistry,
          this.unavailablePasswordDeviceIds
        );
        if (this.runtimeDevices.has(runtimeDevice.id)) {
          this.log.warn(
            `Device ${runtimeDevice.id} is configured more than once and will only be used once.`
          );
          continue;
        }
        this.runtimeDevices.set(runtimeDevice.id, runtimeDevice);
        await this.ensureDeviceObjects(runtimeDevice);
        await this.applyConfiguredDeviceMetadata(runtimeDevice, { resetConnectionState: true });
      } catch (error) {
        this.log.warn(`Invalid device configuration at devices[${index}]: ${error.message}`);
      }
    }
    try {
      await this.cleanupOrphanedDeviceObjects();
    } catch (error) {
      this.log.warn(`Stale device object cleanup failed: ${error.message}`);
    }
    if (this.runtimeDevices.size === 0) {
      this.log.info(
        "No valid fans configured. Discovery, readDevice and syncTime remain available through sendTo."
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
    this.clearPollingTimer();
    if (this.runtimeDevices.size === 0) {
      return;
    }
    const intervalMs = (0, import_siku_timer.getPollIntervalMs)(this.config.pollIntervalSec);
    this.pollIntervalHandle = this.setInterval(() => {
      this.pollDevices("interval").catch((error) => {
        this.log.error(`Error during interval polling: ${error.message}`);
      });
    }, intervalMs);
    this.log.debug(`Polling scheduled every ${intervalMs} ms`);
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
   *
   * @param minimumDelayMs - Optional backoff floor for busy or failed scheduler runs
   */
  async startTimeCheckScheduler(minimumDelayMs = 0) {
    this.clearTimeCheckTimer();
    if (this.unloading) {
      return;
    }
    const enabledDevices = Array.from(this.runtimeDevices.values()).filter((device) => device.enabled);
    if (enabledDevices.length === 0) {
      return;
    }
    const intervalMs = (0, import_siku_timer.getTimeCheckIntervalMs)(this.config.timeCheckIntervalHours);
    const persistedChecks = await Promise.all(
      enabledDevices.map(async (device) => {
        const state = await this.getStateAsync(`${device.objectId}.diagnostics.lastTimeCheck`);
        return typeof (state == null ? void 0 : state.val) === "string" ? state.val : null;
      })
    );
    const delayMs = (0, import_siku_time_scheduler.getNextTimeCheckDelayMs)(/* @__PURE__ */ new Date(), persistedChecks, intervalMs, minimumDelayMs);
    this.timeCheckTimeoutHandle = this.setTimeout(() => {
      this.timeCheckTimeoutHandle = void 0;
      void this.executeScheduledTimeCheck();
    }, delayMs);
    this.log.debug(`Next time check scheduled in ${delayMs} ms`);
  }
  async executeScheduledTimeCheck() {
    let retryDelayMs = 0;
    try {
      const summary = await this.runTimeChecks("interval");
      retryDelayMs = this.getTimeCheckRetryDelayMs(summary);
    } catch (error) {
      this.log.error(`Error during interval time check: ${error.message}`);
      retryDelayMs = import_siku_constants.SIKU_TIME_CHECK_BUSY_RETRY_MS;
    } finally {
      await this.startTimeCheckScheduler(retryDelayMs);
    }
  }
  /**
   * Stops the recurring time check timer if it is currently active.
   */
  clearTimeCheckTimer() {
    if (this.timeCheckTimeoutHandle) {
      this.clearTimeout(this.timeCheckTimeoutHandle);
      this.timeCheckTimeoutHandle = void 0;
    }
  }
  /**
   * Applies the same bounded retry delay to busy and failed RTC runs. This also
   * prevents a missing persisted timestamp from creating a zero-delay error loop.
   *
   * @param summary - Result of the latest RTC check run
   */
  getTimeCheckRetryDelayMs(summary) {
    return summary.skippedBecauseBusy || summary.failed > 0 ? import_siku_constants.SIKU_TIME_CHECK_BUSY_RETRY_MS : 0;
  }
  /**
   * Polls all configured devices sequentially and updates the adapter-wide connection state.
   *
   * @param trigger - Human-readable trigger source for debug logging
   */
  async pollDevices(trigger) {
    if (this.unloading) {
      return;
    }
    if (this.pollCycleRunning) {
      this.log.debug(`Polling (${trigger}) skipped because another cycle is already running.`);
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
    if (this.unloading) {
      return false;
    }
    const pollStartedAt = /* @__PURE__ */ new Date();
    const pollStartedAtIso = pollStartedAt.toISOString();
    const pollStartedMs = Date.now();
    const prefix = device.objectId;
    const refreshSchedule = (0, import_siku_schedule.shouldRefreshSchedule)(trigger, this.lastScheduleRefreshMs.get(device.id), Date.now());
    const basePollParameters = Array.from(/* @__PURE__ */ new Set([...import_siku_constants.SIKU_RUNTIME_POLL_PARAMETERS, ...import_siku_state_mapping.SIKU_POLL_PARAMETERS])).map(
      (parameter) => ({ parameter })
    );
    if (!device.enabled) {
      await this.setStateChangedAsync(`${prefix}.info.connection`, false, true);
      return false;
    }
    await this.setTimestampStatePair(`${prefix}.info.lastPoll`, pollStartedAtIso);
    try {
      const { basePacket, schedulePackets, scheduleReadError } = await this.enqueueDeviceOperation(
        device.id,
        async () => {
          const basePacket2 = await this.enqueueNetworkOperation(
            (signal) => (0, import_siku_network.readDevicePacket)({
              host: device.host,
              deviceId: device.id,
              password: device.password,
              parameters: basePollParameters,
              signal
            })
          );
          const schedulePackets2 = [];
          let scheduleReadError2;
          if (refreshSchedule) {
            try {
              schedulePackets2.push(
                ...await (0, import_siku_schedule.readCompleteSchedulePackets)(
                  (parameters) => this.enqueueNetworkOperation(
                    (signal) => (0, import_siku_network.readDevicePacket)({
                      host: device.host,
                      deviceId: device.id,
                      password: device.password,
                      parameters,
                      signal
                    })
                  )
                )
              );
            } catch (error) {
              scheduleReadError2 = error.message;
            }
          }
          return {
            basePacket: basePacket2,
            schedulePackets: schedulePackets2,
            scheduleReadError: scheduleReadError2
          };
        }
      );
      const snapshot = (0, import_siku_runtime.decodePollSnapshot)(device.id, basePacket, pollStartedAt);
      const mappedResult = (0, import_siku_state_mapping.decodeMappedStateResult)(basePacket);
      await this.applyPollSnapshot(device, snapshot, pollStartedAtIso, Date.now() - pollStartedMs);
      await this.applyMappedStateUpdates(device, mappedResult.updates);
      for (const schedulePacket of schedulePackets) {
        await this.applyMappedStateUpdates(device, (0, import_siku_schedule.decodeScheduleUpdates)(schedulePacket));
      }
      if (refreshSchedule && !scheduleReadError) {
        const refreshedAtIso = (/* @__PURE__ */ new Date()).toISOString();
        this.lastScheduleRefreshMs.set(device.id, Date.now());
        await this.setTimestampStatePair(`${prefix}.diagnostics.lastScheduleRead`, refreshedAtIso);
      }
      const decodeError = mappedResult.errors.length ? `Decode: ${mappedResult.errors.map((error) => `${error.relativeId}: ${error.message}`).join("; ")}` : "";
      const lastError = [scheduleReadError ? `Schedule read: ${scheduleReadError}` : "", decodeError].filter(Boolean).join(" | ");
      await this.setStateChangedAsync(
        `${prefix}.diagnostics.lastError`,
        this.limitDiagnosticError(lastError),
        true
      );
      if (scheduleReadError) {
        this.log.warn(
          `Schedule read failed for ${device.name} (${device.id}) via ${device.host}: ${scheduleReadError}`
        );
      }
      if (mappedResult.errors.length) {
        this.log.warn(
          `Ignored ${mappedResult.errors.length} malformed parameter value(s) from ${device.name} (${device.id}): ${mappedResult.errors.map((error) => error.relativeId).join(", ")}`
        );
      }
      this.log.debug(`Polling succeeded for ${device.name} (${device.id}) via ${device.host} [${trigger}]`);
      return true;
    } catch (error) {
      const message = error.message;
      if (this.unloading) {
        return false;
      }
      await this.setStateChangedAsync(`${prefix}.info.connection`, false, true);
      await this.setStateChangedAsync(
        `${prefix}.diagnostics.lastError`,
        this.limitDiagnosticError(message),
        true
      );
      await this.setStateChangedAsync(`${prefix}.diagnostics.pollDurationMs`, Date.now() - pollStartedMs, true);
      this.log.warn(`Polling failed for ${device.name} (${device.id}) via ${device.host}: ${message}`);
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
    if (this.unloading) {
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
    if (this.timeCheckRunning) {
      this.log.debug(`Time check (${trigger}) skipped because another cycle is already running.`);
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
    const checkedAt = /* @__PURE__ */ new Date();
    const checkedAtIso = checkedAt.toISOString();
    const prefix = device.objectId;
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
      await this.setTimestampStatePair(`${prefix}.diagnostics.lastTimeCheck`, checkedAtIso);
      const packet = await this.enqueueDeviceOperation(
        device.id,
        async () => this.enqueueNetworkOperation(
          (signal) => (0, import_siku_network.readDevicePacket)({
            host: device.host,
            deviceId: device.id,
            password: device.password,
            parameters: import_siku_constants.SIKU_TIME_CHECK_PARAMETERS.map((parameter) => ({ parameter })),
            signal
          })
        )
      );
      const rtcSnapshot = (0, import_siku_time.decodeRtcSnapshot)(packet);
      const referenceTime = /* @__PURE__ */ new Date();
      const driftSec = (0, import_siku_time.calculateClockDriftSeconds)(rtcSnapshot.deviceDate, referenceTime);
      await this.setStateChangedAsync(`${prefix}.diagnostics.clockDriftSec`, driftSec, true);
      await this.setStateChangedAsync(`${prefix}.diagnostics.lastError`, "", true);
      this.log.debug(
        `Time check ${device.name} (${device.id}) [${trigger}]: drift ${driftSec}s against ${referenceTime.toISOString()}`
      );
      if (Math.abs(driftSec) <= (0, import_siku_timer.getTimeSyncThresholdSec)(this.config.timeSyncThresholdSec)) {
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
        async () => this.enqueueNetworkOperation(
          (signal) => (0, import_siku_network.writeDevicePacket)({
            host: device.host,
            deviceId: device.id,
            password: device.password,
            parameters: [
              { parameter: import_siku_constants.SIKU_PARAMETER_RTC_TIME, value: (0, import_siku_time.encodeRtcTime)(syncDate) },
              { parameter: import_siku_constants.SIKU_PARAMETER_RTC_CALENDAR, value: (0, import_siku_time.encodeRtcCalendar)(syncDate) }
            ],
            signal
          })
        )
      );
      const syncedAtIso = syncDate.toISOString();
      await this.setTimestampStatePair(`${prefix}.diagnostics.lastTimeSync`, syncedAtIso);
      this.log.info(
        `Corrected time of ${device.name} (${device.id}) by ${driftSec}s (${device.host}, ${syncedAtIso})`
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
      if (!this.unloading) {
        await this.setStateChangedAsync(
          `${prefix}.diagnostics.lastError`,
          this.limitDiagnosticError(`Time check: ${message}`),
          true
        );
      }
      this.log.warn(`Time check failed for ${device.name} (${device.id}) via ${device.host}: ${message}`);
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
   * @param devicePasswords - Updated password registry to send back to the admin UI
   */
  buildNativeConfig(devices, devicePasswords = this.getConfiguredPasswordRegistry()) {
    return {
      pollIntervalSec: this.config.pollIntervalSec,
      discoveryBroadcastAddress: this.config.discoveryBroadcastAddress,
      timeCheckIntervalHours: this.config.timeCheckIntervalHours,
      timeSyncThresholdSec: this.config.timeSyncThresholdSec,
      devices,
      devicePasswords: (0, import_siku_password_config.serializeDevicePasswordRegistry)(devicePasswords)
    };
  }
  /**
   * Keeps all diagnostic error state writes within one predictable size limit.
   *
   * @param message - Raw error summary
   */
  limitDiagnosticError(message) {
    return message.slice(0, import_siku_constants.SIKU_DIAGNOSTIC_ERROR_MAX_LENGTH);
  }
  /**
   * Writes one ISO timestamp state plus a localized companion state that uses the host's
   * active locale/timezone formatting for easier reading in Admin and VIS.
   *
   * @param stateId - Base state id that stores the ISO/UTC timestamp
   * @param value - ISO timestamp value
   */
  async setTimestampStatePair(stateId, value) {
    if (this.unloading) {
      return;
    }
    await this.setStateChangedAsync(stateId, value, true);
    if (this.unloading) {
      return;
    }
    await this.setStateChangedAsync(
      `${stateId}Local`,
      value ? (0, import_siku_display.formatLocalTimestamp)(value, this.language) : "",
      true
    );
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
      await this.setTimestampStatePair(`${prefix}.info.lastSeen`, device.lastSeen);
      await this.setTimestampStatePair(`${prefix}.diagnostics.lastDiscovery`, device.lastSeen);
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
    if (this.unloading) {
      return;
    }
    const prefix = device.objectId;
    await this.setStateChangedAsync(`${prefix}.info.connection`, true, true);
    await this.setTimestampStatePair(`${prefix}.info.lastSeen`, snapshot.lastSeen);
    await this.setTimestampStatePair(`${prefix}.diagnostics.lastSuccessfulPoll`, pollStartedAtIso);
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
      if (this.unloading) {
        return;
      }
      const fullStateId = `${device.objectId}.${update.relativeId}`;
      const previousState = update.relativeId === "control.timerMode" ? await this.getStateAsync(fullStateId) : void 0;
      const previousTimerModeTimestamp = update.relativeId === "control.timerMode" ? await this.getStateAsync(`${device.objectId}.timers.timerModeChangedAt`) : void 0;
      await this.setStateChangedAsync(fullStateId, update.value, true);
      const localizedModeLabel = (0, import_siku_display.getLocalizedModeLabel)(update.relativeId, update.value, this.language);
      if (localizedModeLabel !== void 0) {
        await this.setStateChangedAsync(`${fullStateId}Text`, localizedModeLabel, true);
      }
      if (update.relativeId === "control.timerMode" && ((previousState == null ? void 0 : previousState.val) !== update.value || !(previousTimerModeTimestamp == null ? void 0 : previousTimerModeTimestamp.val))) {
        await this.setTimestampStatePair(
          `${device.objectId}.timers.timerModeChangedAt`,
          (/* @__PURE__ */ new Date()).toISOString()
        );
      }
    }
  }
  /**
   * Creates the checker-compatible object tree for one configured device.
   *
   * @param device - Normalized device whose object hierarchy should be created
   */
  async ensureDeviceObjects(device) {
    await (0, import_siku_objects.ensureSikuDeviceObjects)(this, device, this.language);
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
   * Tracks a schedule value only while its state-change event is queued or in flight.
   * This lets adjacent UI edits be coalesced without trusting stale unacknowledged states.
   *
   * @param deviceId - Device queue key
   * @param relativeId - Relative schedule state id
   * @param value - Latest user-provided value
   */
  registerPendingScheduleWrite(deviceId, relativeId, value) {
    var _a;
    const deviceWrites = (_a = this.pendingScheduleWrites.get(deviceId)) != null ? _a : /* @__PURE__ */ new Map();
    deviceWrites.set(relativeId, value);
    this.pendingScheduleWrites.set(deviceId, deviceWrites);
  }
  getPendingScheduleWrite(deviceId, relativeId) {
    var _a;
    return (_a = this.pendingScheduleWrites.get(deviceId)) == null ? void 0 : _a.get(relativeId);
  }
  /**
   * Removes only the completed generation of a pending write. A newer write to the
   * same state may already be queued and must remain visible to the next operation.
   *
   * @param deviceId - Device queue key
   * @param relativeId - Relative schedule state id
   * @param completedValue - Value belonging to the completed queue operation
   */
  releasePendingScheduleWrite(deviceId, relativeId, completedValue) {
    const deviceWrites = this.pendingScheduleWrites.get(deviceId);
    if (!deviceWrites || !Object.is(deviceWrites.get(relativeId), completedValue)) {
      return;
    }
    deviceWrites.delete(relativeId);
    if (deviceWrites.size === 0) {
      this.pendingScheduleWrites.delete(deviceId);
    }
  }
  /**
   * Builds a complete schedule write request by combining the changed state with the
   * current sibling states of the same weekday/period snapshot.
   *
   * @param deviceId - Device id used to correlate actively pending UI writes
   * @param fullStateId - Full ioBroker id of the changed state
   * @param relativeId - Relative schedule state id
   * @param value - New user-provided value
   */
  async buildScheduleWriteRequestForState(deviceId, fullStateId, relativeId, value) {
    const snapshotStates = [];
    const namespacePrefix = `${this.namespace}.`;
    const relativeNamespaceId = fullStateId.startsWith(namespacePrefix) ? fullStateId.slice(namespacePrefix.length) : fullStateId;
    for (const snapshotRelativeId of (0, import_siku_schedule.getScheduleSnapshotStateIds)(relativeId)) {
      const snapshotStateId = relativeNamespaceId.replace(relativeId, snapshotRelativeId);
      const state = await this.getStateAsync(snapshotStateId);
      if ((state == null ? void 0 : state.val) === void 0 || state.val === null) {
        throw new Error(
          `Schedule write aborted: snapshot state "${this.namespace}.${snapshotStateId}" is missing or has no value.`
        );
      }
      const pendingValue = this.getPendingScheduleWrite(deviceId, snapshotRelativeId);
      snapshotStates.push({
        relativeId: snapshotRelativeId,
        value: pendingValue != null ? pendingValue : state.val,
        acknowledged: state.ack,
        pending: pendingValue !== void 0
      });
    }
    return (0, import_siku_schedule.buildScheduleWriteRequestFromSnapshot)(relativeId, value, snapshotStates);
  }
  /**
   * Re-reads the weekly schedule after a failed write so unacknowledged UI values
   * cannot leak into a later full-period write.
   *
   * @param device - Device whose schedule should be restored from hardware
   */
  async refreshScheduleAfterWriteFailure(device) {
    if (this.unloading) {
      return;
    }
    try {
      const packets = await this.enqueueDeviceOperation(
        device.id,
        async () => (0, import_siku_schedule.readCompleteSchedulePackets)(
          (parameters) => this.enqueueNetworkOperation(
            (signal) => (0, import_siku_network.readDevicePacket)({
              host: device.host,
              deviceId: device.id,
              password: device.password,
              parameters,
              signal
            })
          )
        )
      );
      for (const packet of packets) {
        await this.applyMappedStateUpdates(device, (0, import_siku_schedule.decodeScheduleUpdates)(packet));
      }
      this.lastScheduleRefreshMs.set(device.id, Date.now());
      await this.setTimestampStatePair(
        `${device.objectId}.diagnostics.lastScheduleRead`,
        (/* @__PURE__ */ new Date()).toISOString()
      );
    } catch (error) {
      this.log.debug(
        `Schedule resync after failed write also failed for ${device.id}: ${error.message}`
      );
    }
  }
  /**
   * Removes stale adapter-owned device roots after a device was deleted from native config.
   */
  async cleanupOrphanedDeviceObjects() {
    if (!Array.isArray(this.config.devices)) {
      return;
    }
    const configuredDeviceIds = new Set(
      this.config.devices.map((device) => (0, import_siku_password_config.normalizeDevicePasswordRegistryKey)(device.id)).filter((deviceId) => deviceId !== null)
    );
    if (configuredDeviceIds.size === 0) {
      return;
    }
    const adapterObjects = await this.getAdapterObjectsAsync();
    for (const objectId of (0, import_siku_runtime_safety.findOrphanedDeviceObjectIds)(this.namespace, adapterObjects, configuredDeviceIds)) {
      if ((0, import_siku_runtime_safety.deviceObjectTreeHasCustomBindings)(this.namespace, objectId, adapterObjects)) {
        this.log.warn(`Preserved stale object tree ${objectId} because it contains custom bindings.`);
        continue;
      }
      await this.delObjectAsync(objectId, { recursive: true });
      this.log.warn(`Removed stale object tree ${objectId}`);
    }
  }
  /**
   * Serializes operations per device to avoid overlapping reads and writes on the same UDP target.
   *
   * @param deviceId - Device queue key
   * @param operation - Async operation that should run exclusively for the device
   */
  async enqueueDeviceOperation(deviceId, operation) {
    return this.operationCoordinator.enqueueDevice(deviceId, operation);
  }
  /**
   * Serializes UDP socket usage globally because the SIKU devices answer request traffic
   * reliably only on the shared well-known local port 4000.
   *
   * @param operation - Async network operation that should use the shared UDP slot
   */
  async enqueueNetworkOperation(operation) {
    if (this.unloading || this.shutdownController.signal.aborted) {
      const error = new Error("Adapter is shutting down");
      error.name = "AbortError";
      throw error;
    }
    return this.operationCoordinator.enqueueNetwork(async () => {
      if (this.shutdownController.signal.aborted) {
        const error = new Error("Adapter is shutting down");
        error.name = "AbortError";
        throw error;
      }
      return operation(this.shutdownController.signal);
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
    const passwordRegistryEntries = Object.keys(this.getConfiguredPasswordRegistry()).length;
    this.log.debug(
      `Configuration: ${JSON.stringify({
        pollIntervalSec: this.config.pollIntervalSec,
        discoveryBroadcastAddress: this.config.discoveryBroadcastAddress,
        timeCheckIntervalHours: this.config.timeCheckIntervalHours,
        timeSyncThresholdSec: this.config.timeSyncThresholdSec,
        configuredDevices: devices.length,
        enabledDevices,
        passwordRegistryEntries
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
