![Logo](admin/siku.svg)

# ioBroker.siku

[![NPM version](https://img.shields.io/npm/v/iobroker.siku.svg)](https://www.npmjs.com/package/iobroker.siku)
[![Downloads](https://img.shields.io/npm/dm/iobroker.siku.svg)](https://www.npmjs.com/package/iobroker.siku)
![Number of Installations](https://iobroker.live/badges/siku-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/siku-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.siku.png?downloads=true)](https://nodei.co/npm/iobroker.siku/)

**Tests:** ![Test and Release](https://github.com/ChrMaass/ioBroker.siku/workflows/Test%20and%20Release/badge.svg)

## Overview

This adapter integrates **SIKU RV V2** residential ventilation devices into ioBroker.

The current repository state targets a feature-complete **public beta** for local-network operation and the official ioBroker `latest` intake.

## Features

- UDP communication based on the documented manufacturer protocol
- Multi-device support in **one** adapter instance
- Broadcast discovery in the local network
- JSON config based admin page for multiple devices
- Separate RTC time check every 24 hours by default
- Time synchronization only when the configured drift threshold is exceeded
- State-based control for the main operating parameters
- Full weekly schedule mapping via ioBroker states
- Localized enum labels for fan mode and timer mode
- Readable local timestamp companion states for poll and discovery timestamps
- Encrypted and protected storage of configured device passwords

## Supported core functions

- Discovery of master devices via broadcast (`0x007C`, `0x00B9`)
- Management of multiple devices by stable device IDs
- Polling of status, sensor and diagnostic values
- Writing of central parameters via states, for example:
  - power
  - fan speed
  - manual fan speed
  - fan mode
  - timer mode
  - humidity setpoint
  - sensor enable flags
- Weekly schedule structure such as:
  - `schedule.monday.p1.speed`
  - `schedule.monday.p1.endHour`
  - `schedule.monday.p1.endMinute`
  - ... up to `schedule.sunday.p4.*`
- Diagnostic values such as:
  - filter countdown
  - operating hours
  - alarm level
  - filter replacement indication
  - last discovery / last poll / last time check

## Device references

The adapter is built for the SIKU RV V2 family such as **SIKU RV 50 W Pro WiFi V2** and related devices in the same protocol family.

- Manufacturer product page: [SIKU RV 50 W Pro WiFi V2](https://www.siku.at/SIKU-RV-50-W-Pro-WiFi-V2/50523)
- Manufacturer overview: [SIKU products](https://www.siku.at/en/products/)
- Official mobile app description: [SIKU RV WIFI on the App Store](https://apps.apple.com/at/app/siku-rv-wifi/id1444515926)

## Development

Useful scripts:

| Script               | Purpose                                        |
| -------------------- | ---------------------------------------------- |
| `npm run build`      | Compile the TypeScript sources                 |
| `npm run check`      | Run type checking without building             |
| `npm run lint`       | Run ESLint                                     |
| `npm run test`       | Run unit and package tests                     |
| `npm run coverage`   | Generate test coverage for TypeScript tests    |
| `npm run dev-server` | Start a local ioBroker development environment |
| `npm run release`    | Create an official release/tag via release-tooling |

The adapter was generated with the official ioBroker tooling and is developed in TypeScript.

## CI / CD

- Pull requests run a lean Ubuntu smoke test after linting and type-checking.
- `main` runs the release-relevant Linux/macOS matrix.
- Windows runs in a separate scheduled/manual regression workflow because the ioBroker controller bootstrap is significantly slower there.
- Patch versions can be bumped automatically on successful `main` runs via `.github/workflows/auto-patch-release.yml`.

## Publication readiness

A short release and repository checklist is available in [RELEASING.md](RELEASING.md).

## Beta notes

- Discovery, polling, time checks and schedule reads have already been validated against multiple real devices.
- Live write tests have intentionally been kept conservative.
- Network/service functions such as Wi-Fi reconfiguration, password changes or factory reset are intentionally not exposed as normal writable states.

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

- Prepared the adapter for ioBroker `latest` intake with encrypted config handling and cleaner CI job separation
- Added a dedicated Windows regression workflow and a clearer public beta versioning baseline

### 0.1.0 (2026-04-17)

- First public beta with ioBroker publication hardening, encrypted device passwords and streamlined CI
- Added protected/encrypted native device password handling for JSON-config table rows
- Split slow Windows adapter tests into a dedicated regression workflow
- Improved publication metadata, title handling and patch-version release preparation

Older changelog entries are available in [CHANGELOG_OLD.md](CHANGELOG_OLD.md).

## License

MIT License

Copyright (c) 2026 Christian Maaß <christian@maass.it>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
