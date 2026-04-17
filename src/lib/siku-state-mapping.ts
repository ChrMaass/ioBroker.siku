import {
    SIKU_PARAMETER_ALARM_LEVEL,
    SIKU_PARAMETER_ANALOG_SENSOR_ENABLED,
    SIKU_PARAMETER_ANALOG_SENSOR_SETPOINT,
    SIKU_PARAMETER_ANALOG_SENSOR_STATE,
    SIKU_PARAMETER_ANALOG_SENSOR_VALUE,
    SIKU_PARAMETER_BOOST_OVERRUN_MINUTES,
    SIKU_PARAMETER_BOOST_STATUS,
    SIKU_PARAMETER_FAN1_RPM,
    SIKU_PARAMETER_FAN2_RPM,
    SIKU_PARAMETER_FAN_MODE,
    SIKU_PARAMETER_FAN_SPEED,
    SIKU_PARAMETER_FILTER_CHANGE_REQUIRED,
    SIKU_PARAMETER_FILTER_COUNTDOWN,
    SIKU_PARAMETER_FIRMWARE_VERSION,
    SIKU_PARAMETER_HUMIDITY,
    SIKU_PARAMETER_HUMIDITY_SENSOR_ENABLED,
    SIKU_PARAMETER_HUMIDITY_SENSOR_STATE,
    SIKU_PARAMETER_HUMIDITY_SETPOINT,
    SIKU_PARAMETER_MANUAL_FAN_SPEED,
    SIKU_PARAMETER_OPERATING_HOURS,
    SIKU_PARAMETER_PARTY_TIMER_SETPOINT,
    SIKU_PARAMETER_POWER,
    SIKU_PARAMETER_RELAY_SENSOR_ENABLED,
    SIKU_PARAMETER_RELAY_SENSOR_VALUE,
    SIKU_PARAMETER_RESET_ALARMS,
    SIKU_PARAMETER_RESET_FILTER_TIMER,
    SIKU_PARAMETER_RTC_BATTERY_VOLTAGE,
    SIKU_PARAMETER_TIME_CONTROLLED_OPERATION,
    SIKU_PARAMETER_TIMER_MODE,
    SIKU_PARAMETER_NIGHT_TIMER_SETPOINT,
} from './siku-constants';
import { decodeUnsignedLE } from './siku-protocol';
import type { ParsedSikuPacket, SikuWriteRequestEntry } from './siku-protocol';

export interface SikuRelativeStateUpdate {
    relativeId: string;
    value: ioBroker.StateValue;
}

export interface SikuStateDefinition {
    relativeId: string;
    common: Partial<ioBroker.StateCommon>;
    read?: {
        parameter: number;
        decode: (value: Buffer) => ioBroker.StateValue;
    };
    write?: {
        parameter: number;
        encode: (value: ioBroker.StateValue) => Buffer;
        isButton?: boolean;
    };
}

function decodeBoolean(value: Buffer): boolean {
    return value.some(byte => byte !== 0x00);
}

function decodeTimerDurationMinutes(value: Buffer): number {
    if (value.length !== 2) {
        throw new Error(`Timer duration must be 2 bytes long, received ${value.length}`);
    }

    return value[0] + value[1] * 60;
}

function encodeTimerDurationMinutes(value: ioBroker.StateValue): Buffer {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 23 * 60 + 59) {
        throw new Error('Timer duration must be an integer between 0 and 1439 minutes');
    }

    return Buffer.from([value % 60, Math.floor(value / 60)]);
}

function decodeCountdownMinutes(value: Buffer): number {
    if (value.length === 3) {
        return value[0] + value[1] * 60 + value[2] * 24 * 60;
    }

    if (value.length === 4) {
        const days = value[2] + (value[3] << 8);
        return value[0] + value[1] * 60 + days * 24 * 60;
    }

    throw new Error(`Countdown value must be 3 or 4 bytes long, received ${value.length}`);
}

function decodeCountdownText(value: Buffer): string {
    const totalMinutes = decodeCountdownMinutes(value);
    const days = Math.floor(totalMinutes / (24 * 60));
    const remainingAfterDays = totalMinutes % (24 * 60);
    const hours = Math.floor(remainingAfterDays / 60);
    const minutes = remainingAfterDays % 60;

    return `${days}d ${hours}h ${minutes}m`;
}

