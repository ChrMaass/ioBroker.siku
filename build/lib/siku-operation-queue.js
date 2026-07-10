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
var siku_operation_queue_exports = {};
__export(siku_operation_queue_exports, {
  SikuOperationCoordinator: () => SikuOperationCoordinator
});
module.exports = __toCommonJS(siku_operation_queue_exports);
class SikuOperationCoordinator {
  deviceQueues = /* @__PURE__ */ new Map();
  networkQueue = Promise.resolve();
  async enqueueDevice(deviceId, operation) {
    var _a;
    const previous = (_a = this.deviceQueues.get(deviceId)) != null ? _a : Promise.resolve();
    const next = previous.catch(() => void 0).then(operation);
    const tracked = next.then(
      () => void 0,
      () => void 0
    );
    this.deviceQueues.set(deviceId, tracked);
    void tracked.finally(() => {
      if (this.deviceQueues.get(deviceId) === tracked) {
        this.deviceQueues.delete(deviceId);
      }
    });
    return next;
  }
  async enqueueNetwork(operation) {
    const previous = this.networkQueue;
    const next = previous.catch(() => void 0).then(operation);
    const tracked = next.then(
      () => void 0,
      () => void 0
    );
    this.networkQueue = tracked;
    void tracked.finally(() => {
      if (this.networkQueue === tracked) {
        this.networkQueue = Promise.resolve();
      }
    });
    return next;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SikuOperationCoordinator
});
//# sourceMappingURL=siku-operation-queue.js.map
