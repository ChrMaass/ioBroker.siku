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
  isDiscoverySelfEcho: () => isDiscoverySelfEcho,
  parseDiscoveryResponse: () => parseDiscoveryResponse,
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
  return new Promise((resolve, reject) => {
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
}
function isDiscoverySelfEcho(message, remoteInfo, localAddresses, boundPort, discoveryPacket) {
  if (message.equals(discoveryPacket)) {
    return true;
  }
  return localAddresses.has(remoteInfo.address) && remoteInfo.port === boundPort;
}
function parseDiscoveryResponse(message, remoteInfo, receivedAt = /* @__PURE__ */ new Date()) {
  var _a;
  let parsed;
  try {
    parsed = (0, import_siku_protocol.parsePacket)(message);
  } catch {
    return null;
  }
  if (!parsed.checksumValid || parsed.functionCode !== import_siku_constants.SikuFunction.Response) {
    return null;
  }
  const idEntry = parsed.entries.find((entry) => entry.parameter === import_siku_constants.SIKU_PARAMETER_DEVICE_ID && !entry.unsupported);
  const deviceTypeEntry = parsed.entries.find(
    (entry) => entry.parameter === import_siku_constants.SIKU_PARAMETER_DEVICE_TYPE && !entry.unsupported
  );
  const deviceId = (0, import_siku_protocol.decodeAscii)((_a = idEntry == null ? void 0 : idEntry.value) != null ? _a : parsed.deviceIdBytes);
  if (!deviceId) {
    return null;
  }
  return {
    host: remoteInfo.address,
    port: remoteInfo.port,
    deviceId,
    deviceTypeCode: deviceTypeEntry ? (0, import_siku_protocol.decodeUnsignedLE)(deviceTypeEntry.value) : null,
    deviceTypeHex: deviceTypeEntry ? (0, import_siku_protocol.toHex)(deviceTypeEntry.value) : null,
    receivedAt: receivedAt.toISOString()
  };
}
async function readDevicePacket(options, dependencies = {}) {
  var _a, _b, _c, _d, _e;
  const payload = (0, import_siku_protocol.buildReadPacket)(options.deviceId, options.password, options.parameters);
  const retryDelays = (_a = options.retryDelaysMs) != null ? _a : import_siku_constants.SIKU_REQUEST_RETRY_DELAYS_MS;
  const request = (_b = dependencies.requestOnce) != null ? _b : requestOnce;
  const wait = (_c = dependencies.delay) != null ? _c : import_promises.setTimeout;
  let lastError;
  for (const retryDelay of retryDelays) {
    try {
      if (retryDelay > 0) {
        await wait(retryDelay);
      }
      const response = await request(
        options.host,
        (_d = options.port) != null ? _d : import_siku_constants.SIKU_DEFAULT_PORT,
        payload,
        (_e = options.timeoutMs) != null ? _e : import_siku_constants.SIKU_REQUEST_TIMEOUT_MS
      );
      const parsed = (0, import_siku_protocol.parsePacket)(response);
      if (!parsed.checksumValid) {
        throw new Error(`Invalid checksum in response from ${options.host}`);
      }
      if (parsed.functionCode !== import_siku_constants.SikuFunction.Response) {
        throw new Error(
          `Unexpected function code 0x${parsed.functionCode.toString(16).padStart(2, "0")} in response from ${options.host}`
        );
      }
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError != null ? lastError : new Error(`Unable to read from ${options.host}`);
}
async function discoverDevices(options, dependencies = {}) {
  var _a, _b, _c, _d, _e, _f, _g;
  const bind = (_a = dependencies.bindSocketWithFallback) != null ? _a : bindSocketWithFallback;
  const wait = (_b = dependencies.delay) != null ? _b : import_promises.setTimeout;
  const now = (_c = dependencies.now) != null ? _c : (() => /* @__PURE__ */ new Date());
  const localAddresses = ((_d = dependencies.getLocalIPv4Addresses) != null ? _d : getLocalIPv4Addresses)();
  const socket = await bind((_e = options.preferredBindPort) != null ? _e : import_siku_constants.SIKU_DEFAULT_PORT);
  const discoveryPacket = (0, import_siku_protocol.buildDiscoveryPacket)((_f = options.password) != null ? _f : import_siku_constants.SIKU_DEFAULT_PASSWORD);
  try {
    socket.setBroadcast(true);
    const devices = /* @__PURE__ */ new Map();
    socket.on("message", (message, remoteInfo) => {
      if (isDiscoverySelfEcho(message, remoteInfo, localAddresses, socket.address().port, discoveryPacket)) {
        return;
      }
      try {
        const device = parseDiscoveryResponse(message, remoteInfo, now());
        if (!device) {
          return;
        }
        devices.set(device.deviceId, device);
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
    await wait((_g = options.timeoutMs) != null ? _g : import_siku_constants.SIKU_DISCOVERY_TIMEOUT_MS);
    return Array.from(devices.values()).sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  } finally {
    socket.close();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  discoverDevices,
  isDiscoverySelfEcho,
  parseDiscoveryResponse,
  readDevicePacket
});
//# sourceMappingURL=siku-network.js.map
