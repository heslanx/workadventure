import { get } from "svelte/store";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import BrowserAudioInterruptedToast from "../Components/Toasts/BrowserAudioInterruptedToast.svelte";
import TextToast from "../Components/Toasts/TextToast.svelte";
import { setLocale } from "../../i18n/i18n-svelte";
import { loadLocale } from "../../i18n/i18n-util.sync";
import { uplinkCapNoticeStore } from "../WebRtc/UplinkCap";
import { audioInterruptedStore } from "./AudioInterruptedStore";
import { createToastStore } from "./ToastStore";
import { getToastSources } from "./ToastSources";

describe("ToastSources", () => {
    afterEach(() => {
        audioInterruptedStore.setInterrupted(false);
    });

    it("registers the audio interrupted toast source", () => {
        const store = createToastStore(getToastSources());

        expect(get(store).has("audio-interrupted-toast")).toBe(false);

        audioInterruptedStore.setInterrupted(true);

        expect(get(store).get("audio-interrupted-toast")).toEqual({
            component: BrowserAudioInterruptedToast,
            props: {
                toastUuid: "audio-interrupted-toast",
            },
        });

        audioInterruptedStore.setInterrupted(false);

        expect(get(store).has("audio-interrupted-toast")).toBe(false);
    });

    describe("the weak connection notice", () => {
        beforeAll(() => {
            loadLocale("en-US");
            setLocale("en-US");
        });

        afterEach(() => {
            uplinkCapNoticeStore.set(false);
        });

        it("shows a secondary text toast for about eight seconds while the notice is up", () => {
            const store = createToastStore(getToastSources());
            expect(get(store).has("uplink-cap-toast")).toBe(false);

            uplinkCapNoticeStore.set(true);

            expect(get(store).get("uplink-cap-toast")).toEqual({
                component: TextToast,
                props: {
                    message: "Weak connection: others see your camera in lower quality. It comes back on its own.",
                    theme: "secondary",
                    duration: 8000,
                    toastUuid: "uplink-cap-toast",
                },
            });

            uplinkCapNoticeStore.set(false);

            expect(get(store).has("uplink-cap-toast")).toBe(false);
        });

        it("stays closed once dismissed, until the notice is raised again", () => {
            const store = createToastStore(getToastSources());
            uplinkCapNoticeStore.set(true);

            store.removeToast("uplink-cap-toast");
            expect(get(store).has("uplink-cap-toast")).toBe(false);

            uplinkCapNoticeStore.set(false);
            uplinkCapNoticeStore.set(true);
            expect(get(store).has("uplink-cap-toast")).toBe(true);
        });
    });
});
