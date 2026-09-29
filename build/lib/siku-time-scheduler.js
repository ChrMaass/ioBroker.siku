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
var siku_time_scheduler_exports = {};
__export(siku_time_scheduler_exports, {
  getNextTimeCheckDelayMs: () => getNextTimeCheckDelayMs
});
module.exports = __toCommonJS(siku_time_scheduler_exports);
function getNextTimeCheckDelayMs(now, lastCheckTimestamps, intervalMs, minimumDelayMs = 0) {
  if (lastCheckTimestamps.length === 0) {
    return Math.max(intervalMs, minimumDelayMs);
  }
  let shortestDelay = intervalMs;
  for (const timestamp of lastCheckTimestamps) {
    if (!timestamp) {
      return minimumDelayMs;
    }
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return minimumDelayMs;
    }
    const elapsedMs = Math.max(now.getTime() - parsed.getTime(), 0);
    if (elapsedMs >= intervalMs) {
      return minimumDelayMs;
    }
    shortestDelay = Math.min(shortestDelay, intervalMs - elapsedMs);
  }
  return Math.max(shortestDelay, minimumDelayMs);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getNextTimeCheckDelayMs
});
//# sourceMappingURL=siku-time-scheduler.js.map
