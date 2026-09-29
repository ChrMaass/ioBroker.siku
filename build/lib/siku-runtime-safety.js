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
var siku_runtime_safety_exports = {};
__export(siku_runtime_safety_exports, {
  deviceObjectTreeHasCustomBindings: () => deviceObjectTreeHasCustomBindings,
  findOrphanedDeviceObjectIds: () => findOrphanedDeviceObjectIds,
  getDiscoveryPasswords: () => getDiscoveryPasswords,
  isAdminMessageOrigin: () => isAdminMessageOrigin
});
module.exports = __toCommonJS(siku_runtime_safety_exports);
var import_siku_constants = require("./siku-constants");
function findOrphanedDeviceObjectIds(namespace, objects, configuredDeviceIds) {
  const escapedNamespace = namespace.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const deviceRootPattern = new RegExp(`^${escapedNamespace}\\.devices\\.([A-F0-9]{${import_siku_constants.SIKU_DEVICE_ID_LENGTH}})$`, "u");
  const orphanedRoots = [];
  for (const [objectId, object] of Object.entries(objects)) {
    const match = deviceRootPattern.exec(objectId);
    if (match && object.type === "device" && !configuredDeviceIds.has(match[1])) {
      orphanedRoots.push(`devices.${match[1]}`);
    }
  }
  return orphanedRoots.sort();
}
function getDiscoveryPasswords(explicitPassword, registry) {
  if (explicitPassword) {
    return [explicitPassword];
  }
  return Array.from(/* @__PURE__ */ new Set([import_siku_constants.SIKU_DEFAULT_PASSWORD, ...Object.values(registry)])).slice(
    0,
    import_siku_constants.SIKU_DISCOVERY_MAX_PASSWORDS
  );
}
function deviceObjectTreeHasCustomBindings(namespace, relativeDeviceRoot, objects) {
  const fullRoot = `${namespace}.${relativeDeviceRoot}`;
  return Object.entries(objects).some(([objectId, object]) => {
    var _a;
    if (objectId !== fullRoot && !objectId.startsWith(`${fullRoot}.`)) {
      return false;
    }
    const custom = (_a = object.common) == null ? void 0 : _a.custom;
    return typeof custom === "object" && custom !== null && Object.keys(custom).length > 0;
  });
}
function isAdminMessageOrigin(from) {
  return typeof from === "string" && /^system\.adapter\.admin\.\d+$/u.test(from);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  deviceObjectTreeHasCustomBindings,
  findOrphanedDeviceObjectIds,
  getDiscoveryPasswords,
  isAdminMessageOrigin
});
//# sourceMappingURL=siku-runtime-safety.js.map
