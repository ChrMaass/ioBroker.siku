/**
 * Constants for the SIKU RV V2 UDP protocol.
 */
export const SIKU_DEFAULT_PORT = 4000;
export const SIKU_DEFAULT_PASSWORD = '1111';
export const SIKU_DEFAULT_DEVICE_ID = 'DEFAULT_DEVICEID';
export const SIKU_PACKET_PREFIX = Buffer.from([0xfd, 0xfd]);
export const SIKU_PROTOCOL_TYPE = 0x02;
export const SIKU_DEVICE_ID_LENGTH = 0x10;

export const SIKU_DISCOVERY_TIMEOUT_MS = 1_500;
export const SIKU_REQUEST_TIMEOUT_MS = 2_500;
export const SIKU_REQUEST_RETRY_DELAYS_MS = [0, 200, 500] as const;

export const SIKU_DISCOVERY_PARAMETERS = [0x007c, 0x00b9] as const;
export const SIKU_PARAMETER_POWER = 0x0001;
export const SIKU_PARAMETER_FAN_SPEED = 0x0002;
export const SIKU_PARAMETER_RTC_TIME = 0x006f;
export const SIKU_PARAMETER_RTC_CALENDAR = 0x0070;
export const SIKU_PARAMETER_DEVICE_ID = 0x007c;
export const SIKU_PARAMETER_IP_ADDRESS = 0x00a3;
export const SIKU_PARAMETER_DEVICE_TYPE = 0x00b9;

export const SIKU_RUNTIME_POLL_PARAMETERS = [
    SIKU_PARAMETER_POWER,
    SIKU_PARAMETER_FAN_SPEED,
    SIKU_PARAMETER_DEVICE_ID,
    SIKU_PARAMETER_IP_ADDRESS,
    SIKU_PARAMETER_DEVICE_TYPE,
] as const;

export const SIKU_TIME_CHECK_PARAMETERS = [SIKU_PARAMETER_RTC_TIME, SIKU_PARAMETER_RTC_CALENDAR] as const;

export enum SikuFunction {
    Read = 0x01,
    Write = 0x02,
    ReadWrite = 0x03,
    Increment = 0x04,
    Decrement = 0x05,
    Response = 0x06,
}

export const SIKU_SPECIAL_COMMANDS = {
    changeFunction: 0xfc,
    unsupported: 0xfd,
    valueSize: 0xfe,
    page: 0xff,
} as const;
