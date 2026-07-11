"use strict";

const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const { evaluateAutoRelease } = require("../.github/scripts/auto-release-policy.cjs");

function createInput(overrides = {}) {
    return {
        changedFiles: [],
        beforePackage: { version: "0.1.8", dependencies: { runtime: "1.0.0" }, devDependencies: { test: "1.0.0" } },
        currentPackage: { version: "0.1.8", dependencies: { runtime: "1.0.0" }, devDependencies: { test: "1.0.0" } },
        beforeIoPackage: { common: { version: "0.1.8", news: { "0.1.8": {} }, tier: 3 } },
        currentIoPackage: { common: { version: "0.1.8", news: { "0.1.8": {} }, tier: 3 } },
        subject: "feat: improve adapter",
        ...overrides,
    };
}

describe("Automatic patch release policy", () => {
    it("keeps CI output handling compatible with compact mode", () => {
        const script = fs.readFileSync(
            path.join(__dirname, "..", ".github/scripts/auto-release-policy.cjs"),
            "utf8",
        );
        const workflow = fs.readFileSync(
            path.join(__dirname, "..", ".github/workflows/auto-patch-release.yml"),
            "utf8",
        );

        expect(script).to.not.include("process.env");
        expect(workflow).to.include('--output "$policy_output"');
    });

    it("uses the recommended deployment action major version", () => {
        const workflow = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/test-and-release.yml"), "utf8");

        expect(workflow).to.include("ioBroker/testing-action-deploy@v1");
        expect(workflow).to.not.include("ioBroker/testing-action-deploy@v1.");
    });

    it("persists the changelog placeholder generated after the release commit", () => {
        const workflow = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/auto-patch-release.yml"), "utf8");

        expect(workflow).to.include("Persist the generated changelog placeholder");
        expect(workflow).to.include("git diff --quiet -- README.md");
        expect(workflow).to.include('git commit -m "docs: restore changelog placeholder"');
    });

    it("recovers pending runtime changes after a failed automatic release", () => {
        const workflow = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/auto-patch-release.yml"), "utf8");

        expect(workflow).to.include("release_tag=\"v$(node -p 'require(\"./package.json\").version')\"");
        expect(workflow).to.include("git fetch origin main --tags");
        expect(workflow).to.include('git rev-list -n 1 "$release_tag"');
        expect(workflow).to.include('echo "Auto-release comparison base: $release_base ($release_tag)"');
        expect(workflow).to.include('auto-release-policy.cjs --base "$release_base"');
    });

    it("releases runtime source changes", () => {
        expect(evaluateAutoRelease(createInput({ changedFiles: ["src/main.ts"] })).shouldRelease).to.equal(true);
        expect(evaluateAutoRelease(createInput({ changedFiles: ["build/main.js"] })).shouldRelease).to.equal(true);
    });

    it("releases runtime dependency changes but not development-only updates", () => {
        const runtime = createInput({
            changedFiles: ["package.json", "package-lock.json"],
            currentPackage: { version: "0.1.8", dependencies: { runtime: "1.1.0" }, devDependencies: { test: "1.0.0" } },
        });
        expect(evaluateAutoRelease(runtime).shouldRelease).to.equal(true);

        const development = createInput({
            changedFiles: ["package.json", "package-lock.json"],
            currentPackage: { version: "0.1.8", dependencies: { runtime: "1.0.0" }, devDependencies: { test: "1.1.0" } },
        });
        expect(evaluateAutoRelease(development).shouldRelease).to.equal(false);
    });

    it("ignores release-managed news changes and manual releases", () => {
        const newsOnly = createInput({
            changedFiles: ["io-package.json"],
            currentIoPackage: { common: { version: "0.1.8", news: { "0.1.8": { en: "Changed" } }, tier: 3 } },
        });
        expect(evaluateAutoRelease(newsOnly).shouldRelease).to.equal(false);

        const manualRelease = createInput({
            changedFiles: ["src/main.ts", "package.json", "io-package.json"],
            currentPackage: { version: "0.2.0", dependencies: { runtime: "1.0.0" } },
            currentIoPackage: { common: { version: "0.2.0", news: {}, tier: 3 } },
        });
        expect(evaluateAutoRelease(manualRelease).shouldRelease).to.equal(false);
    });

    it("skips documentation, tests and workflow-only changes", () => {
        const result = evaluateAutoRelease(
            createInput({ changedFiles: ["README.md", "test/package.js", ".github/workflows/test-and-release.yml"] }),
        );
        expect(result.shouldRelease).to.equal(false);
    });
});