function decodeOperatingHoursMinutes(value: Buffer): number {
    if (value.length !== 4) {
        throw new Error(`Operating hours must be 4 bytes long, received ${value.length}`);
    }

    const minutes = value[0];
    const hours = value[1];
    const days = value[2] + (value[3] << 8);

    return minutes + hours * 60 + days * 24 * 60;
}

function decodeOperatingHoursText(value: Buffer): string {
    const totalMinutes = decodeOperatingHoursMinutes(value);
    const days = Math.floor(totalMinutes / (24 * 60));
    const remainingAfterDays = totalMinutes % (24 * 60);
    const hours = Math.floor(remainingAfterDays / 60);
    const minutes = remainingAfterDays % 60;

    return `${days}d ${hours}h ${minutes}m`;
}

function decodeFirmwareVersion(value: Buffer): string {
    if (value.length !== 6) {
        throw new Error(`Firmware version must be 6 bytes long, received ${value.length}`);
    }

    const year = value[4] + (value[5] << 8);
    return `${value[0]}.${value[1]} (${value[2].toString().padStart(2, '0')}.${value[3]
        .toString()
        .padStart(2, '0')}.${year})`;
}

function encodeBooleanSwitch(value: ioBroker.StateValue): Buffer {
    if (typeof value !== 'boolean') {
        throw new Error('Switch value must be a boolean');
    }

    return Buffer.from([value ? 0x01 : 0x00]);
}

function encodeButtonPress(value: ioBroker.StateValue): Buffer {
    if (value !== true) {
        throw new Error('Button states only accept the value true');
    }

    return Buffer.from([0x01]);
}

function encodeIntegerRange(value: ioBroker.StateValue, minimum: number, maximum: number, fieldName: string): Buffer {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
    }

    return Buffer.from([value]);
}

function getPacketEntry(packet: ParsedSikuPacket, parameter: number): Buffer | undefined {
    return packet.entries.find(entry => entry.parameter === parameter && !entry.unsupported)?.value;
}

