// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import Mustache from "mustache";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { rewriteAssetUrls } from "../../src/pusher/services/FrontAssets";
import { removeBootSplash } from "../../src/front/Utils/BootSplash";

const LOGO_SOURCE_PATH = "/src/front/Components/images/konclui-logo.svg";

const template = readFileSync("index.html", "utf8");

/** What FrontController.displayFront gives the template, minus the optional integrations. */
function render(extra: Record<string, unknown> = {}, script = "window.env = {}"): string {
    return Mustache.render(template, {
        title: "Koncluí",
        description: "",
        author: "",
        provider: "",
        themeColor: "#03051A",
        msApplicationTileImage: "/icon.png",
        url: "http://play.test/",
        favIcons: [{ rel: "icon", sizes: "512x512", src: "/icon.png" }],
        script,
        authToken: "",
        matrixLoginToken: "",
        assetsOrigin: "",
        cssVariablesOverride: "",
        ...extra,
    });
}

/** Parses without running anything: DOMParser leaves the scripts of the page alone. */
function parse(html: string): Document {
    return new DOMParser().parseFromString(html, "text/html");
}

/**
 * Puts the page in the live document and runs its inline scripts in this window, in order, as the browser would
 * before the first paint (the module script is kept in the page but not run: it needs the built app).
 */
function load(html: string): Document {
    const parsed = parse(html);
    document.head.innerHTML = "";
    document.body.innerHTML = parsed.body.innerHTML.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g, "");
    const scripts = [...parsed.querySelectorAll("script:not([src]):not([type])")];
    for (const script of scripts) {
        window.eval(script.textContent ?? "");
    }
    return document;
}

