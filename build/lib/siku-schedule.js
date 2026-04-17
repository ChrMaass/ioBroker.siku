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
var siku_schedule_exports = {};
__export(siku_schedule_exports, {
  SIKU_SCHEDULE_STATE_DEFINITIONS: () => SIKU_SCHEDULE_STATE_DEFINITIONS,
  SIKU_SCHEDULE_WRITABLE_STATE_IDS: () => SIKU_SCHEDULE_WRITABLE_STATE_IDS,
  buildScheduleReadRequests: () => buildScheduleReadRequests,
  buildScheduleWriteRequest: () => buildScheduleWriteRequest,
  decodeScheduleUpdates: () => decodeScheduleUpdates,
  getScheduleDayDefinitions: () => getScheduleDayDefinitions,
  getScheduleSnapshotStateIds: () => getScheduleSnapshotStateIds,
  getScheduleStateDefinition: () => getScheduleStateDefinition,
  getScheduleStateDefinitions: () => getScheduleStateDefinitions,
  isScheduleStateId: () => isScheduleStateId
});
module.exports = __toCommonJS(siku_schedule_exports);
var import_siku_constants = require("./siku-constants");
const SIKU_SCHEDULE_DAYS = [
  { key: "monday", number: 1, name: "Montag" },
  { key: "tuesday", number: 2, name: "Dienstag" },
  { key: "wednesday", number: 3, name: "Mittwoch" },
  { key: "thursday", number: 4, name: "Donnerstag" },
  { key: "friday", number: 5, name: "Freitag" },
  { key: "saturday", number: 6, name: "Samstag" },
  { key: "sunday", number: 7, name: "Sonntag" }
];
const SIKU_SCHEDULE_PERIODS = [1, 2, 3, 4];
function buildScheduleStateDefinitions() {
  const definitions = [];
  for (const day of SIKU_SCHEDULE_DAYS) {
    for (const periodNumber of SIKU_SCHEDULE_PERIODS) {
      const baseRelativeId = `schedule.${day.key}.p${periodNumber}`;
      definitions.push(
        {
          relativeId: `${baseRelativeId}.speed`,
          dayKey: day.key,
          dayNumber: day.number,
          periodNumber,
          field: "speed",
          common: {
            name: `${day.name} Periode ${periodNumber} - L\xFCfterstufe`,
            role: "level.speed",
            type: "number",
            read: true,
            write: true,
            min: 0,
            max: 3,
            def: 0
          }
        },
        {
          relativeId: `${baseRelativeId}.endHour`,
          dayKey: day.key,
          dayNumber: day.number,
          periodNumber,
          field: "endHour",
          common: {
            name: `${day.name} Periode ${periodNumber} - Endstunde`,
            role: "value",
            type: "number",
            read: true,
            write: true,
            min: 0,
            max: 23,
            def: 0
          }
        },
        {
          relativeId: `${baseRelativeId}.endMinute`,
          dayKey: day.key,
          dayNumber: day.number,
          periodNumber,
          field: "endMinute",
          common: {
            name: `${day.name} Periode ${periodNumber} - Endminute`,
            role: "value",
            type: "number",
            read: true,
            write: true,
            min: 0,
            max: 59,
            def: 0
          }
        }
      );
    }
  }
  return definitions;
}
const SIKU_SCHEDULE_STATE_DEFINITIONS_INTERNAL = buildScheduleStateDefinitions();
const SIKU_SCHEDULE_STATE_DEFINITION_MAP = new Map(
  SIKU_SCHEDULE_STATE_DEFINITIONS_INTERNAL.map((definition) => [definition.relativeId, definition])
);
function getScheduleDayByNumber(dayNumber) {
  return SIKU_SCHEDULE_DAYS.find((day) => day.number === dayNumber);
}
function parseScheduleEntryValue(value) {
  if (value.length !== 6) {
    return null;
  }
  const day = getScheduleDayByNumber(value[0]);
  const periodNumber = value[1];
  if (!day || periodNumber < 1 || periodNumber > 4) {
    return null;
  }
  return {
    day,
    periodNumber,
    speed: value[2],
    endMinute: value[4],
    endHour: value[5]
  };
}
function validateScheduleInteger(value, minimum, maximum, fieldName) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
const SIKU_SCHEDULE_STATE_DEFINITIONS = SIKU_SCHEDULE_STATE_DEFINITIONS_INTERNAL;
const SIKU_SCHEDULE_WRITABLE_STATE_IDS = SIKU_SCHEDULE_STATE_DEFINITIONS_INTERNAL.map(
  (definition) => definition.relativeId
);
function getScheduleStateDefinition(relativeId) {
  return SIKU_SCHEDULE_STATE_DEFINITION_MAP.get(relativeId);
}
function getScheduleStateDefinitions() {
  return [...SIKU_SCHEDULE_STATE_DEFINITIONS_INTERNAL];
}
function getScheduleDayDefinitions() {
  return SIKU_SCHEDULE_DAYS.map((day) => ({ key: day.key, name: day.name }));
}
function isScheduleStateId(relativeId) {
  return SIKU_SCHEDULE_STATE_DEFINITION_MAP.has(relativeId);
}
function buildScheduleReadRequests() {
  return SIKU_SCHEDULE_DAYS.flatMap(
    (day) => SIKU_SCHEDULE_PERIODS.map((periodNumber) => ({
      parameter: import_siku_constants.SIKU_PARAMETER_SCHEDULE,
      valueSize: 2,
      requestValue: Buffer.from([day.number, periodNumber])
    }))
  );
}
function decodeScheduleUpdates(packet) {
  const updates = [];
  for (const entry of packet.entries) {
    if (entry.parameter !== import_siku_constants.SIKU_PARAMETER_SCHEDULE || entry.unsupported) {
      continue;
    }
    const parsed = parseScheduleEntryValue(entry.value);
    if (!parsed) {
      continue;
    }
    const baseRelativeId = `schedule.${parsed.day.key}.p${parsed.periodNumber}`;
    updates.push(
      { relativeId: `${baseRelativeId}.speed`, value: parsed.speed },
      { relativeId: `${baseRelativeId}.endHour`, value: parsed.endHour },
      { relativeId: `${baseRelativeId}.endMinute`, value: parsed.endMinute }
    );
  }
  return updates;
}
function getScheduleSnapshotStateIds(relativeId) {
  const definition = getScheduleStateDefinition(relativeId);
  if (!definition) {
    return [];
  }
  const baseRelativeId = `schedule.${definition.dayKey}.p${definition.periodNumber}`;
  return [`${baseRelativeId}.speed`, `${baseRelativeId}.endHour`, `${baseRelativeId}.endMinute`];
}
function buildScheduleWriteRequest(relativeId, values) {
  const definition = getScheduleStateDefinition(relativeId);
  if (!definition) {
    throw new Error(`State ${relativeId} is not a schedule state`);
  }
  const baseRelativeId = `schedule.${definition.dayKey}.p${definition.periodNumber}`;
  const speed = validateScheduleInteger(values[`${baseRelativeId}.speed`], 0, 3, "Schedule speed");
  const endHour = validateScheduleInteger(values[`${baseRelativeId}.endHour`], 0, 23, "Schedule end hour");
  const endMinute = validateScheduleInteger(values[`${baseRelativeId}.endMinute`], 0, 59, "Schedule end minute");
  return {
    parameter: import_siku_constants.SIKU_PARAMETER_SCHEDULE,
    value: Buffer.from([definition.dayNumber, definition.periodNumber, speed, 0, endMinute, endHour])
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SIKU_SCHEDULE_STATE_DEFINITIONS,
  SIKU_SCHEDULE_WRITABLE_STATE_IDS,
  buildScheduleReadRequests,
  buildScheduleWriteRequest,
  decodeScheduleUpdates,
  getScheduleDayDefinitions,
  getScheduleSnapshotStateIds,
  getScheduleStateDefinition,
  getScheduleStateDefinitions,
  isScheduleStateId
});
//# sourceMappingURL=siku-schedule.js.map
