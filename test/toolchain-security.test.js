'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

describe('Development dependency security regressions', () => {
    const root = path.join(__dirname, '..');

    // The removed HTML hot-reload stack has no supported fix for request/xmldom.
    // Inspect the lockfile, not just direct dependencies, to catch reintroduction.
    it('does not install the obsolete dev-server HTML injection stack', () => {
        const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
        const obsolete = ['@iobroker/dev-server', 'bs-html-injector', 'request', 'xmldom'];
        for (const id of Object.keys(lock.packages)) {
            for (const name of obsolete) {
                assert.ok(!id.endsWith(`/node_modules/${name}`) && id !== `node_modules/${name}`, `${id} is obsolete`);
            }
        }
    });

    // ioBroker/testing still names the old registration wrapper. Its scoped
    // replacement must support that module name and TS in a separate process.
    it('loads TypeScript through the ioBroker testing register with patched esbuild', () => {
        const testingRequire = createRequire(require.resolve('@iobroker/testing'));
        const register = testingRequire.resolve('@alcalzone/esbuild-register');
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'siku-register-'));
        try {
            const fixture = path.join(directory, 'fixture.ts');
            fs.writeFileSync(fixture, 'export enum Speed { Off = 0, Low = 1 }; export const answer: number = 42;\n');
            const result = execFileSync(
                process.execPath,
                ['-r', register, '-e',
                    'const value = require(process.argv[1]); process.stdout.write(JSON.stringify(value));', fixture],
                { cwd: root, encoding: 'utf8' },
            );
            assert.deepEqual(JSON.parse(result), { Speed: { 0: 'Off', 1: 'Low', Off: 0, Low: 1 }, answer: 42 });
            const registerRequire = createRequire(register);
            const [major, minor, patch] = registerRequire('esbuild/package.json').version.split('.').map(Number);
            assert.ok(major > 0 || minor > 25 || (minor === 25 && patch >= 12), 'esbuild must include the security fix');
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    // The upstream processinfo fix uses node:crypto instead of vulnerable uuid.
    // Exercise the real NYC consumer rather than forcing a uuid major override.
    it('keeps NYC process IDs working without the old uuid dependency', () => {
        const processInfoPath = require.resolve('istanbul-lib-processinfo');
        const processInfoRequire = createRequire(processInfoPath);
        assert.equal(processInfoRequire('./package.json').dependencies.uuid, undefined);
        const { ProcessInfo } = require(processInfoPath);
        const first = new ProcessInfo().uuid;
        assert.match(first, /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/u);
        assert.notEqual(first, new ProcessInfo().uuid);
    });
});
