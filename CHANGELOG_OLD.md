# Older changelog entries
## 0.1.6 (2026-06-05)

- Aligned the ioBroker object hierarchy and writable state roles with the Object-Structure-Checker.

## 0.1.5 (2026-05-31)

- Addressed the latest ioBroker repository checker findings for `latest` intake.
- Added Windows to the release-relevant adapter test matrix and updated CI/CD documentation.
- Updated admin translations, js-controller minimum version and ioBroker type definitions.
- Hardened UDP timeout handling and added timeout cleanup test coverage.

## 0.1.4 (2026-04-18)

- Hardened the GitHub release workflow so npm Trusted Publishing prefers GitHub OIDC over token-based npm auth

## 0.1.3 (2026-04-18)

- Normalized the GitHub repository URL metadata for npm Trusted Publishing compatibility

## 0.1.2 (2026-04-18)

- Prepared the adapter for ioBroker `latest` intake with encrypted config handling and cleaner CI job separation
- Added a dedicated Windows regression workflow and a clearer public beta versioning baseline
- Added Trusted Publishing based npm CD plus automatic GitHub release notes with optional Copilot summaries

## 0.1.1 (2026-04-18)

- Cleaned up adapter-check metadata for the `latest` intake and npm follow-up release
- Removed deprecated `common.title` usage and trimmed io-package keywords
- Simplified the io-package news list to published npm versions only

## 0.1.0 (2026-04-17)

- First public beta with ioBroker publication hardening, encrypted device passwords and streamlined CI
- Added protected/encrypted native device password handling for JSON-config table rows
- Split slow Windows adapter tests into a dedicated regression workflow
- Improved publication metadata, title handling and patch-version release preparation

## 0.0.1 (2026-04-17)

- Initial beta with discovery, multi-device runtime, time checks and schedule support
- Added localized mode enums, local timestamp companion states and timer countdown visibility
