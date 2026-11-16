import type { Capabilities } from "@workadventure/messages";

let capabilities: Capabilities | undefined;

export function getCapability(key: keyof Capabilities): string | undefined {
    if (!capabilities) {
        throw Error("Capabilities have not been initialized");
    }
    return capabilities[key];
}

export function setCapabilities(_capabilities: Capabilities) {
    capabilities = _capabilities;
}
