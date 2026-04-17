"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var siku_network_exports = {};
__export(siku_network_exports, {
  discoverDevices: () => discoverDevices,
  readDevicePacket: () => readDevicePacket
});
module.exports = __toCommonJS(siku_network_exports);
var import_node_dgram = __toESM(require("node:dgram"));
var import_node_os = require("node:os");
var import_promises = require("node:timers/promises");
var import_siku_constants = require("./siku-constants");
var import_siku_protocol = require("./siku-protocol");
function getLocalIPv4Addresses() {
  const interfaces = (0, import_node_os.networkInterfaces)();
  const localAddresses = /* @__PURE__ */ new Set();
  for (const interfaceEntries of Object.values(interfaces)) {
    for (const entry of interfaceEntries != null ? interfaceEntries : []) {
      if (entry.family === "IPv4") {
        localAddresses.add(entry.address);
      }
    }
  }
  return localAddresses;
}
async function bindSocketWithFallback(preferredPort) {
  const portsToTry = preferredPort === 0 ? [0] : [preferredPort, 0];
  for (const port of portsToTry) {
    const socket = import_node_dgram.default.createSocket({ type: "udp4", reuseAddr: true });
    try {
      await new Promise((resolve, reject) => {
        function onListening() {
          socket.off("error", onError);
          resolve();
        }
        function onError(error) {
          socket.off("listening", onListening);
          reject(error);
        }
        socket.once("error", onError);
        socket.once("listening", onListening);
        socket.bind(port);
      });
      return socket;
    } catch {
      socket.close();
      if (port === 0) {
        throw new Error("Unable to bind UDP socket for discovery");
      }
    }
  }
  throw new Error("Unable to bind UDP socket for discovery");
}
async function requestOnce(host, port, payload, timeoutMs) {
  const socket = import_node_dgram.default.createSocket("udp4");
  try {
    return await new Promise((resolve, reject) => {
      let finished = false;
      let timeoutHandle;
      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        socket.removeAllListeners();
        socket.close();
      };
      const finish = (error, response) => {
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        if (error) {
          reject(error);
        } else if (response) {
          resolve(response);
        } else {
          reject(new Error("No response received"));
        }
      };
      socket.on("error", finish);
      socket.on("message", (message, remoteInfo) => {
        if (remoteInfo.address === host && remoteInfo.port === port) {
          finish(void 0, message);
        }
      });
      socket.bind(0, () => {
        socket.send(payload, port, host, (error) => {
          if (error) {
            finish(error);
            return;
          }
          timeoutHandle = setTimeout(() => {
            finish(new Error(`UDP request to ${host}:${port} timed out after ${timeoutMs} ms`));
          }, timeoutMs);
        });
      });
    });
  } catch (error) {
    socket.close();
    throw error;
  }
}
async function readDevicePacket(options) {
  var _a, _b, _c;
  const payload = (0, import_siku_protocol.buildReadPacket)(options.deviceId, options.password, options.parameters);
  const retryDelays = (_a = options.retryDelaysMs) != null ? _a : import_siku_constants.SIKU_REQUEST_RETRY_DELAYS_MS;
  let lastError;
  for (const retryDelay of retryDelays) {
    try {
      if (retryDelay > 0) {
        await (0, import_promises.setTimeout)(retryDelay);
      }
      const response = await requestOnce(
        options.host,
        (_b = options.port) != null ? _b : import_siku_constants.SIKU_DEFAULT_PORT,
        payload,
        (_c = options.timeoutMs) != null ? _c : import_siku_constants.SIKU_REQUEST_TIMEOUT_MS
      );
      return (0, import_siku_protocol.parsePacket)(response);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError != null ? lastError : new Error(`Unable to read from ${options.host}`);
}
async function discoverDevices(options) {
  var _a, _b, _c;
  const socket = await bindSocketWithFallback((_a = options.preferredBindPort) != null ? _a : import_siku_constants.SIKU_DEFAULT_PORT);
  const discoveryPacket = (0, import_siku_protocol.buildDiscoveryPacket)((_b = options.password) != null ? _b : import_siku_constants.SIKU_DEFAULT_PASSWORD);
  const localAddresses = getLocalIPv4Addresses();
  try {
    socket.setBroadcast(true);
    const devices = /* @__PURE__ */ new Map();
    socket.on("message", (message, remoteInfo) => {
      var _a2;
      if (message.equals(discoveryPacket)) {
        return;
      }
      if (localAddresses.has(remoteInfo.address) && remoteInfo.port === socket.address().port) {
        return;
      }
      try {
        const parsed = (0, import_siku_protocol.parsePacket)(message);
        const idEntry = parsed.entries.find(
          (entry) => entry.parameter === import_siku_constants.SIKU_PARAMETER_DEVICE_ID && !entry.unsupported
        );
        const deviceTypeEntry = parsed.entries.find(
          (entry) => entry.parameter === import_siku_constants.SIKU_PARAMETER_DEVICE_TYPE && !entry.unsupported
        );
        const deviceId = (0, import_siku_protocol.decodeAscii)((_a2 = idEntry == null ? void 0 : idEntry.value) != null ? _a2 : parsed.deviceIdBytes);
        if (!deviceId) {
          return;
        }
        devices.set(deviceId, {
          host: remoteInfo.address,
          port: remoteInfo.port,
          deviceId,
          deviceTypeCode: deviceTypeEntry ? (0, import_siku_protocol.decodeUnsignedLE)(deviceTypeEntry.value) : null,
          deviceTypeHex: deviceTypeEntry ? (0, import_siku_protocol.toHex)(deviceTypeEntry.value) : null,
          receivedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch {
      }
    });
    await new Promise((resolve, reject) => {
      var _a2;
      socket.send(
        discoveryPacket,
        (_a2 = options.port) != null ? _a2 : import_siku_constants.SIKU_DEFAULT_PORT,
        options.broadcastAddress,
        (error) => error ? reject(error) : resolve()
      );
    });
    await (0, import_promises.setTimeout)((_c = options.timeoutMs) != null ? _c : import_siku_constants.SIKU_DISCOVERY_TIMEOUT_MS);
    return Array.from(devices.values()).sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  } finally {
    socket.close();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  discoverDevices,
  readDevicePacket
});
//# sourceMappingURL=siku-network.js.map
