"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var siku_display_exports = {};
__export(siku_display_exports, {
  formatLocalTimestamp: () => formatLocalTimestamp,
  getLocalizedEnumStates: () => getLocalizedEnumStates,
  getLocalizedModeLabel: () => getLocalizedModeLabel
});
module.exports = __toCommonJS(siku_display_exports);
const LANGUAGE_TO_LOCALE = {
  de: "de-DE",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
  nl: "nl-NL",
  pl: "pl-PL",
  pt: "pt-PT",
  ru: "ru-RU",
  uk: "uk-UA",
  "zh-cn": "zh-CN"
};
const SIKU_ENUM_TRANSLATIONS = {
  "control.fanMode": {
    de: { 0: "L\xFCften", 1: "W\xE4rmer\xFCckgewinnung", 2: "Luftzufuhr" },
    en: { 0: "Ventilation", 1: "Heat recovery", 2: "Supply air" },
    es: { 0: "Ventilaci\xF3n", 1: "Recuperaci\xF3n de calor", 2: "Impulsi\xF3n de aire" },
    fr: { 0: "Ventilation", 1: "R\xE9cup\xE9ration de chaleur", 2: "Admission d'air" },
    it: { 0: "Ventilazione", 1: "Recupero di calore", 2: "Mandata aria" },
    nl: { 0: "Ventilatie", 1: "Warmteterugwinning", 2: "Luchttoevoer" },
    pl: { 0: "Wentylacja", 1: "Odzysk ciep\u0142a", 2: "Nawiew powietrza" },
    pt: { 0: "Ventila\xE7\xE3o", 1: "Recupera\xE7\xE3o de calor", 2: "Insufla\xE7\xE3o de ar" },
    ru: { 0: "\u0412\u0435\u043D\u0442\u0438\u043B\u044F\u0446\u0438\u044F", 1: "\u0420\u0435\u043A\u0443\u043F\u0435\u0440\u0430\u0446\u0438\u044F \u0442\u0435\u043F\u043B\u0430", 2: "\u041F\u043E\u0434\u0430\u0447\u0430 \u0432\u043E\u0437\u0434\u0443\u0445\u0430" },
    uk: { 0: "\u0412\u0435\u043D\u0442\u0438\u043B\u044F\u0446\u0456\u044F", 1: "\u0420\u0435\u043A\u0443\u043F\u0435\u0440\u0430\u0446\u0456\u044F \u0442\u0435\u043F\u043B\u0430", 2: "\u041F\u043E\u0434\u0430\u0447\u0430 \u043F\u043E\u0432\u0456\u0442\u0440\u044F" },
    "zh-cn": { 0: "\u901A\u98CE", 1: "\u70ED\u56DE\u6536", 2: "\u9001\u98CE" }
  },
  "control.timerMode": {
    de: { 0: "Aus", 1: "Nachtmodus", 2: "Partybetrieb" },
    en: { 0: "Off", 1: "Night mode", 2: "Party mode" },
    es: { 0: "Apagado", 1: "Modo noche", 2: "Modo fiesta" },
    fr: { 0: "Arr\xEAt", 1: "Mode nuit", 2: "Mode f\xEAte" },
    it: { 0: "Spento", 1: "Modalit\xE0 notte", 2: "Modalit\xE0 festa" },
    nl: { 0: "Uit", 1: "Nachtmodus", 2: "Partymodus" },
    pl: { 0: "Wy\u0142\u0105czony", 1: "Tryb nocny", 2: "Tryb impreza" },
    pt: { 0: "Desligado", 1: "Modo noturno", 2: "Modo festa" },
    ru: { 0: "\u0412\u044B\u043A\u043B\u044E\u0447\u0435\u043D", 1: "\u041D\u043E\u0447\u043D\u043E\u0439 \u0440\u0435\u0436\u0438\u043C", 2: "\u0420\u0435\u0436\u0438\u043C \u0432\u0435\u0447\u0435\u0440\u0438\u043D\u043A\u0438" },
    uk: { 0: "\u0412\u0438\u043C\u043A\u043D\u0435\u043D\u043E", 1: "\u041D\u0456\u0447\u043D\u0438\u0439 \u0440\u0435\u0436\u0438\u043C", 2: "\u0420\u0435\u0436\u0438\u043C \u0432\u0435\u0447\u0456\u0440\u043A\u0438" },
    "zh-cn": { 0: "\u5173\u95ED", 1: "\u591C\u95F4\u6A21\u5F0F", 2: "\u6D3E\u5BF9\u6A21\u5F0F" }
  }
};
function normalizeLanguage(language) {
  const normalized = (language != null ? language : "en").toLowerCase();
  if (normalized in LANGUAGE_TO_LOCALE) {
    return normalized;
  }
  if (normalized.startsWith("zh")) {
    return "zh-cn";
  }
  const baseLanguage = normalized.split("-")[0];
  if (baseLanguage in LANGUAGE_TO_LOCALE) {
    return baseLanguage;
  }
  return "en";
}
function getLocalizedEnumStates(relativeId, language) {
  const enumTranslations = SIKU_ENUM_TRANSLATIONS[relativeId];
  if (!enumTranslations) {
    return void 0;
  }
  return enumTranslations[normalizeLanguage(language)];
}
function getLocalizedModeLabel(relativeId, value, language) {
  var _a;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return void 0;
  }
  return (_a = getLocalizedEnumStates(relativeId, language)) == null ? void 0 : _a[String(value)];
}
function formatLocalTimestamp(value, language) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(LANGUAGE_TO_LOCALE[normalizeLanguage(language)], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(parsed);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  formatLocalTimestamp,
  getLocalizedEnumStates,
  getLocalizedModeLabel
});
//# sourceMappingURL=siku-display.js.map
