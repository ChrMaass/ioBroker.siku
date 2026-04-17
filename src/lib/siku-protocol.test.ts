import { expect } from 'chai';
import {
    buildDiscoveryPacket,
    buildPacket,
    buildReadPayload,
    decodeAscii,
    decodeUnsignedLE,
    parsePacket,
    toHex,
} from './siku-protocol';
import { SikuFunction } from './siku-constants';

describe('SIKU protocol helpers', () => {
    it('builds the broadcast discovery packet from the validated live sample', () => {
        const packet = buildDiscoveryPacket();

        expect(toHex(packet)).to.equal('FDFD021044454641554C545F44455649434549440431313131017CB9B106');
    });

    it('builds the PDF request example with a zeroed device id correctly', () => {
        const packet = buildPacket(Buffer.alloc(16), '1111', SikuFunction.Read, Buffer.from([0x01, 0x02]));

        expect(toHex(packet)).to.equal('FDFD0210000000000000000000000000000000000431313131010102DE00');
    });

    it('builds an extended read payload for the schedule selector', () => {
        const payload = buildReadPayload([{ parameter: 0x0077, requestValue: [0x01, 0x01] }]);

        expect(toHex(payload)).to.equal('FE02770101');
    });

    it('rejects invalid byte arrays before they are normalized into buffers', () => {
        expect(() => buildReadPayload([{ parameter: 0x0077, requestValue: [0x01, 0x100] }])).to.throw(
            'Invalid byte value 256',
        );
    });

    it('parses the PDF response example with two single-byte values', () => {
        const packet = Buffer.from('FDFD02100000000000000000000000000000000004313131310601000203E600', 'hex');
        const parsed = parsePacket(packet);

        expect(parsed.checksumValid).to.equal(true);
        expect(parsed.functionCode).to.equal(SikuFunction.Response);
        expect(parsed.entries).to.have.length(2);
        expect(parsed.entries[0].parameter).to.equal(0x0001);
        expect(parsed.entries[0].value[0]).to.equal(0x00);
        expect(parsed.entries[1].parameter).to.equal(0x0002);
        expect(parsed.entries[1].value[0]).to.equal(0x03);
    });

    it('parses the PDF sample with page switches and an unsupported parameter', () => {
        const packet = buildPacket(
            Buffer.alloc(16),
            '1111',
            SikuFunction.Response,
            Buffer.from([0xff, 0x01, 0xfd, 0x01, 0x04, 0x05, 0xff, 0x02, 0xfe, 0x02, 0x40, 0x51, 0x68]),
        );
        const parsed = parsePacket(packet);

        expect(parsed.checksumValid).to.equal(true);
        expect(parsed.entries).to.have.length(3);
        expect(parsed.entries[0]).to.deep.include({ parameter: 0x0101, unsupported: true, size: 0 });
        expect(parsed.entries[1].parameter).to.equal(0x0104);
        expect(parsed.entries[1].value[0]).to.equal(0x05);
        expect(parsed.entries[2].parameter).to.equal(0x0240);
        expect(toHex(parsed.entries[2].value)).to.equal('5168');
    });

    it('rejects malformed marker payloads before they can consume checksum bytes', () => {
        const malformedPacket = buildPacket(Buffer.alloc(16), '1111', SikuFunction.Response, Buffer.from([0xfd]));

        expect(() => parsePacket(malformedPacket)).to.throw(
            'Packet ended while parsing an unsupported-parameter marker',
        );
    });

    it('rejects truncated device identifiers in incoming packets', () => {
        const packet = Buffer.from('FDFD020F303031383030333534333533353330420431313131067CB9D006', 'hex');

        expect(() => parsePacket(packet)).to.throw('Invalid device ID length: 15');
    });

    it('parses a captured discovery response from the live network correctly', () => {
        const packet = Buffer.from(
            'FDFD0210303031383030333534333533353330420006FE02B90E00FE107C30303138303033353433353335333042DD09',
            'hex',
        );
        const parsed = parsePacket(packet);
        const typeEntry = parsed.entries.find(entry => entry.parameter === 0x00b9);
        const idEntry = parsed.entries.find(entry => entry.parameter === 0x007c);

        expect(parsed.checksumValid).to.equal(true);
        expect(parsed.deviceIdText).to.equal('001800354353530B');
        expect(typeEntry).to.not.equal(undefined);
        expect(idEntry).to.not.equal(undefined);
        expect(decodeUnsignedLE(typeEntry!.value)).to.equal(14);
        expect(decodeAscii(idEntry!.value)).to.equal('001800354353530B');
    });
});
