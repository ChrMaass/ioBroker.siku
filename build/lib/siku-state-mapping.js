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
var siku_state_mapping_exports = {};
__export(siku_state_mapping_exports, {
  SIKU_POLL_PARAMETERS: () => SIKU_POLL_PARAMETERS,
  SIKU_STATE_DEFINITIONS: () => SIKU_STATE_DEFINITIONS,
  SIKU_WRITABLE_STATE_IDS: () => SIKU_WRITABLE_STATE_IDS,
  buildWriteRequestForState: () => buildWriteRequestForState,
  decodeMappedStateUpdates: () => decodeMappedStateUpdates,
  getStateDefinitionsByChannel: () => getStateDefinitionsByChannel,
  getWritableStateDefinition: () => getWritableStateDefinition,
  isButtonState: () => isButtonState
});
module.exports = __toCommonJS(siku_state_mapping_exports);
var import_siku_constants = require("./siku-constants");
var import_siku_protocol = require("./siku-protocol");
function decodeBoolean(value) {
  return value.some((byte) => byte !== 0);
}
function decodeTimerDurationMinutes(value) {
  if (value.length !== 2) {
    throw new Error(`Timer duration must be 2 bytes long, received ${value.length}`);
  }
  return value[0] + value[1] * 60;
}
function encodeTimerDurationMinutes(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 23 * 60 + 59) {
    throw new Error("Timer duration must be an integer between 0 and 1439 minutes");
  }
  return Buffer.from([value % 60, Math.floor(value / 60)]);
}
function decodeCountdownMinutes(value) {
  if (value.length === 3) {
    return value[0] + value[1] * 60 + value[2] * 24 * 60;
  }
  if (value.length === 4) {
    const days = value[2] + (value[3] << 8);
    return value[0] + value[1] * 60 + days * 24 * 60;
  }
  throw new Error(`Countdown value must be 3 or 4 bytes long, received ${value.length}`);
}
function decodeCountdownText(value) {
  const totalMinutes = decodeCountdownMinutes(value);
  const days = Math.floor(totalMinutes / (24 * 60));
  const remainingAfterDays = totalMinutes % (24 * 60);
  const hours = Math.floor(remainingAfterDays / 60);
  const minutes = remainingAfterDays % 60;
  return `${days}d ${hours}h ${minutes}m`;
}
function decodeOperatingHoursMinutes(value) {
  if (value.length !== 4) {
    throw new Error(`Operating hours must be 4 bytes long, received ${value.length}`);
  }
  const minutes = value[0];
  const hours = value[1];
  const days = value[2] + (value[3] << 8);
  return minutes + hours * 60 + days * 24 * 60;
}
function decodeOperatingHoursText(value) {
  const totalMinutes = decodeOperatingHoursMinutes(value);
  const days = Math.floor(totalMinutes / (24 * 60));
  const remainingAfterDays = totalMinutes % (24 * 60);
  const hours = Math.floor(remainingAfterDays / 60);
  const minutes = remainingAfterDays % 60;
  return `${days}d ${hours}h ${minutes}m`;
}
function decodeFirmwareVersion(value) {
  if (value.length !== 6) {
    throw new Error(`Firmware version must be 6 bytes long, received ${value.length}`);
  }
  const year = value[4] + (value[5] << 8);
  return `${value[0]}.${value[1]} (${value[2].toString().padStart(2, "0")}.${value[3].toString().padStart(2, "0")}.${year})`;
}
function encodeBooleanSwitch(value) {
  if (typeof value !== "boolean") {
    throw new Error("Switch value must be a boolean");
  }
  return Buffer.from([value ? 1 : 0]);
}
function encodeButtonPress(value) {
  if (value !== true) {
    throw new Error("Button states only accept the value true");
  }
  return Buffer.from([1]);
}
function encodeIntegerRange(value, minimum, maximum, fieldName) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
  }
  return Buffer.from([value]);
}
function getPacketEntry(packet, parameter) {
  var _a;
  return (_a = packet.entries.find((entry) => entry.parameter === parameter && !entry.unsupported)) == null ? void 0 : _a.value;
}
const SIKU_STATE_DEFINITIONS = [
  {
    relativeId: "control.power",
    common: { name: "Eingeschaltet", role: "switch", type: "boolean", read: true, write: true, def: false },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_POWER, decode: decodeBoolean },
    write: { parameter: import_siku_constants.SIKU_PARAMETER_POWER, encode: encodeBooleanSwitch }
  },
  {
    relativeId: "control.fanSpeed",
    common: { name: "L\xFCfterstufe", role: "level.speed", type: "number", read: true, write: true, def: 1 },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_FAN_SPEED, decode: import_siku_protocol.decodeUnsignedLE },
    write: {
      parameter: import_siku_constants.SIKU_PARAMETER_FAN_SPEED,
      encode: (value) => encodeIntegerRange(value, 1, 255, "Fan speed")
    }
  },
  {
    relativeId: "timers.boostActive",
    common: { name: "Boost aktiv", role: "indicator", type: "boolean", read: true, write: false, def: false },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_BOOST_STATUS, decode: decodeBoolean }
  },
  {
    relativeId: "control.timerMode",
    common: { name: "Timer-Modus", role: "level.mode", type: "number", read: true, write: true, def: 0 },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_TIMER_MODE, decode: import_siku_protocol.decodeUnsignedLE },
    write: { parameter: import_siku_constants.SIKU_PARAMETER_TIMER_MODE, encode: (value) => encodeIntegerRange(value, 0, 2, "Timer mode") }
  },
  {
    relativeId: "control.humiditySensorEnabled",
    common: { name: "Feuchtesensor aktiv", role: "switch", type: "boolean", read: true, write: true, def: false },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_HUMIDITY_SENSOR_ENABLED, decode: decodeBoolean },
    write: { parameter: import_siku_constants.SIKU_PARAMETER_HUMIDITY_SENSOR_ENABLED, encode: encodeBooleanSwitch }
  },
  {
    relativeId: "control.relaySensorEnabled",
    common: { name: "Relais-Sensor aktiv", role: "switch", type: "boolean", read: true, write: true, def: false },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_RELAY_SENSOR_ENABLED, decode: decodeBoolean },
    write: { parameter: import_siku_constants.SIKU_PARAMETER_RELAY_SENSOR_ENABLED, encode: encodeBooleanSwitch }
  },
  {
    relativeId: "control.analogSensorEnabled",
    common: { name: "0-10V-Sensor aktiv", role: "switch", type: "boolean", read: true, write: true, def: false },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_ANALOG_SENSOR_ENABLED, decode: decodeBoolean },
    write: { parameter: import_siku_constants.SIKU_PARAMETER_ANALOG_SENSOR_ENABLED, encode: encodeBooleanSwitch }
  },
  {
    relativeId: "control.humiditySetpoint",
    common: {
      name: "Feuchtesollwert",
      role: "level.humidity",
      type: "number",
      unit: "%",
      read: true,
      write: true,
      def: 50,
      min: 40,
      max: 80
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_HUMIDITY_SETPOINT, decode: import_siku_protocol.decodeUnsignedLE },
    write: {
      parameter: import_siku_constants.SIKU_PARAMETER_HUMIDITY_SETPOINT,
      encode: (value) => encodeIntegerRange(value, 40, 80, "Humidity setpoint")
    }
  },
  {
    relativeId: "sensors.rtcBatteryVoltage",
    common: {
      name: "RTC-Batteriespannung",
      role: "value.voltage",
      type: "number",
      unit: "mV",
      read: true,
      write: false
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_RTC_BATTERY_VOLTAGE, decode: import_siku_protocol.decodeUnsignedLE }
  },
  {
    relativeId: "sensors.humidity",
    common: {
      name: "Aktuelle Feuchte",
      role: "value.humidity",
      type: "number",
      unit: "%",
      read: true,
      write: false
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_HUMIDITY, decode: import_siku_protocol.decodeUnsignedLE }
  },
  {
    relativeId: "sensors.analogSensorValue",
    common: { name: "0-10V-Sensorwert", role: "value", type: "number", unit: "%", read: true, write: false },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_ANALOG_SENSOR_VALUE, decode: import_siku_protocol.decodeUnsignedLE }
  },
  {
    relativeId: "sensors.relaySensorValue",
    common: { name: "Relais-Sensorwert", role: "indicator", type: "boolean", read: true, write: false, def: false },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_RELAY_SENSOR_VALUE, decode: decodeBoolean }
  },
  {
    relativeId: "control.manualFanSpeed",
    common: {
      name: "Manuelle L\xFCfterstufe",
      role: "level.speed",
      type: "number",
      read: true,
      write: true,
      def: 0,
      min: 0,
      max: 255
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_MANUAL_FAN_SPEED, decode: import_siku_protocol.decodeUnsignedLE },
    write: {
      parameter: import_siku_constants.SIKU_PARAMETER_MANUAL_FAN_SPEED,
      encode: (value) => encodeIntegerRange(value, 0, 255, "Manual fan speed")
    }
  },
  {
    relativeId: "sensors.fan1Rpm",
    common: { name: "Ventilator 1", role: "value.speed", type: "number", unit: "rpm", read: true, write: false },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_FAN1_RPM, decode: import_siku_protocol.decodeUnsignedLE }
  },
  {
    relativeId: "sensors.fan2Rpm",
    common: { name: "Ventilator 2", role: "value.speed", type: "number", unit: "rpm", read: true, write: false },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_FAN2_RPM, decode: import_siku_protocol.decodeUnsignedLE }
  },
  {
    relativeId: "timers.filterCountdownMinutes",
    common: {
      name: "Filter-Countdown (Minuten)",
      role: "value.interval",
      type: "number",
      unit: "min",
      read: true,
      write: false
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_FILTER_COUNTDOWN, decode: decodeCountdownMinutes }
  },
  {
    relativeId: "timers.filterCountdownText",
    common: { name: "Filter-Countdown", role: "text", type: "string", read: true, write: false, def: "" },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_FILTER_COUNTDOWN, decode: decodeCountdownText }
  },
  {
    relativeId: "control.resetFilterTimer",
    common: {
      name: "Filtertimer zur\xFCcksetzen",
      role: "button",
      type: "boolean",
      read: false,
      write: true,
      def: false
    },
    write: { parameter: import_siku_constants.SIKU_PARAMETER_RESET_FILTER_TIMER, encode: encodeButtonPress, isButton: true }
  },
  {
    relativeId: "control.boostOverrunMinutes",
    common: {
      name: "Boost-Nachlauf",
      role: "value.interval",
      type: "number",
      unit: "min",
      read: true,
      write: true,
      def: 0,
      min: 0,
      max: 60
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_BOOST_OVERRUN_MINUTES, decode: import_siku_protocol.decodeUnsignedLE },
    write: {
      parameter: import_siku_constants.SIKU_PARAMETER_BOOST_OVERRUN_MINUTES,
      encode: (value) => encodeIntegerRange(value, 0, 60, "Boost overrun minutes")
    }
  },
  {
    relativeId: "control.timeControlledOperation",
    common: {
      name: "Zeitgesteuerter Betrieb",
      role: "switch",
      type: "boolean",
      read: true,
      write: true,
      def: false
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_TIME_CONTROLLED_OPERATION, decode: decodeBoolean },
    write: { parameter: import_siku_constants.SIKU_PARAMETER_TIME_CONTROLLED_OPERATION, encode: encodeBooleanSwitch }
  },
  {
    relativeId: "info.operatingHoursMinutes",
    common: {
      name: "Betriebsstunden (Minuten)",
      role: "value.interval",
      type: "number",
      unit: "min",
      read: true,
      write: false
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_OPERATING_HOURS, decode: decodeOperatingHoursMinutes }
  },
  {
    relativeId: "info.operatingHoursText",
    common: { name: "Betriebsstunden", role: "text", type: "string", read: true, write: false, def: "" },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_OPERATING_HOURS, decode: decodeOperatingHoursText }
  },
  {
    relativeId: "diagnostics.resetAlarms",
    common: { name: "Alarme zur\xFCcksetzen", role: "button", type: "boolean", read: false, write: true, def: false },
    write: { parameter: import_siku_constants.SIKU_PARAMETER_RESET_ALARMS, encode: encodeButtonPress, isButton: true }
  },
  {
    relativeId: "diagnostics.alarmLevel",
    common: { name: "Alarm-/Warnstufe", role: "value", type: "number", read: true, write: false },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_ALARM_LEVEL, decode: import_siku_protocol.decodeUnsignedLE }
  },
  {
    relativeId: "info.firmwareVersion",
    common: { name: "Firmware-Version", role: "text", type: "string", read: true, write: false, def: "" },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_FIRMWARE_VERSION, decode: decodeFirmwareVersion }
  },
  {
    relativeId: "diagnostics.filterChangeRequired",
    common: {
      name: "Filterwechsel erforderlich",
      role: "indicator.maintenance",
      type: "boolean",
      read: true,
      write: false,
      def: false
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_FILTER_CHANGE_REQUIRED, decode: decodeBoolean }
  },
  {
    relativeId: "control.fanMode",
    common: { name: "Betriebsart", role: "level.mode", type: "number", read: true, write: true, def: 0 },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_FAN_MODE, decode: import_siku_protocol.decodeUnsignedLE },
    write: { parameter: import_siku_constants.SIKU_PARAMETER_FAN_MODE, encode: (value) => encodeIntegerRange(value, 0, 2, "Fan mode") }
  },
  {
    relativeId: "control.analogSensorSetpoint",
    common: {
      name: "0-10V-Sollwert",
      role: "value",
      type: "number",
      unit: "%",
      read: true,
      write: true,
      def: 5,
      min: 5,
      max: 100
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_ANALOG_SENSOR_SETPOINT, decode: import_siku_protocol.decodeUnsignedLE },
    write: {
      parameter: import_siku_constants.SIKU_PARAMETER_ANALOG_SENSOR_SETPOINT,
      encode: (value) => encodeIntegerRange(value, 5, 100, "Analog sensor setpoint")
    }
  },
  {
    relativeId: "timers.nightModeSetpointMinutes",
    common: {
      name: "Nachtbetrieb",
      role: "value.interval",
      type: "number",
      unit: "min",
      read: true,
      write: true,
      def: 0
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_NIGHT_TIMER_SETPOINT, decode: decodeTimerDurationMinutes },
    write: { parameter: import_siku_constants.SIKU_PARAMETER_NIGHT_TIMER_SETPOINT, encode: encodeTimerDurationMinutes }
  },
  {
    relativeId: "timers.partyModeSetpointMinutes",
    common: {
      name: "Partybetrieb",
      role: "value.interval",
      type: "number",
      unit: "min",
      read: true,
      write: true,
      def: 0
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_PARTY_TIMER_SETPOINT, decode: decodeTimerDurationMinutes },
    write: { parameter: import_siku_constants.SIKU_PARAMETER_PARTY_TIMER_SETPOINT, encode: encodeTimerDurationMinutes }
  },
  {
    relativeId: "sensors.humidityAboveSetpoint",
    common: {
      name: "Feuchte \xFCber Sollwert",
      role: "indicator",
      type: "boolean",
      read: true,
      write: false,
      def: false
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_HUMIDITY_SENSOR_STATE, decode: decodeBoolean }
  },
  {
    relativeId: "sensors.analogAboveSetpoint",
    common: {
      name: "0-10V \xFCber Sollwert",
      role: "indicator",
      type: "boolean",
      read: true,
      write: false,
      def: false
    },
    read: { parameter: import_siku_constants.SIKU_PARAMETER_ANALOG_SENSOR_STATE, decode: decodeBoolean }
  }
];
const SIKU_POLL_PARAMETERS = Array.from(
  new Set(SIKU_STATE_DEFINITIONS.filter((definition) => definition.read).map((definition) => definition.read.parameter))
).sort((left, right) => left - right);
const SIKU_WRITABLE_STATE_IDS = SIKU_STATE_DEFINITIONS.filter((definition) => definition.write).map(
  (definition) => definition.relativeId
);
function getWritableStateDefinition(relativeId) {
  return SIKU_STATE_DEFINITIONS.find((definition) => definition.relativeId === relativeId && definition.write);
}
function getStateDefinitionsByChannel(channelId) {
  return SIKU_STATE_DEFINITIONS.filter((definition) => definition.relativeId.startsWith(`${channelId}.`));
}
function decodeMappedStateUpdates(packet) {
  const updates = [];
  for (const definition of SIKU_STATE_DEFINITIONS) {
    if (!definition.read) {
      continue;
    }
    const value = getPacketEntry(packet, definition.read.parameter);
    if (!value) {
      continue;
    }
    updates.push({
      relativeId: definition.relativeId,
      value: definition.read.decode(value)
    });
  }
  return updates;
}
function buildWriteRequestForState(relativeId, value) {
  const definition = getWritableStateDefinition(relativeId);
  if (!(definition == null ? void 0 : definition.write)) {
    throw new Error(`State ${relativeId} is not writable`);
  }
  return {
    parameter: definition.write.parameter,
    value: definition.write.encode(value)
  };
}
function isButtonState(relativeId) {
  var _a, _b;
  return Boolean((_b = (_a = getWritableStateDefinition(relativeId)) == null ? void 0 : _a.write) == null ? void 0 : _b.isButton);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SIKU_POLL_PARAMETERS,
  SIKU_STATE_DEFINITIONS,
  SIKU_WRITABLE_STATE_IDS,
  buildWriteRequestForState,
  decodeMappedStateUpdates,
  getStateDefinitionsByChannel,
  getWritableStateDefinition,
  isButtonState
});
//# sourceMappingURL=siku-state-mapping.js.map
