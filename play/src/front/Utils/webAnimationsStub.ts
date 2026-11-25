import { tick } from "svelte";

/**
 * A stand-in for the Web Animations API that jsdom lacks, for the tests of the surfaces that arrive and leave on
 * `transition:surface` (surfaceTransition.ts). Svelte runs a transition with `Element.animate`: with none, the
 * transition has nothing to wait for and a surface is gone in the same flush, which hides the very thing the tests
 * are about, the node that stays for the length of its exit. This one waits until the test says the time is up.
 *
 * It is for tests only: nothing in the application imports it.
 */

/** What `Element.animate` returns in a browser, as far as Svelte's transition reads it. */
class FakeAnimation {
    currentTime = 0;
    onfinish: (() => void) | null = null;
    cancelled = false;
    effect: unknown = {};

    constructor(readonly options: { duration: number }) {}

    cancel(): void {
        this.cancelled = true;
    }

    finish(): void {
        this.onfinish?.();
    }
}

export interface WebAnimationsStub {
    /** Every animation started since the stub was installed, the first dummy one of each run included. */
    readonly animations: readonly FakeAnimation[];
    /** The animations that move something: not the dummy one Svelte starts each run with, and not a cancelled one. */
    moving(): FakeAnimation[];
    /** Ends every moving animation, as the browser does when the time is up, and lets Svelte take the node away. */
    finishMoving(): Promise<void>;
    /** Gives Svelte the microtasks it needs to start a transition and to end the dummy animation in front of it. */
    settle(): Promise<void>;
    /** Takes the stub away. */
    restore(): void;
}

export function stubWebAnimations(): WebAnimationsStub {
    const animations: FakeAnimation[] = [];
    Object.defineProperty(Element.prototype, "animate", {
        configurable: true,
        writable: true,
        value(_keyframes: unknown, options: { duration: number }) {
            const animation = new FakeAnimation(options);
            animations.push(animation);
            // Svelte starts every run with a dummy animation as long as its delay (none) and waits for it to end.
            if (!options.duration) queueMicrotask(() => !animation.cancelled && animation.finish());
            return animation;
        },
    });

    const moving = () => animations.filter((animation) => animation.options.duration > 0 && !animation.cancelled);
    const settle = async () => {
        await tick();
        await tick();
        await tick();
        await tick();
    };
    return {
        animations,
        moving,
        settle,
        async finishMoving() {
            for (const animation of moving()) animation.finish();
            await settle();
        },
        restore() {
            Reflect.deleteProperty(Element.prototype, "animate");
        },
    };
}
