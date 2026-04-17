import { SIKU_PARAMETER_SCHEDULE } from './siku-constants';
import type { SikuRelativeStateUpdate } from './siku-state-mapping';
import type { ParsedSikuPacket, SikuReadRequestEntry, SikuWriteRequestEntry } from './siku-protocol';

export type SikuScheduleDayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type SikuScheduleField = 'speed' | 'endHour' | 'endMinute';

interface SikuScheduleDayDefinition {
    key: SikuScheduleDayKey;
    number: number;
    name: string;
}

export interface SikuScheduleStateDefinition {
    relativeId: string;
    dayKey: SikuScheduleDayKey;
    dayNumber: number;
    periodNumber: number;
    field: SikuScheduleField;
    common: Partial<ioBroker.StateCommon>;
}

const SIKU_SCHEDULE_DAYS: readonly SikuScheduleDayDefinition[] = [
    { key: 'monday', number: 1, name: 'Montag' },
    { key: 'tuesday', number: 2, name: 'Dienstag' },
    { key: 'wednesday', number: 3, name: 'Mittwoch' },
    { key: 'thursday', number: 4, name: 'Donnerstag' },
    { key: 'friday', number: 5, name: 'Freitag' },
    { key: 'saturday', number: 6, name: 'Samstag' },
    { key: 'sunday', number: 7, name: 'Sonntag' },
] as const;

const SIKU_SCHEDULE_PERIODS = [1, 2, 3, 4] as const;

function buildScheduleStateDefinitions(): SikuScheduleStateDefinition[] {
    const definitions: SikuScheduleStateDefinition[] = [];

    for (const day of SIKU_SCHEDULE_DAYS) {
        for (const periodNumber of SIKU_SCHEDULE_PERIODS) {
            const baseRelativeId = `schedule.${day.key}.p${periodNumber}`;

            definitions.push(
                {
                    relativeId: `${baseRelativeId}.speed`,
                    dayKey: day.key,
                    dayNumber: day.number,
                    periodNumber,
                    field: 'speed',
                    common: {
                        name: `${day.name} Periode ${periodNumber} - Lüfterstufe`,
                        role: 'level.speed',
                        type: 'number',
                        read: true,
                        write: true,
                        min: 0,
                        max: 3,
                        def: 0,
                    },
                },
                {
                    relativeId: `${baseRelativeId}.endHour`,
                    dayKey: day.key,
                    dayNumber: day.number,
                    periodNumber,
                    field: 'endHour',
                    common: {
                        name: `${day.name} Periode ${periodNumber} - Endstunde`,
                        role: 'value',
                        type: 'number',
                        read: true,
                        write: true,
                        min: 0,
                        max: 23,
                        def: 0,
                    },
                },
                {
                    relativeId: `${baseRelativeId}.endMinute`,
                    dayKey: day.key,
                    dayNumber: day.number,
                    periodNumber,
                    field: 'endMinute',
                    common: {
                        name: `${day.name} Periode ${periodNumber} - Endminute`,
                        role: 'value',
                        type: 'number',
                        read: true,
                        write: true,
                        min: 0,
                        max: 59,
                        def: 0,
                    },
                },
            );
        }
    }

    return definitions;
}

const SIKU_SCHEDULE_STATE_DEFINITIONS_INTERNAL = buildScheduleStateDefinitions();
const SIKU_SCHEDULE_STATE_DEFINITION_MAP = new Map(
    SIKU_SCHEDULE_STATE_DEFINITIONS_INTERNAL.map(definition => [definition.relativeId, definition]),
);

function getScheduleDayByNumber(dayNumber: number): SikuScheduleDayDefinition | undefined {
    return SIKU_SCHEDULE_DAYS.find(day => day.number === dayNumber);
}

function parseScheduleEntryValue(value: Buffer): {
    day: SikuScheduleDayDefinition;
    periodNumber: number;
    speed: number;
    endMinute: number;
    endHour: number;
} | null {
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
        endHour: value[5],
    };
}

function validateScheduleInteger(
    value: ioBroker.StateValue,
    minimum: number,
    maximum: number,
    fieldName: string,
): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${fieldName} must be an integer between ${minimum} and ${maximum}`);
    }

    return value;
}

export const SIKU_SCHEDULE_STATE_DEFINITIONS = SIKU_SCHEDULE_STATE_DEFINITIONS_INTERNAL;
export const SIKU_SCHEDULE_WRITABLE_STATE_IDS = SIKU_SCHEDULE_STATE_DEFINITIONS_INTERNAL.map(
    definition => definition.relativeId,
);

export function getScheduleStateDefinition(relativeId: string): SikuScheduleStateDefinition | undefined {
    return SIKU_SCHEDULE_STATE_DEFINITION_MAP.get(relativeId);
}

export function getScheduleStateDefinitions(): SikuScheduleStateDefinition[] {
    return [...SIKU_SCHEDULE_STATE_DEFINITIONS_INTERNAL];
}

export function getScheduleDayDefinitions(): Array<{ key: SikuScheduleDayKey; name: string }> {
    return SIKU_SCHEDULE_DAYS.map(day => ({ key: day.key, name: day.name }));
}

export function isScheduleStateId(relativeId: string): boolean {
    return SIKU_SCHEDULE_STATE_DEFINITION_MAP.has(relativeId);
}

export function buildScheduleReadRequests(): SikuReadRequestEntry[] {
    return SIKU_SCHEDULE_DAYS.flatMap(day =>
        SIKU_SCHEDULE_PERIODS.map(periodNumber => ({
            parameter: SIKU_PARAMETER_SCHEDULE,
            valueSize: 2,
            requestValue: Buffer.from([day.number, periodNumber]),
        })),
    );
}

export function decodeScheduleUpdates(packet: ParsedSikuPacket): SikuRelativeStateUpdate[] {
    const updates: SikuRelativeStateUpdate[] = [];

    for (const entry of packet.entries) {
        if (entry.parameter !== SIKU_PARAMETER_SCHEDULE || entry.unsupported) {
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
            { relativeId: `${baseRelativeId}.endMinute`, value: parsed.endMinute },
        );
    }

    return updates;
}

export function getScheduleSnapshotStateIds(relativeId: string): string[] {
    const definition = getScheduleStateDefinition(relativeId);
    if (!definition) {
        return [];
    }

    const baseRelativeId = `schedule.${definition.dayKey}.p${definition.periodNumber}`;
    return [`${baseRelativeId}.speed`, `${baseRelativeId}.endHour`, `${baseRelativeId}.endMinute`];
}

export function buildScheduleWriteRequest(
    relativeId: string,
    values: Record<string, ioBroker.StateValue>,
): SikuWriteRequestEntry {
    const definition = getScheduleStateDefinition(relativeId);
    if (!definition) {
        throw new Error(`State ${relativeId} is not a schedule state`);
    }

    const baseRelativeId = `schedule.${definition.dayKey}.p${definition.periodNumber}`;
    const speed = validateScheduleInteger(values[`${baseRelativeId}.speed`], 0, 3, 'Schedule speed');
    const endHour = validateScheduleInteger(values[`${baseRelativeId}.endHour`], 0, 23, 'Schedule end hour');
    const endMinute = validateScheduleInteger(values[`${baseRelativeId}.endMinute`], 0, 59, 'Schedule end minute');

    return {
        parameter: SIKU_PARAMETER_SCHEDULE,
        value: Buffer.from([definition.dayNumber, definition.periodNumber, speed, 0x00, endMinute, endHour]),
    };
}
