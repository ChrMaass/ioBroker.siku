"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
class Siku extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "siku"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    await this.setState("info.connection", false, true);
    this.log.info("Starte SIKU-Adapter im Bootstrap-Modus");
    this.log.debug(`Konfiguration: ${JSON.stringify(this.config)}`);
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  onUnload(callback) {
    try {
      callback();
    } catch (error) {
      this.log.error(`Error during unloading: ${error.message}`);
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
  onMessage(obj) {
    if (typeof obj === "object" && obj.message) {
      this.log.debug(`Nachricht empfangen: ${obj.command}`);
      if (obj.callback) {
        this.sendTo(obj.from, obj.command, { ok: false, error: "Not implemented yet" }, obj.callback);
      }
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new Siku(options);
} else {
  (() => new Siku())();
}
//# sourceMappingURL=main.js.map
