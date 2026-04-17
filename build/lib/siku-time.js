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
var siku_time_exports = {};
__export(siku_time_exports, {
  calculateClockDriftSeconds: () => calculateClockDriftSeconds,
  decodeRtcDate: () => decodeRtcDate,
  decodeRtcSnapshot: () => decodeRtcSnapshot,
  encodeRtcCalendar: () => encodeRtcCalendar,
  encodeRtcTime: () => encodeRtcTime,
  getSikuWeekday: () => getSikuWeekday
});
module.exports = __toCommonJS(siku_time_exports);
var import_siku_constants = require("./siku-constants");
function getPacketEntry(packet, parameter) {
  return packet.entries.find((entry) => entry.parameter === parameter && !entry.unsupported);
}
function ensureRange(value, minimum, maximum, fieldName) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${fieldName} must be between ${minimum} and ${maximum}`);
  }
}
function encodeRtcTime(date) {
  return Buffer.from([date.getSeconds(), date.getMinutes(), date.getHours()]);
}
function encodeRtcCalendar(date) {
  return Buffer.from([date.getDate(), getSikuWeekday(date), date.getMonth() + 1, date.getFullYear() % 100]);
}
function getSikuWeekday(date) {
  return (date.getDay() + 6) % 7 + 1;
}
function decodeRtcDate(timeValue, calendarValue) {
  if (timeValue.length !== 3) {
    throw new Error(`RTC time payload must be exactly 3 bytes long, received ${timeValue.length}`);
  }
  if (calendarValue.length !== 4) {
    throw new Error(`RTC calendar payload must be exactly 4 bytes long, received ${calendarValue.length}`);
  }
  const seconds = timeValue[0];
  const minutes = timeValue[1];
  const hours = timeValue[2];
  const day = calendarValue[0];
  const weekday = calendarValue[1];
  const month = calendarValue[2];
  const year = calendarValue[3];
  ensureRange(seconds, 0, 59, "RTC seconds");
  ensureRange(minutes, 0, 59, "RTC minutes");
  ensureRange(hours, 0, 23, "RTC hours");
  ensureRange(day, 1, 31, "RTC day");
  ensureRange(weekday, 1, 7, "RTC weekday");
  ensureRange(month, 1, 12, "RTC month");
  ensureRange(year, 0, 99, "RTC year");
  const date = new Date(2e3, month - 1, day, hours, minutes, seconds, 0);
  date.setFullYear(2e3 + year);
  if (date.getFullYear() !== 2e3 + year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hours || date.getMinutes() !== minutes || date.getSeconds() !== seconds) {
    throw new Error("RTC date payload does not represent a valid calendar date");
  }
  return date;
}
function decodeRtcSnapshot(packet) {
  const timeEntry = getPacketEntry(packet, import_siku_constants.SIKU_PARAMETER_RTC_TIME);
  if (!timeEntry) {
    throw new Error("Device response did not contain RTC time (0x006F)");
  }
  const calendarEntry = getPacketEntry(packet, import_siku_constants.SIKU_PARAMETER_RTC_CALENDAR);
  if (!calendarEntry) {
    throw new Error("Device response did not contain RTC calendar (0x0070)");
  }
  return {
    deviceDate: decodeRtcDate(timeEntry.value, calendarEntry.value),
    timeValue: Buffer.from(timeEntry.value),
    calendarValue: Buffer.from(calendarEntry.value)
  };
}
function calculateClockDriftSeconds(deviceDate, referenceDate) {
  return Math.round((referenceDate.getTime() - deviceDate.getTime()) / 1e3);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  calculateClockDriftSeconds,
  decodeRtcDate,
  decodeRtcSnapshot,
  encodeRtcCalendar,
  encodeRtcTime,
  getSikuWeekday
});
//# sourceMappingURL=siku-time.js.map