describe("the boot splash in the served template", () => {
    afterEach(() => {
        // Stops the error watch that load() started, so that one test does not hear the events of the next.
        removeBootSplash();
        Reflect.deleteProperty(window, "env");
    });

    it("is one block in the body, outside #app and before it, with a decorative logo of fixed size", () => {
        const document = parse(render());

        const splashes = document.querySelectorAll("#boot-splash");
        expect(splashes).toHaveLength(1);
        const splash = splashes[0];
        expect(splash.parentElement).toBe(document.body);
        expect(document.getElementById("app")?.contains(splash)).toBe(false);
        expect(splash.compareDocumentPosition(document.getElementById("app") as Node)).toBe(
            splash.DOCUMENT_POSITION_FOLLOWING,
        );
        expect(splash.getAttribute("aria-hidden")).toBe("true");

        const logos = splash.querySelectorAll("img");
        expect(logos).toHaveLength(1);
        const logo = logos[0];
        expect(logo.getAttribute("alt")).toBe("");
        expect(logo.getAttribute("fetchpriority")).toBe("high");
        // The intrinsic size of the file: the box is known before the image arrives.
        expect(logo.getAttribute("width")).toBe("714");
        expect(logo.getAttribute("height")).toBe("162");
    });

    it("preloads, with high priority and from the head, the file that its logo uses", () => {
        const document = parse(render());

        const preloads = document.head.querySelectorAll('link[rel="preload"][as="image"]');
        expect(preloads).toHaveLength(1);
        expect(preloads[0].getAttribute("fetchpriority")).toBe("high");
        expect(preloads[0].getAttribute("href")).toBe(LOGO_SOURCE_PATH);
        expect(document.querySelector("#boot-splash img")?.getAttribute("src")).toBe(LOGO_SOURCE_PATH);
    });

    it("shows the logo that the loading and the entry screens import, so that both build to the same URL", () => {
        const importedBy = (component: string) =>
            /import \w+ from "\.\.\/images\/(konclui-logo\.svg)"/.exec(
                readFileSync(`src/front/Components/${component}`, "utf8"),
            )?.[1];

        expect(importedBy("Loader/LoaderScene.svelte")).toBe("konclui-logo.svg");
        expect(importedBy("Login/LoginScene.svelte")).toBe("konclui-logo.svg");
        expect(LOGO_SOURCE_PATH.endsWith("/images/konclui-logo.svg")).toBe(true);
        // A relative src of the app resolves to a file that exists.
        expect(() => readFileSync(LOGO_SOURCE_PATH.slice(1))).not.toThrow();
    });

    it("is drawn from the head's own CSS: fixed, transparent, inert, with a fade that reduced motion turns off", () => {
        const css = [...parse(render()).head.querySelectorAll("style")].map((style) => style.textContent).join("\n");
        const rule = /#boot-splash\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

        expect(rule).toMatch(/position:\s*fixed/);
        expect(rule).toMatch(/pointer-events:\s*none/);
        expect(rule).not.toMatch(/background/);
        expect(css).toMatch(/#boot-splash\.boot-splash-leaving\s*\{\s*opacity:\s*0/);
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*#boot-splash\s*\{\s*transition:\s*none/);
        // No animation of its own: it appears at once.
        expect(css).not.toMatch(/@keyframes|animation:/);
    });

    // Pairs with "stays when no admin is configured" below: the same render without the logo keys has the splash,
    // so this test cannot pass merely because the template has no splash at all.
    it("is left out, with its preload, when the server says that the world has its own logo", () => {
        for (const logo of [{ loadingLogo: "https://cdn.test/a.png" }, { loginSceneLogo: "https://cdn.test/b.png" }]) {
            const html = render(logo);
            const document = parse(html);

            expect(document.getElementById("boot-splash")).toBeNull();
            expect(document.querySelector('link[rel="preload"][as="image"]')).toBeNull();
            expect(html).not.toContain("konclui-logo");
        }
    });

    it("is removed before the first paint when an admin is configured, as it may have set another logo", () => {
        const document = load(render({}, 'window.env = { ADMIN_URL: "https://admin.test" }'));

        expect(document.getElementById("boot-splash")).toBeNull();
    });

    it("stays when no admin is configured", () => {
        const document = load(render({}, "window.env = {}"));

        expect(document.getElementById("boot-splash")).not.toBeNull();
    });

    // The error watch drops the splash for a failure of the app, and for nothing else. The first assertion of each
    // test shows that the splash is up, so that a splash that was never there cannot pass.
    function expectSplashUp() {
        expect(document.getElementById("boot-splash")).not.toBeNull();
    }
    function scriptError(filename: string, type = "error"): Event {
        return new ErrorEvent(type, { filename, message: "boom" });
    }

    it("gives way when a script of the app's own origin throws, so that the error is not hidden behind it", () => {
        load(render());
        expectSplashUp();

        window.dispatchEvent(scriptError(`${window.location.origin}/assets/index-abc.js`));

        expect(document.getElementById("boot-splash")).toBeNull();
    });

    it("compares with the origin of the module script, which is the assets domain when there is one", () => {
        load(rewriteAssetUrls(render(), "https://assets.test"));
        expectSplashUp();

        // The page's own origin is not the app's here: this one is not an error of the app.
        window.dispatchEvent(scriptError(`${window.location.origin}/inline.js`));
        expectSplashUp();

        window.dispatchEvent(scriptError("https://assets.test/assets/index-abc.js"));
        expect(document.getElementById("boot-splash")).toBeNull();
    });

    it("stays when a third-party script, an extension or a cross-origin script (no file name) fails", () => {
        load(render());
        expectSplashUp();

        for (const filename of [
            "https://cdn.lr-in-prod.com/LogRocket.min.js",
            "https://apis.google.com/js/api.js",
            "chrome-extension://abcdef/content.js",
            "",
        ]) {
            window.dispatchEvent(scriptError(filename));
        }

        expectSplashUp();
    });

    it("stays when a promise is rejected: it is common on a healthy boot and says nothing about the app", () => {
        load(render());

        window.dispatchEvent(new Event("unhandledrejection"));

        expectSplashUp();
    });

    it("gives way when the module script of the app fails to load, and not for another resource", () => {
        const document = load(render());
        expectSplashUp();

        const image = document.createElement("img");
        const other = document.createElement("script");
        other.src = "https://cdn.test/other.js";
        document.body.append(image, other);
        image.dispatchEvent(new Event("error"));
        other.dispatchEvent(new Event("error"));
        expectSplashUp();

        document.querySelector('script[type="module"]')?.dispatchEvent(new Event("error"));
        expect(document.getElementById("boot-splash")).toBeNull();
    });

    it("stops watching for errors once the app has taken the splash away", () => {
        const removeListener = vi.spyOn(window, "removeEventListener");
        load(render());

        removeBootSplash();

        expect(removeListener).toHaveBeenCalledWith("error", expect.any(Function), true);
        removeListener.mockRestore();
    });

    it("has its URLs sent to the assets domain with the other built files", () => {
        const html = rewriteAssetUrls(render(), "https://assets.test");

        expect(html.match(new RegExp(`https://assets.test${LOGO_SOURCE_PATH}`, "g"))).toHaveLength(2);
    });
});
