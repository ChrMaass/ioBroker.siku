'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const RUNTIME_PACKAGE_FIELDS = ['dependencies', 'engines', 'files', 'main', 'name', 'os', 'cpu'];

function stableJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function differs(left, right) {
    return stableJson(left) !== stableJson(right);
}

function stripReleaseManagedIoPackageFields(ioPackage) {
    const copy = structuredClone(ioPackage);
    if (copy.common) {
        delete copy.common.version;
        delete copy.common.news;
    }
    return copy;
}

function evaluateAutoRelease({
    changedFiles,
    beforePackage,
    currentPackage,
    beforeIoPackage,
    currentIoPackage,
    subject,
}) {
    if (/^chore: release v\d+\.\d+\.\d+/.test(subject)) {
        return { shouldRelease: false, reason: 'release commit detected' };
    }

    if (
        beforePackage?.version !== currentPackage?.version ||
        beforeIoPackage?.common?.version !== currentIoPackage?.common?.version
    ) {
        return { shouldRelease: false, reason: 'version changed manually' };
    }

    if (
        changedFiles.some(
            file =>
                file.startsWith('src/') || file.startsWith('build/') || file.startsWith('admin/') || file === 'main.js',
        )
    ) {
        return { shouldRelease: true, reason: 'runtime source or admin assets changed' };
    }

    if (
        changedFiles.includes('io-package.json') &&
        differs(
            stripReleaseManagedIoPackageFields(beforeIoPackage),
            stripReleaseManagedIoPackageFields(currentIoPackage),
        )
    ) {
        return { shouldRelease: true, reason: 'runtime adapter metadata changed' };
    }

    if (
        changedFiles.includes('package.json') &&
        RUNTIME_PACKAGE_FIELDS.some(field => differs(beforePackage?.[field], currentPackage?.[field]))
    ) {
        return { shouldRelease: true, reason: 'runtime package metadata or dependencies changed' };
    }

    return { shouldRelease: false, reason: 'only tests, documentation, workflows or development dependencies changed' };
}

function readJsonAtRevision(revision, file) {
    return JSON.parse(execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' }));
}

function writeGithubOutput(result, output) {
    if (!output) {
        return;
    }
    fs.appendFileSync(output, `should_release=${String(result.shouldRelease)}\nreason=${result.reason}\n`);
}

function runCli() {
    const baseIndex = process.argv.indexOf('--base');
    const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined;
    const outputIndex = process.argv.indexOf('--output');
    const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
    if (!base) {
        throw new Error(
            'Usage: node .github/scripts/auto-release-policy.cjs --base <git-revision> [--output <output-file>]',
        );
    }

    const changedFiles = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' })
        .split(/\r?\n/u)
        .filter(Boolean);
    const result = evaluateAutoRelease({
        changedFiles,
        beforePackage: readJsonAtRevision(base, 'package.json'),
        currentPackage: require('../../package.json'),
        beforeIoPackage: readJsonAtRevision(base, 'io-package.json'),
        currentIoPackage: require('../../io-package.json'),
        subject: execFileSync('git', ['log', '-1', '--pretty=%s'], { encoding: 'utf8' }).trim(),
    });

    console.log(`${result.shouldRelease ? 'release' : 'skip'}: ${result.reason}`);
    writeGithubOutput(result, output);
}

module.exports = { evaluateAutoRelease, stripReleaseManagedIoPackageFields };

if (require.main === module) {
    runCli();
}
