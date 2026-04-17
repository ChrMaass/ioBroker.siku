interface SikuLocalizedTextMap {
    de: Record<string, string>;
    en: Record<string, string>;
    es: Record<string, string>;
    fr: Record<string, string>;
    it: Record<string, string>;
    nl: Record<string, string>;
    pl: Record<string, string>;
    pt: Record<string, string>;
    ru: Record<string, string>;
    uk: Record<string, string>;
    'zh-cn': Record<string, string>;
}

const LANGUAGE_TO_LOCALE = {
    de: 'de-DE',
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    it: 'it-IT',
    nl: 'nl-NL',
    pl: 'pl-PL',
    pt: 'pt-PT',
    ru: 'ru-RU',
    uk: 'uk-UA',
    'zh-cn': 'zh-CN',
} as const;

const SIKU_ENUM_TRANSLATIONS: Record<string, SikuLocalizedTextMap> = {
    'control.fanMode': {
        de: { 0: 'Lüften', 1: 'Wärmerückgewinnung', 2: 'Luftzufuhr' },
        en: { 0: 'Ventilation', 1: 'Heat recovery', 2: 'Supply air' },
        es: { 0: 'Ventilación', 1: 'Recuperación de calor', 2: 'Impulsión de aire' },
        fr: { 0: 'Ventilation', 1: 'Récupération de chaleur', 2: "Admission d'air" },
        it: { 0: 'Ventilazione', 1: 'Recupero di calore', 2: 'Mandata aria' },
        nl: { 0: 'Ventilatie', 1: 'Warmteterugwinning', 2: 'Luchttoevoer' },
        pl: { 0: 'Wentylacja', 1: 'Odzysk ciepła', 2: 'Nawiew powietrza' },
        pt: { 0: 'Ventilação', 1: 'Recuperação de calor', 2: 'Insuflação de ar' },
        ru: { 0: 'Вентиляция', 1: 'Рекуперация тепла', 2: 'Подача воздуха' },
        uk: { 0: 'Вентиляція', 1: 'Рекуперація тепла', 2: 'Подача повітря' },
        'zh-cn': { 0: '通风', 1: '热回收', 2: '送风' },
    },
    'control.timerMode': {
        de: { 0: 'Aus', 1: 'Nachtmodus', 2: 'Partybetrieb' },
        en: { 0: 'Off', 1: 'Night mode', 2: 'Party mode' },
        es: { 0: 'Apagado', 1: 'Modo noche', 2: 'Modo fiesta' },
        fr: { 0: 'Arrêt', 1: 'Mode nuit', 2: 'Mode fête' },
        it: { 0: 'Spento', 1: 'Modalità notte', 2: 'Modalità festa' },
        nl: { 0: 'Uit', 1: 'Nachtmodus', 2: 'Partymodus' },
        pl: { 0: 'Wyłączony', 1: 'Tryb nocny', 2: 'Tryb impreza' },
        pt: { 0: 'Desligado', 1: 'Modo noturno', 2: 'Modo festa' },
        ru: { 0: 'Выключен', 1: 'Ночной режим', 2: 'Режим вечеринки' },
        uk: { 0: 'Вимкнено', 1: 'Нічний режим', 2: 'Режим вечірки' },
        'zh-cn': { 0: '关闭', 1: '夜间模式', 2: '派对模式' },
    },
} as const;

function normalizeLanguage(language: string | undefined): keyof typeof LANGUAGE_TO_LOCALE {
    const normalized = (language ?? 'en').toLowerCase();

    if (normalized in LANGUAGE_TO_LOCALE) {
        return normalized as keyof typeof LANGUAGE_TO_LOCALE;
    }

    if (normalized.startsWith('zh')) {
        return 'zh-cn';
    }

    const baseLanguage = normalized.split('-')[0];
    if (baseLanguage in LANGUAGE_TO_LOCALE) {
        return baseLanguage as keyof typeof LANGUAGE_TO_LOCALE;
    }

    return 'en';
}

/**
 * Returns the localized enum state labels for a mapped adapter state.
 *
 * @param relativeId - Relative ioBroker state id inside one device tree
 * @param language - Active ioBroker language
 */
export function getLocalizedEnumStates(
    relativeId: string,
    language: string | undefined,
): Record<string, string> | undefined {
    const enumTranslations = SIKU_ENUM_TRANSLATIONS[relativeId];
    if (!enumTranslations) {
        return undefined;
    }

    return enumTranslations[normalizeLanguage(language)];
}

/**
 * Returns the localized label for a numeric mode enum value.
 *
 * @param relativeId - Relative ioBroker state id inside one device tree
 * @param value - Raw state value that should map to an enum label
 * @param language - Active ioBroker language
 */
export function getLocalizedModeLabel(
    relativeId: string,
    value: ioBroker.StateValue,
    language: string | undefined,
): string | undefined {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        return undefined;
    }

    return getLocalizedEnumStates(relativeId, language)?.[String(value)];
}

/**
 * Formats an ISO timestamp in the current UI language and the local host time zone.
 *
 * @param value - ISO timestamp string to format
 * @param language - Active ioBroker language
 */
export function formatLocalTimestamp(value: string, language: string | undefined): string {
    if (!value) {
        return '';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat(LANGUAGE_TO_LOCALE[normalizeLanguage(language)], {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
    }).format(parsed);
}
