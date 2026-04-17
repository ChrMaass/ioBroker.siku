# Releasing and official ioBroker inclusion

This document summarizes the practical steps required to move `ioBroker.siku` from a repository beta to an officially listed ioBroker adapter.

## What ioBroker requires for inclusion in `latest`

Based on the current `ioBroker.repositories` requirements, the adapter should have at least the following in place:

- repository name `ioBroker.<adaptername>`
- GitHub topics configured
- English README with description, changelog, and a link to the manufacturer or device description
- predefined license
- GitHub Actions based adapter tests
- valid `type`, `connectionType`, and state roles in `io-package.json`
- package published on npm
- `iobroker` organization added as npm owner (`bluefox` is the documented contact)
- Admin 3 / JSON config configuration dialog

Primary references:

- [ioBroker.repositories README](https://github.com/ioBroker/ioBroker.repositories)
- [ioBroker adapter creator](https://github.com/ioBroker/create-adapter)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers)

## Current project status

- [x] Repository name matches `ioBroker.<adaptername>`
- [x] JSON config admin page is present
- [x] CI test workflow is present
- [x] README is in English and links to manufacturer/device sources
- [x] Release workflow is prepared for npm trusted publishing
- [ ] npm package `iobroker.siku` has been published
- [ ] npm owner `bluefox` / ioBroker organization has been added
- [ ] Adapter has been added to `latest`
- [ ] Adapter has been field-tested long enough for `stable`

## One-time npm setup for CD

1. Publish rights must exist for `iobroker.siku` on npm.
2. Configure **Trusted Publishing** for this package on npmjs.com:
   - provider: GitHub Actions
   - owner: `ChrMaass`
   - repository: `ioBroker.siku`
   - workflow: `test-and-release.yml`
3. Add the documented emergency owner:
   - `npm owner add bluefox iobroker.siku`
4. Enable the repository variable `ENABLE_NPM_RELEASE=true` in GitHub.

After that, tagged releases can be published from GitHub Actions without storing a long-lived npm token.

## Release flow for this repository

1. Ensure `main` is green in GitHub Actions.
2. Run a dry run if needed:
   - `npm run release patch -- --dry`
3. Create the real release:
   - `npm run release patch`
4. The release script creates a git tag.
5. GitHub Actions runs the release workflow.
6. If trusted publishing is configured and `ENABLE_NPM_RELEASE=true`, the tag build publishes to npm.

## After the first npm release

Add the adapter to the ioBroker `latest` repository using one of these paths:

- via `iobroker.dev` → manage → **ADD TO LATEST**
- or by PR against `ioBroker/ioBroker.repositories`

Once the adapter has real user feedback and enough validation, it can later be proposed for `stable`.
