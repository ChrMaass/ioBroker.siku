import { expect } from 'chai';
import { formatLocalTimestamp, getLocalizedEnumStates, getLocalizedModeLabel } from './siku-display';

describe('SIKU display helpers', () => {
    it('returns localized enum labels for fan mode and timer mode', () => {
        expect(getLocalizedEnumStates('control.fanMode', 'de')).to.deep.equal({
            0: 'Lüften',
            1: 'Wärmerückgewinnung',
            2: 'Luftzufuhr',
        });
        expect(getLocalizedEnumStates('control.timerMode', 'en')).to.deep.equal({
            0: 'Off',
            1: 'Night mode',
            2: 'Party mode',
        });
        expect(getLocalizedModeLabel('control.fanMode', 1, 'de')).to.equal('Wärmerückgewinnung');
        expect(getLocalizedModeLabel('control.timerMode', 2, 'en')).to.equal('Party mode');
        expect(getLocalizedModeLabel('control.timerMode', '2', 'en')).to.equal(undefined);
    });

    it('formats ISO timestamps in the current locale instead of leaving them in UTC ISO notation', () => {
        const formatted = formatLocalTimestamp('2026-04-17T08:15:32.000Z', 'de');

        expect(formatted).to.not.equal('2026-04-17T08:15:32.000Z');
        expect(formatted).to.include('17');
        expect(formatted).to.match(/2026/u);
    });

    it('falls back gracefully for unsupported languages and invalid timestamps', () => {
        expect(getLocalizedModeLabel('control.fanMode', 0, 'sv')).to.equal('Ventilation');
        expect(formatLocalTimestamp('invalid-timestamp', 'de')).to.equal('invalid-timestamp');
        expect(getLocalizedEnumStates('control.unknown', 'de')).to.equal(undefined);
    });
});