export const SIKU_STATE_DEFINITIONS: readonly SikuStateDefinition[] = [
    {
        relativeId: 'control.power',
        common: { name: 'Eingeschaltet', role: 'switch', type: 'boolean', read: true, write: true, def: false },
        read: { parameter: SIKU_PARAMETER_POWER, decode: decodeBoolean },
        write: { parameter: SIKU_PARAMETER_POWER, encode: encodeBooleanSwitch },
    },
    {
        relativeId: 'control.fanSpeed',
        common: { name: 'Lüfterstufe', role: 'level.speed', type: 'number', read: true, write: true, def: 1 },
        read: { parameter: SIKU_PARAMETER_FAN_SPEED, decode: decodeUnsignedLE },
        write: {
            parameter: SIKU_PARAMETER_FAN_SPEED,
            encode: value => encodeIntegerRange(value, 1, 255, 'Fan speed'),
        },
    },
    {
        relativeId: 'timers.boostActive',
        common: { name: 'Boost aktiv', role: 'indicator', type: 'boolean', read: true, write: false, def: false },
        read: { parameter: SIKU_PARAMETER_BOOST_STATUS, decode: decodeBoolean },
    },
    {
        relativeId: 'control.timerMode',
        common: { name: 'Timer-Modus', role: 'level.mode', type: 'number', read: true, write: true, def: 0 },
        read: { parameter: SIKU_PARAMETER_TIMER_MODE, decode: decodeUnsignedLE },
        write: { parameter: SIKU_PARAMETER_TIMER_MODE, encode: value => encodeIntegerRange(value, 0, 2, 'Timer mode') },
    },
    {
        relativeId: 'control.humiditySensorEnabled',
        common: { name: 'Feuchtesensor aktiv', role: 'switch', type: 'boolean', read: true, write: true, def: false },
        read: { parameter: SIKU_PARAMETER_HUMIDITY_SENSOR_ENABLED, decode: decodeBoolean },
        write: { parameter: SIKU_PARAMETER_HUMIDITY_SENSOR_ENABLED, encode: encodeBooleanSwitch },
    },
    {
        relativeId: 'control.relaySensorEnabled',
        common: { name: 'Relais-Sensor aktiv', role: 'switch', type: 'boolean', read: true, write: true, def: false },
        read: { parameter: SIKU_PARAMETER_RELAY_SENSOR_ENABLED, decode: decodeBoolean },
        write: { parameter: SIKU_PARAMETER_RELAY_SENSOR_ENABLED, encode: encodeBooleanSwitch },
    },
    {
        relativeId: 'control.analogSensorEnabled',
        common: { name: '0-10V-Sensor aktiv', role: 'switch', type: 'boolean', read: true, write: true, def: false },
        read: { parameter: SIKU_PARAMETER_ANALOG_SENSOR_ENABLED, decode: decodeBoolean },
        write: { parameter: SIKU_PARAMETER_ANALOG_SENSOR_ENABLED, encode: encodeBooleanSwitch },
    },
    {
        relativeId: 'control.humiditySetpoint',
        common: {
            name: 'Feuchtesollwert',
            role: 'level.humidity',
            type: 'number',
            unit: '%',
            read: true,
            write: true,
            def: 50,
            min: 40,
            max: 80,
        },
        read: { parameter: SIKU_PARAMETER_HUMIDITY_SETPOINT, decode: decodeUnsignedLE },
        write: {
            parameter: SIKU_PARAMETER_HUMIDITY_SETPOINT,
            encode: value => encodeIntegerRange(value, 40, 80, 'Humidity setpoint'),
        },
    },
    {
        relativeId: 'sensors.rtcBatteryVoltage',
        common: {
            name: 'RTC-Batteriespannung',
            role: 'value.voltage',
            type: 'number',
            unit: 'mV',
            read: true,
            write: false,
        },
        read: { parameter: SIKU_PARAMETER_RTC_BATTERY_VOLTAGE, decode: decodeUnsignedLE },
    },
    {
        relativeId: 'sensors.humidity',
        common: {
            name: 'Aktuelle Feuchte',
            role: 'value.humidity',
            type: 'number',
            unit: '%',
            read: true,
            write: false,
        },
        read: { parameter: SIKU_PARAMETER_HUMIDITY, decode: decodeUnsignedLE },
    },
    {
        relativeId: 'sensors.analogSensorValue',
        common: { name: '0-10V-Sensorwert', role: 'value', type: 'number', unit: '%', read: true, write: false },
        read: { parameter: SIKU_PARAMETER_ANALOG_SENSOR_VALUE, decode: decodeUnsignedLE },
    },
    {
        relativeId: 'sensors.relaySensorValue',
        common: { name: 'Relais-Sensorwert', role: 'indicator', type: 'boolean', read: true, write: false, def: false },
        read: { parameter: SIKU_PARAMETER_RELAY_SENSOR_VALUE, decode: decodeBoolean },
    },
    {
        relativeId: 'control.manualFanSpeed',
        common: {
            name: 'Manuelle Lüfterstufe',
            role: 'level.speed',
            type: 'number',
            read: true,
            write: true,
            def: 0,
            min: 0,
            max: 255,
        },
        read: { parameter: SIKU_PARAMETER_MANUAL_FAN_SPEED, decode: decodeUnsignedLE },
        write: {
            parameter: SIKU_PARAMETER_MANUAL_FAN_SPEED,
            encode: value => encodeIntegerRange(value, 0, 255, 'Manual fan speed'),
        },
    },
    {
        relativeId: 'sensors.fan1Rpm',
        common: { name: 'Ventilator 1', role: 'value.speed', type: 'number', unit: 'rpm', read: true, write: false },
        read: { parameter: SIKU_PARAMETER_FAN1_RPM, decode: decodeUnsignedLE },
    },
    {
        relativeId: 'sensors.fan2Rpm',
        common: { name: 'Ventilator 2', role: 'value.speed', type: 'number', unit: 'rpm', read: true, write: false },
        read: { parameter: SIKU_PARAMETER_FAN2_RPM, decode: decodeUnsignedLE },
    },
    {
        relativeId: 'timers.filterCountdownMinutes',
        common: {
            name: 'Filter-Countdown (Minuten)',
            role: 'value.interval',
            type: 'number',
            unit: 'min',
            read: true,
            write: false,
        },
        read: { parameter: SIKU_PARAMETER_FILTER_COUNTDOWN, decode: decodeCountdownMinutes },
    },
    {
        relativeId: 'timers.filterCountdownText',
        common: { name: 'Filter-Countdown', role: 'text', type: 'string', read: true, write: false, def: '' },
        read: { parameter: SIKU_PARAMETER_FILTER_COUNTDOWN, decode: decodeCountdownText },
    },
    {
        relativeId: 'control.resetFilterTimer',
        common: {
            name: 'Filtertimer zurücksetzen',
            role: 'button',
            type: 'boolean',
            read: false,
            write: true,
            def: false,
        },
        write: { parameter: SIKU_PARAMETER_RESET_FILTER_TIMER, encode: encodeButtonPress, isButton: true },
    },
    {
        relativeId: 'control.boostOverrunMinutes',
        common: {
            name: 'Boost-Nachlauf',
            role: 'value.interval',
            type: 'number',
            unit: 'min',
            read: true,
            write: true,
            def: 0,
            min: 0,
            max: 60,
        },
        read: { parameter: SIKU_PARAMETER_BOOST_OVERRUN_MINUTES, decode: decodeUnsignedLE },
        write: {
            parameter: SIKU_PARAMETER_BOOST_OVERRUN_MINUTES,
            encode: value => encodeIntegerRange(value, 0, 60, 'Boost overrun minutes'),
        },
    },
    {
        relativeId: 'control.timeControlledOperation',
        common: {
            name: 'Zeitgesteuerter Betrieb',
            role: 'switch',
            type: 'boolean',
            read: true,
            write: true,
            def: false,
        },
        read: { parameter: SIKU_PARAMETER_TIME_CONTROLLED_OPERATION, decode: decodeBoolean },
        write: { parameter: SIKU_PARAMETER_TIME_CONTROLLED_OPERATION, encode: encodeBooleanSwitch },
    },
    {
        relativeId: 'info.operatingHoursMinutes',
        common: {
            name: 'Betriebsstunden (Minuten)',
            role: 'value.interval',
            type: 'number',
            unit: 'min',
            read: true,
            write: false,
        },
        read: { parameter: SIKU_PARAMETER_OPERATING_HOURS, decode: decodeOperatingHoursMinutes },
    },
    {
        relativeId: 'info.operatingHoursText',
        common: { name: 'Betriebsstunden', role: 'text', type: 'string', read: true, write: false, def: '' },
        read: { parameter: SIKU_PARAMETER_OPERATING_HOURS, decode: decodeOperatingHoursText },
    },
    {
        relativeId: 'diagnostics.resetAlarms',
        common: { name: 'Alarme zurücksetzen', role: 'button', type: 'boolean', read: false, write: true, def: false },
        write: { parameter: SIKU_PARAMETER_RESET_ALARMS, encode: encodeButtonPress, isButton: true },
    },
    {
        relativeId: 'diagnostics.alarmLevel',
        common: { name: 'Alarm-/Warnstufe', role: 'value', type: 'number', read: true, write: false },
        read: { parameter: SIKU_PARAMETER_ALARM_LEVEL, decode: decodeUnsignedLE },
    },
    {
        relativeId: 'info.firmwareVersion',
        common: { name: 'Firmware-Version', role: 'text', type: 'string', read: true, write: false, def: '' },
        read: { parameter: SIKU_PARAMETER_FIRMWARE_VERSION, decode: decodeFirmwareVersion },
    },
    {
        relativeId: 'diagnostics.filterChangeRequired',
        common: {
            name: 'Filterwechsel erforderlich',
            role: 'indicator.maintenance',
            type: 'boolean',
            read: true,
            write: false,
            def: false,
        },
        read: { parameter: SIKU_PARAMETER_FILTER_CHANGE_REQUIRED, decode: decodeBoolean },
    },
    {
        relativeId: 'control.fanMode',
        common: { name: 'Betriebsart', role: 'level.mode', type: 'number', read: true, write: true, def: 0 },
        read: { parameter: SIKU_PARAMETER_FAN_MODE, decode: decodeUnsignedLE },
        write: { parameter: SIKU_PARAMETER_FAN_MODE, encode: value => encodeIntegerRange(value, 0, 2, 'Fan mode') },
    },
    {
        relativeId: 'control.analogSensorSetpoint',
        common: {
            name: '0-10V-Sollwert',
            role: 'value',
            type: 'number',
            unit: '%',
            read: true,
            write: true,
            def: 5,
            min: 5,
            max: 100,
        },
        read: { parameter: SIKU_PARAMETER_ANALOG_SENSOR_SETPOINT, decode: decodeUnsignedLE },
        write: {
            parameter: SIKU_PARAMETER_ANALOG_SENSOR_SETPOINT,
            encode: value => encodeIntegerRange(value, 5, 100, 'Analog sensor setpoint'),
        },
    },
    {
        relativeId: 'timers.nightModeSetpointMinutes',
        common: {
            name: 'Nachtbetrieb',
            role: 'value.interval',
            type: 'number',
            unit: 'min',
            read: true,
            write: true,
            def: 0,
        },
        read: { parameter: SIKU_PARAMETER_NIGHT_TIMER_SETPOINT, decode: decodeTimerDurationMinutes },
        write: { parameter: SIKU_PARAMETER_NIGHT_TIMER_SETPOINT, encode: encodeTimerDurationMinutes },
    },
    {
        relativeId: 'timers.partyModeSetpointMinutes',
        common: {
            name: 'Partybetrieb',
            role: 'value.interval',
            type: 'number',
            unit: 'min',
            read: true,
            write: true,
            def: 0,
        },
        read: { parameter: SIKU_PARAMETER_PARTY_TIMER_SETPOINT, decode: decodeTimerDurationMinutes },
        write: { parameter: SIKU_PARAMETER_PARTY_TIMER_SETPOINT, encode: encodeTimerDurationMinutes },
    },
    {
        relativeId: 'sensors.humidityAboveSetpoint',
        common: {
            name: 'Feuchte über Sollwert',
            role: 'indicator',
            type: 'boolean',
            read: true,
            write: false,
            def: false,
        },
        read: { parameter: SIKU_PARAMETER_HUMIDITY_SENSOR_STATE, decode: decodeBoolean },
    },
    {
        relativeId: 'sensors.analogAboveSetpoint',
        common: {
            name: '0-10V über Sollwert',
            role: 'indicator',
            type: 'boolean',
            read: true,
            write: false,
            def: false,
        },
        read: { parameter: SIKU_PARAMETER_ANALOG_SENSOR_STATE, decode: decodeBoolean },
    },
] as const;

