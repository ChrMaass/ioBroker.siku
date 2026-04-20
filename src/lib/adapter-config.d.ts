// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface SikuDeviceConfig {
            id: string;
            host: string;
            name: string;
            password?: string;
            enabled: boolean;
            discoveredType: string;
            lastSeen: string;
        }

        interface SikuDevicePasswordRegistry {
            [deviceId: string]: string;
        }

        interface AdapterConfig {
            pollIntervalSec: number;
            discoveryBroadcastAddress: string;
            timeCheckIntervalHours: number;
            timeSyncThresholdSec: number;
            devices: SikuDeviceConfig[];
            devicePasswords?: SikuDevicePasswordRegistry;
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
