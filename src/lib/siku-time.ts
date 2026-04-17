import { SIKU_PARAMETER_RTC_CALENDAR, SIKU_PARAMETER_RTC_TIME } from './siku-constants';
import type { ParsedSikuPacket, SikuPacketEntry } from './siku-protocol';

export interface SikuRtcSnapshot {
    deviceDate: Date;
    timeValue: Buffer;
    calendarValue: Buffer;
}

function getPacketEntry(packet: ParsedSikuPacket, parameter: number): SikuPacketEntry | undefined {
    return packet.entries.find(entry => entry.parameter === parameter && !entry.unsupported);
}

function ensureRange(value: number, minimum: number, maximum: number, fieldName: string): void {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${fieldName} must be between ${minimum} and ${maximum}`);
    }
}

/**
 * Encodes the RTC time parameter (0x006F) from a JavaScript Date object.
 *
 * @param date - Local system time that should be written to the device
 */
export function encodeRtcTime(date: Date): Buffer {
    return Buffer.from([date.getSeconds(), date.getMinutes(), date.getHours()]);
}

/**
 * Encodes the RTC calendar parameter (0x0070) from a JavaScript Date object.
 *
 * @param date - Local system time that should be written to the device
 */
export function encodeRtcCalendar(date: Date): Buffer {
    return Buffer.from([date.getDate(), getSikuWeekday(date), date.getMonth() + 1, date.getFullYear() % 100]);
}

/**
 * Converts the JavaScript weekday (0=Sunday) to the protocol weekday (1=Monday, 7=Sunday).
 *
 * @param date - Date to convert
 */
export function getSikuWeekday(date: Date): number {
    return ((date.getDay() + 6) % 7) + 1;
}

/**
 * Decodes the RTC time/calendar payloads from the device into a JavaScript Date object.
 *
 * @param timeValue - Raw payload of parameter 0x006F
 * @param calendarValue - Raw payload of parameter 0x0070
 */
export function decodeRtcDate(timeValue: Buffer, calendarValue: Buffer): Date {
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

    ensureRange(seconds, 0, 59, 'RTC seconds');
    ensureRange(minutes, 0, 59, 'RTC minutes');
    ensureRange(hours, 0, 23, 'RTC hours');
    ensureRange(day, 1, 31, 'RTC day');
    ensureRange(weekday, 1, 7, 'RTC weekday');
    ensureRange(month, 1, 12, 'RTC month');
    ensureRange(year, 0, 99, 'RTC year');

    const date = new Date(2000, month - 1, day, hours, minutes, seconds, 0);
    date.setFullYear(2000 + year);

    if (
        date.getFullYear() !== 2000 + year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day ||
        date.getHours() !== hours ||
        date.getMinutes() !== minutes ||
        date.getSeconds() !== seconds
    ) {
        throw new Error('RTC date payload does not represent a valid calendar date');
    }

    return date;
}

/**
 * Extracts the RTC snapshot from a packet that contains parameters 0x006F and 0x0070.
 *
 * @param packet - Parsed device response packet
 */
export function decodeRtcSnapshot(packet: ParsedSikuPacket): SikuRtcSnapshot {
    const timeEntry = getPacketEntry(packet, SIKU_PARAMETER_RTC_TIME);
    if (!timeEntry) {
        throw new Error('Device response did not contain RTC time (0x006F)');
    }

    const calendarEntry = getPacketEntry(packet, SIKU_PARAMETER_RTC_CALENDAR);
    if (!calendarEntry) {
        throw new Error('Device response did not contain RTC calendar (0x0070)');
    }

    return {
        deviceDate: decodeRtcDate(timeEntry.value, calendarEntry.value),
        timeValue: Buffer.from(timeEntry.value),
        calendarValue: Buffer.from(calendarEntry.value),
    };
}

/**
 * Returns the signed difference in seconds between the reference time and the device time.
 * A positive value means the device is behind the system time.
 *
 * @param deviceDate - Timestamp reported by the ventilation device
 * @param referenceDate - Current local system time
 */
export function calculateClockDriftSeconds(deviceDate: Date, referenceDate: Date): number {
    return Math.round((referenceDate.getTime() - deviceDate.getTime()) / 1000);
}