export const SIKU_POLL_PARAMETERS = Array.from(
    new Set(SIKU_STATE_DEFINITIONS.filter(definition => definition.read).map(definition => definition.read!.parameter)),
).sort((left, right) => left - right);

export const SIKU_WRITABLE_STATE_IDS = SIKU_STATE_DEFINITIONS.filter(definition => definition.write).map(
    definition => definition.relativeId,
);

export function getWritableStateDefinition(relativeId: string): SikuStateDefinition | undefined {
    return SIKU_STATE_DEFINITIONS.find(definition => definition.relativeId === relativeId && definition.write);
}

export function getStateDefinitionsByChannel(channelId: string): SikuStateDefinition[] {
    return SIKU_STATE_DEFINITIONS.filter(definition => definition.relativeId.startsWith(`${channelId}.`));
}

export function decodeMappedStateUpdates(packet: ParsedSikuPacket): SikuRelativeStateUpdate[] {
    const updates: SikuRelativeStateUpdate[] = [];

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
            value: definition.read.decode(value),
        });
    }

    return updates;
}

export function buildWriteRequestForState(relativeId: string, value: ioBroker.StateValue): SikuWriteRequestEntry {
    const definition = getWritableStateDefinition(relativeId);
    if (!definition?.write) {
        throw new Error(`State ${relativeId} is not writable`);
    }

    return {
        parameter: definition.write.parameter,
        value: definition.write.encode(value),
    };
}

export function isButtonState(relativeId: string): boolean {
    return Boolean(getWritableStateDefinition(relativeId)?.write?.isButton);
}
