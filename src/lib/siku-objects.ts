import { getLocalizedEnumStates } from './siku-display';
import { getScheduleDayDefinitions, getScheduleStateDefinitions } from './siku-schedule';
import { getStateDefinitionsByChannel } from './siku-state-mapping';
import type { SikuRuntimeDeviceConfig } from './siku-runtime';

interface ObjectWriter {
    extendObjectAsync(id: string, object: ioBroker.PartialObject): Promise<unknown>;
}

interface StateDefinition {
    id: string;
    common: Partial<ioBroker.StateCommon>;
}

function localizedCommon(
    relativeId: string,
    common: Partial<ioBroker.StateCommon>,
    language: string | undefined,
): Partial<ioBroker.StateCommon> {
    const states = getLocalizedEnumStates(relativeId, language);
    return states ? { ...common, states } : common;
}

function timestampStates(prefix: string, relativeId: string, name: string): StateDefinition[] {
    return [
        {
            id: `${prefix}.${relativeId}`,
            common: { name: `${name} (UTC)`, role: 'text', type: 'string', read: true, write: false, def: '' },
        },
        {
            id: `${prefix}.${relativeId}Local`,
            common: { name: `${name} (local)`, role: 'text', type: 'string', read: true, write: false, def: '' },
        },
    ];
}

function buildStaticStateDefinitions(prefix: string): StateDefinition[] {
    return [
        {
            id: `${prefix}.info.connection`,
            common: {
                name: 'Connected',
                role: 'indicator.connected',
                type: 'boolean',
                read: true,
                write: false,
                def: false,
            },
        },
        {
            id: `${prefix}.info.host`,
            common: { name: 'Host', role: 'text', type: 'string', read: true, write: false, def: '' },
        },
        {
            id: `${prefix}.info.name`,
            common: { name: 'Name', role: 'text', type: 'string', read: true, write: false, def: '' },
        },
        {
            id: `${prefix}.info.deviceId`,
            common: {
                name: 'Configured device ID',
                role: 'text',
                type: 'string',
                read: true,
                write: false,
                def: '',
            },
        },
        {
            id: `${prefix}.info.configuredType`,
            common: { name: 'Configured type', role: 'text', type: 'string', read: true, write: false, def: '' },
        },
        {
            id: `${prefix}.info.deviceTypeCode`,
            common: { name: 'Device type code', role: 'value', type: 'number', read: true, write: false },
        },
        {
            id: `${prefix}.info.deviceTypeHex`,
            common: { name: 'Device type hex', role: 'text', type: 'string', read: true, write: false, def: '' },
        },
        {
            id: `${prefix}.info.ipAddress`,
            common: {
                name: 'Reported IP address',
                role: 'info.ip',
                type: 'string',
                read: true,
                write: false,
                def: '',
            },
        },
        {
            id: `${prefix}.info.enabled`,
            common: { name: 'Enabled', role: 'indicator', type: 'boolean', read: true, write: false, def: false },
        },
        {
            id: `${prefix}.diagnostics.reportedDeviceId`,
            common: {
                name: 'Last reported device ID',
                role: 'text',
                type: 'string',
                read: true,
                write: false,
                def: '',
            },
        },
        {
            id: `${prefix}.diagnostics.clockDriftSec`,
            common: {
                name: 'Clock drift',
                role: 'value.interval',
                unit: 's',
                type: 'number',
                read: true,
                write: false,
                def: 0,
            },
        },
        {
            id: `${prefix}.diagnostics.lastError`,
            common: { name: 'Last error', role: 'text', type: 'string', read: true, write: false, def: '' },
        },
        {
            id: `${prefix}.diagnostics.pollDurationMs`,
            common: {
                name: 'Poll duration',
                role: 'value.interval',
                unit: 'ms',
                type: 'number',
                read: true,
                write: false,
                def: 0,
            },
        },
        ...timestampStates(prefix, 'info.lastSeen', 'Last seen'),
        ...timestampStates(prefix, 'info.lastPoll', 'Last poll attempt'),
        ...timestampStates(prefix, 'diagnostics.lastSuccessfulPoll', 'Last successful poll'),
        ...timestampStates(prefix, 'diagnostics.lastDiscovery', 'Last discovery'),
        ...timestampStates(prefix, 'diagnostics.lastScheduleRead', 'Last schedule read'),
        ...timestampStates(prefix, 'diagnostics.lastTimeCheck', 'Last time check'),
        ...timestampStates(prefix, 'diagnostics.lastTimeSync', 'Last time sync'),
        ...timestampStates(prefix, 'timers.timerModeChangedAt', 'Last timer mode change'),
    ];
}

/**
 * Creates the complete device/channel/state hierarchy in checker-compatible order.
 *
 * @param adapter - Minimal ioBroker object writer
 * @param device - Normalized runtime device configuration
 * @param language - Active ioBroker UI language for enum labels
 */
export async function ensureSikuDeviceObjects(
    adapter: ObjectWriter,
    device: SikuRuntimeDeviceConfig,
    language: string | undefined,
): Promise<void> {
    const prefix = device.objectId;

    await adapter.extendObjectAsync(prefix, {
        type: 'device',
        common: { name: device.name },
        native: { deviceId: device.id },
    });

    const channels = [
        { id: 'info', name: 'Information' },
        { id: 'control', name: 'Control' },
        { id: 'sensors', name: 'Sensors' },
        { id: 'timers', name: 'Timers' },
        { id: 'schedule', name: 'Schedules' },
        { id: 'diagnostics', name: 'Diagnostics' },
    ];
    for (const channel of channels) {
        await adapter.extendObjectAsync(`${prefix}.${channel.id}`, {
            type: 'channel',
            common: { name: channel.name },
            native: {},
        });
    }

    for (const day of getScheduleDayDefinitions()) {
        await adapter.extendObjectAsync(`${prefix}.schedule.${day.key}`, {
            type: 'channel',
            common: { name: day.name },
            native: {},
        });
        for (const period of [1, 2, 3, 4]) {
            await adapter.extendObjectAsync(`${prefix}.schedule.${day.key}.p${period}`, {
                type: 'channel',
                common: { name: `Period ${period}` },
                native: {},
            });
        }
    }

    const states = buildStaticStateDefinitions(prefix);
    for (const channelId of ['info', 'control', 'sensors', 'timers', 'diagnostics']) {
        for (const definition of getStateDefinitionsByChannel(channelId)) {
            states.push({
                id: `${prefix}.${definition.relativeId}`,
                common: localizedCommon(definition.relativeId, definition.common, language),
            });
        }
    }
    for (const definition of getScheduleStateDefinitions()) {
        states.push({ id: `${prefix}.${definition.relativeId}`, common: definition.common });
    }

    for (const state of states) {
        await adapter.extendObjectAsync(state.id, { type: 'state', common: state.common, native: {} });
    }
}
