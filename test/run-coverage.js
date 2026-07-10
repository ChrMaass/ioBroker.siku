"use strict";

const { spawnSync } = require("node:child_process");

const nycBinary = require.resolve("nyc/bin/nyc.js");
const result = spawnSync(
    process.execPath,
    [
        nycBinary,
        "--all",
        "--check-coverage",
        "--branches=40",
        "--functions=50",
        "--lines=50",
        "--statements=50",
        "--extension=.ts",
        "--require=ts-node/register",
        "--include=src/**/*.ts",
        "--exclude=src/**/*.test.ts",
        "--exclude=src/**/*.d.ts",
        "--reporter=text-summary",
        "--reporter=html",
        "npm",
        "run",
        "test:ts",
    ],
    {
        cwd: process.cwd(),
        env: {
            ...process.env,
            TS_NODE_FILES: "true",
            TS_NODE_PROJECT: "tsconfig.json",
        },
        stdio: "inherit",
        shell: process.platform === "win32",
    },
);

if (result.error) {
    throw result.error;
}

process.exitCode = result.status ?? 1;
