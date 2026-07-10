const path = require('path');
const fs = require('fs');
const { expect } = require('chai');
const { tests } = require('@iobroker/testing');

// Validate the package files
tests.packageFiles(path.join(__dirname, '..'));

describe('SIKU package hardening metadata', () => {
    const repositoryRoot = path.join(__dirname, '..');
    const ioPackage = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'io-package.json'), 'utf8'));

    it('decrypts nested password table values and limits one instance per host', () => {
        expect(ioPackage.encryptedNative).to.include('devicePasswords.password');
        expect(ioPackage.encryptedNative).to.not.include('devicePasswords');
        expect(ioPackage.protectedNative).to.include('devicePasswords');
        expect(ioPackage.common.singletonHost).to.equal(true);
    });
});

require('./auto-release-policy.test.js');
