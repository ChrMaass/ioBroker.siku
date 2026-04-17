/*
 * Created with @iobroker/create-adapter v3.1.2
 */

import * as utils from '@iobroker/adapter-core';

class Siku extends utils.Adapter {
    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'siku',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        await this.setState('info.connection', false, true);

        this.log.info('Starte SIKU-Adapter im Bootstrap-Modus');
        this.log.debug(`Konfiguration: ${JSON.stringify(this.config)}`);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
            callback();
        }
    }

    /**
     * Handles adapter messages from the admin UI or other instances.
     *
     * The concrete command handling is implemented in the next development steps.
     *
     * @param obj - The incoming ioBroker message object
     */
    private onMessage(obj: ioBroker.Message): void {
        if (typeof obj === 'object' && obj.message) {
            this.log.debug(`Nachricht empfangen: ${obj.command}`);
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, { ok: false, error: 'Not implemented yet' }, obj.callback);
            }
        }
    }
}
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Siku(options);
} else {
    // otherwise start the instance directly
    (() => new Siku())();
}
