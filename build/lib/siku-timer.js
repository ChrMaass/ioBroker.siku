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
var siku_timer_exports = {};
__export(siku_timer_exports, {
  SIKU_DEFAULT_POLL_INTERVAL_SEC: () => SIKU_DEFAULT_POLL_INTERVAL_SEC,
  SIKU_DEFAULT_TIME_CHECK_INTERVAL_HOURS: () => SIKU_DEFAULT_TIME_CHECK_INTERVAL_HOURS,
  SIKU_DEFAULT_TIME_SYNC_THRESHOLD_SEC: () => SIKU_DEFAULT_TIME_SYNC_THRESHOLD_SEC,
  SIKU_MAX_POLL_INTERVAL_SEC: () => SIKU_MAX_POLL_INTERVAL_SEC,
  SIKU_MAX_TIME_CHECK_INTERVAL_HOURS: () => SIKU_MAX_TIME_CHECK_INTERVAL_HOURS,
  SIKU_MAX_TIME_SYNC_THRESHOLD_SEC: () => SIKU_MAX_TIME_SYNC_THRESHOLD_SEC,
  SIKU_MIN_POLL_INTERVAL_SEC: () => SIKU_MIN_POLL_INTERVAL_SEC,
  SIKU_MIN_TIME_CHECK_INTERVAL_HOURS: () => SIKU_MIN_TIME_CHECK_INTERVAL_HOURS,
  SIKU_MIN_TIME_SYNC_THRESHOLD_SEC: () => SIKU_MIN_TIME_SYNC_THRESHOLD_SEC,
  SIKU_NODEJS_MAX_TIMER_MS: () => SIKU_NODEJS_MAX_TIMER_MS,
  getPollIntervalMs: () => getPollIntervalMs,
  getTimeCheckIntervalMs: () => getTimeCheckIntervalMs,
  getTimeSyncThresholdSec: () => getTimeSyncThresholdSec
});
module.exports = __toCommonJS(siku_timer_exports);
const SIKU_NODEJS_MAX_TIMER_MS = 2147483647;
const SIKU_DEFAULT_POLL_INTERVAL_SEC = 30;
const SIKU_MIN_POLL_INTERVAL_SEC = 5;
const SIKU_MAX_POLL_INTERVAL_SEC = Math.floor(SIKU_NODEJS_MAX_TIMER_MS / 1e3);
const SIKU_DEFAULT_TIME_CHECK_INTERVAL_HOURS = 24;
const SIKU_MIN_TIME_CHECK_INTERVAL_HOURS = 24;
const SIKU_MAX_TIME_CHECK_INTERVAL_HOURS = Math.floor(SIKU_NODEJS_MAX_TIMER_MS / (60 * 60 * 1e3));
const SIKU_DEFAULT_TIME_SYNC_THRESHOLD_SEC = 10;
const SIKU_MIN_TIME_SYNC_THRESHOLD_SEC = 10;
const SIKU_MAX_TIME_SYNC_THRESHOLD_SEC = 24 * 60 * 60;
function normalizeFiniteInteger(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.trunc(value);
}
function clampInteger(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
function getPollIntervalMs(configuredSeconds) {
  const seconds = clampInteger(
    normalizeFiniteInteger(configuredSeconds, SIKU_DEFAULT_POLL_INTERVAL_SEC),
    SIKU_MIN_POLL_INTERVAL_SEC,
    SIKU_MAX_POLL_INTERVAL_SEC
  );
  return seconds * 1e3;
}
function getTimeCheckIntervalMs(configuredHours) {
  const hours = clampInteger(
    normalizeFiniteInteger(configuredHours, SIKU_DEFAULT_TIME_CHECK_INTERVAL_HOURS),
    SIKU_MIN_TIME_CHECK_INTERVAL_HOURS,
    SIKU_MAX_TIME_CHECK_INTERVAL_HOURS
  );
  return hours * 60 * 60 * 1e3;
}
function getTimeSyncThresholdSec(configuredSeconds) {
  return clampInteger(
    normalizeFiniteInteger(configuredSeconds, SIKU_DEFAULT_TIME_SYNC_THRESHOLD_SEC),
    SIKU_MIN_TIME_SYNC_THRESHOLD_SEC,
    SIKU_MAX_TIME_SYNC_THRESHOLD_SEC
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SIKU_DEFAULT_POLL_INTERVAL_SEC,
  SIKU_DEFAULT_TIME_CHECK_INTERVAL_HOURS,
  SIKU_DEFAULT_TIME_SYNC_THRESHOLD_SEC,
  SIKU_MAX_POLL_INTERVAL_SEC,
  SIKU_MAX_TIME_CHECK_INTERVAL_HOURS,
  SIKU_MAX_TIME_SYNC_THRESHOLD_SEC,
  SIKU_MIN_POLL_INTERVAL_SEC,
  SIKU_MIN_TIME_CHECK_INTERVAL_HOURS,
  SIKU_MIN_TIME_SYNC_THRESHOLD_SEC,
  SIKU_NODEJS_MAX_TIMER_MS,
  getPollIntervalMs,
  getTimeCheckIntervalMs,
  getTimeSyncThresholdSec
});
//# sourceMappingURL=siku-timer.js.map
