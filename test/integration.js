const path = require('path');
const { tests } = require('@iobroker/testing');

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
// We intentionally use the latest stable controller release instead of the moving "dev" target
// to keep CI more reproducible and noticeably faster on Windows runners.
tests.integration(path.join(__dirname, '..'), {
    controllerVersion: 'latest',
});
