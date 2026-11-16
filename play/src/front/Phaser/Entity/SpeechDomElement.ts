import * as Phaser from "phaser";
import { get } from "svelte/store";
import { marked } from "marked";
import LL from "../../../i18n/i18n-svelte";
import { sanitizeHtml } from "../../Utils/HtmlSanitizer";
import { isReducedMotion } from "../../Utils/reducedMotion";

import DOMElement = Phaser.GameObjects.DOMElement;

let speechKeyShadowFilterUid = 0;

/** Primary action key — light “keycap”, same height as escape for alignment. */
function buildSpaceKeyboardBadgeHtml(label: string): string {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "56");
    svg.setAttribute("height", "22");
    svg.setAttribute("viewBox", "0 0 56 22");
    svg.setAttribute("class", "speech-key__svg");
    svg.style.verticalAlign = "middle";

    const shadowId = `speech-key-space-shadow-${++speechKeyShadowFilterUid}`;
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
    filter.setAttribute("id", shadowId);
    filter.setAttribute("x", "-20%");
    filter.setAttribute("y", "-20%");
    filter.setAttribute("width", "140%");
    filter.setAttribute("height", "140%");
    const feDrop = document.createElementNS("http://www.w3.org/2000/svg", "feDropShadow");
    feDrop.setAttribute("dx", "0");
    feDrop.setAttribute("dy", "1");
    feDrop.setAttribute("stdDeviation", "0.8");
    feDrop.setAttribute("flood-opacity", "0.35");
    filter.appendChild(feDrop);
    defs.appendChild(filter);
    svg.appendChild(defs);

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "0.5");
    rect.setAttribute("y", "0.5");
    rect.setAttribute("width", "55");
    rect.setAttribute("height", "21");
    rect.setAttribute("rx", "4");
    rect.setAttribute("fill", "#f8fafc");
    rect.setAttribute("stroke", "#cbd5e1");
    rect.setAttribute("stroke-width", "1");
    rect.setAttribute("filter", `url(#${shadowId})`);
    svg.appendChild(rect);

    const textElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textElement.setAttribute("x", "28");
    textElement.setAttribute("y", "15");
    textElement.setAttribute("text-anchor", "middle");
    textElement.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
    textElement.setAttribute("font-size", "11");
    textElement.setAttribute("font-weight", "700");
    textElement.setAttribute("letter-spacing", "0.04em");
    textElement.setAttribute("fill", "#0f172a");
    textElement.textContent = "SPACE";
    svg.appendChild(textElement);

    const wrap = document.createElement("span");
    wrap.className = "speech-key speech-key--space";
    // The badge replaces the key name in the sentence: keep the name for screen readers.
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", label);
    wrap.appendChild(svg);
    return wrap.outerHTML;
}

/** Cancel / dismiss — outlined, darker cap (visually secondary). */
function buildEscapeKeyboardBadgeHtml(isInteractive: boolean, label: string): string {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "40");
    svg.setAttribute("height", "22");
    svg.setAttribute("viewBox", "0 0 40 22");
    svg.setAttribute("class", "speech-key__svg");
    svg.style.verticalAlign = "middle";

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "0.5");
    rect.setAttribute("y", "0.5");
    rect.setAttribute("width", "39");
    rect.setAttribute("height", "21");
    rect.setAttribute("rx", "4");
    rect.setAttribute("fill", "rgba(15, 23, 42, 0.95)");
    rect.setAttribute("stroke", "#fb923c");
    rect.setAttribute("stroke-width", "1.25");
    svg.appendChild(rect);

    const textElement = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textElement.setAttribute("x", "20");
    textElement.setAttribute("y", "15");
    textElement.setAttribute("text-anchor", "middle");
    textElement.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, sans-serif");
    textElement.setAttribute("font-size", "11");
    textElement.setAttribute("font-weight", "700");
    textElement.setAttribute("letter-spacing", "0.06em");
    textElement.setAttribute("fill", "#ffedd5");
    textElement.textContent = "ESC";
    svg.appendChild(textElement);

    const wrapper = document.createElement("span");
    wrapper.className = `character-trigger-escape-hint speech-key speech-key--escape${
        isInteractive ? " speech-key--interactive" : ""
    }`;
    // The badge replaces the key name in the sentence: keep the name for screen readers.
    wrapper.setAttribute("role", "img");
    wrapper.setAttribute("aria-label", label);
    wrapper.appendChild(svg);
    return wrapper.outerHTML;
}

function bubbleOuterStyle(type: "warning" | "message"): string {
    const base = [
        "z-index:10",
        "box-sizing:border-box",
        "padding:8px 12px",
        "border-radius:12px",
        "font-size:0.6875rem",
        "line-height:1.45",
        'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
        "letter-spacing:0.01em",
        "cursor:pointer",
        "max-width:min(320px,85vw)",
        "max-height:168px",
        "overflow-y:auto",
        "overflow-x:hidden",
        "white-space:normal",
        "word-break:break-word",
        "backdrop-filter:blur(12px)",
        "-webkit-backdrop-filter:blur(12px)",
    ];
    if (type === "message") {
        base.push("background:rgba(27,52,65,0.75)", "color:white", "border:1px solid rgba(27,52,65,0.50)");
    } else {
        base.push("background:rgba(27,52,65,0.75)", "color:white", "border:1px solid rgba(233,110,83,0.50)");
    }
    return base.join(";");
}

/** Once the pointer or the focus leaves a bubble that was paused, it stays at least this long. */
const MIN_REMAINING_AFTER_PAUSE_MS = 3000;

const ACTION_BUTTON_BASE_STYLE = [
    "font:inherit",
    "font-size:0.75rem",
    "font-weight:600",
    "line-height:1.2",
    "min-height:28px",
    "min-width:28px",
    "padding:3px 10px",
    "border-radius:6px",
    "cursor:pointer",
].join(";");

export class SpeechDomElement extends DOMElement {
    private timeoutDestroyText: NodeJS.Timeout | null = null;
    private readonly span: HTMLSpanElement | null = null;
    /** Same reference passed to add/removeEventListener on the escape badge (ESLint listeners rules). */
    private escapeHintClickHandler: EventListener | null = null;
    /** The on-screen alternatives to the Space and Escape keys, with the handlers to remove them with. */
    private actionButtons: Array<{ button: HTMLButtonElement; handler: EventListener }> = [];

    // Auto-dismissal: the countdown stops while the pointer or the focus is on the bubble, so it cannot vanish while
    // it is being read or used.
    private autoDestroyPending = false;
    private autoDestroyRemainingMs = 0;
    private autoDestroyStartedAt = 0;
    private autoDestroyCallback: ((id: string) => void) | undefined;
    private pointerInside = false;
    private focusInside = false;

    private readonly onPointerEnter = (): void => {
        this.pointerInside = true;
        this.pauseAutoDestroy();
    };
    private readonly onPointerLeave = (): void => {
        this.pointerInside = false;
        this.resumeAutoDestroy();
    };
    private readonly onFocusIn = (): void => {
        this.focusInside = true;
        this.pauseAutoDestroy();
    };
    private readonly onFocusOut = (event: FocusEvent): void => {
        // Moving from one button of the bubble to the next is not leaving it.
        if (event.relatedTarget instanceof Node && this.span?.contains(event.relatedTarget)) {
            return;
        }
        this.focusInside = false;
        this.resumeAutoDestroy();
    };

    constructor(
        public readonly id: string,
        text: string,
        scene: Phaser.Scene,
        x = -1,
        y = -50,
        public readonly callback = () => this.destroy(),
        type: "warning" | "message" = "message",
        private readonly escapeCallback?: () => void,
    ) {
        const spaceMarker = get(LL).trigger.spaceKeyboard();
        const escapeMarker = get(LL).trigger.escapeKeyboard();

        let textTransformed = text.replace(spaceMarker, buildSpaceKeyboardBadgeHtml(spaceMarker));
        if (text.includes(escapeMarker)) {
            textTransformed = textTransformed.replace(
                escapeMarker,
                buildEscapeKeyboardBadgeHtml(!!escapeCallback, escapeMarker),
            );
        }

        const textMarked = marked.parse(textTransformed);
        const span = document.createElement("span");

        // The text can come from the map (or from the map editor): the Markdown rendering keeps the HTML
        // it contains, so it must be sanitized before reaching the "innerHTML" sink.
        if (textMarked instanceof Promise) {
            textMarked
                .then((resolvedText) => {
                    span.innerHTML = sanitizeHtml(resolvedText);
                    this.wireEscapeHintListener(span);
                    this.appendActionButtons(span);
                })
                .catch((e) => console.error(e));
        } else {
            span.innerHTML = sanitizeHtml(textMarked);
        }
        span.id = `spanText-${id}`;
        span.classList.add("characterTriggerAction", "speech-dom-inner", `speech-dom-inner--${type}`);

        super(scene, x, y, span, bubbleOuterStyle(type));

        this.span = span;
        this.span.addEventListener("click", this.callback);
        this.span.addEventListener("mouseenter", this.onPointerEnter);
        this.span.addEventListener("mouseleave", this.onPointerLeave);
        this.span.addEventListener("focusin", this.onFocusIn);
        this.span.addEventListener("focusout", this.onFocusOut);
        if (!(textMarked instanceof Promise)) {
            this.wireEscapeHintListener(span);
            this.appendActionButtons(span);
        }
        this.setAlpha(0);
    }

    /**
     * A bubble that asks a question (it has an Escape callback: the answer is Space for yes, Escape for no) also gets
     * the two answers as real buttons, so it can be answered without the keys and found with Tab and a screen reader.
     */
    private appendActionButtons(span: HTMLSpanElement): void {
        const escapeCallback = this.escapeCallback;
        if (!escapeCallback) {
            return;
        }
        this.removeActionButtons();

        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-top:6px";

        const addButton = (label: string, style: string, onActivate: () => void): void => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.style.cssText = `${ACTION_BUTTON_BASE_STYLE};${style}`;
            // The bubble itself answers "yes" when it is clicked: a button must not also trigger that.
            const handler: EventListener = (event) => {
                event.preventDefault();
                event.stopPropagation();
                onActivate();
            };
            button.addEventListener("click", handler);
            this.actionButtons.push({ button, handler });
            actions.appendChild(button);
        };

        addButton(
            get(LL).camera.webrtc.newDeviceSwitch(),
            "background:#f8fafc;color:#0f172a;border:1px solid #cbd5e1",
            () => this.callback(),
        );
        addButton(
            get(LL).camera.webrtc.newDeviceIgnore(),
            "background:transparent;color:#ffedd5;border:1px solid #fb923c",
            escapeCallback,
        );
        span.appendChild(actions);
    }

    private removeActionButtons(): void {
        for (const { button, handler } of this.actionButtons) {
            button.removeEventListener("click", handler);
        }
        this.actionButtons = [];
    }

    private wireEscapeHintListener(span: HTMLSpanElement): void {
        if (!this.escapeCallback) {
            return;
        }
        const escapeEl = span.querySelector(".character-trigger-escape-hint");
        if (!(escapeEl instanceof HTMLElement)) {
            return;
        }
        this.removeEscapeHintListener(span);
        this.escapeHintClickHandler = (e: Event): void => {
            e.preventDefault();
            e.stopPropagation();
            this.escapeCallback!();
        };
        escapeEl.addEventListener("click", this.escapeHintClickHandler);
    }

    private removeEscapeHintListener(span: HTMLSpanElement): void {
        if (this.escapeHintClickHandler === null) {
            return;
        }
        const escapeEl = span.querySelector(".character-trigger-escape-hint");
        escapeEl?.removeEventListener("click", this.escapeHintClickHandler);
        this.escapeHintClickHandler = null;
    }

    public play(textX: number, textY: number, duration: number, callback?: (id: string) => void) {
        if (this.timeoutDestroyText) clearTimeout(this.timeoutDestroyText);
        this.scene?.tweens.add({
            targets: this,
            props: {
                alpha: 1,
                y: textY,
                x: textX,
            },
            ease: "Power2",
            // The slide-in is skipped (1 ms, as a 0 ms tween has no progress) when the user reduces motion.
            duration: isReducedMotion() ? 1 : 1000,
            onComplete: () => {
                if (duration < 1) return;
                this.autoDestroyPending = true;
                this.autoDestroyRemainingMs = duration;
                this.autoDestroyCallback = callback;
                this.startAutoDestroyTimer();
            },
        });
    }

    /** Does nothing while the pointer or the focus is on the bubble: the countdown starts when they leave. */
    private startAutoDestroyTimer(): void {
        if (this.pointerInside || this.focusInside) {
            return;
        }
        this.autoDestroyStartedAt = Date.now();
        this.timeoutDestroyText = setTimeout(() => {
            this.timeoutDestroyText = null;
            this.autoDestroyPending = false;
            const callback = this.autoDestroyCallback;
            this.destroy();
            if (callback) callback(this.id);
        }, this.autoDestroyRemainingMs);
    }

    private pauseAutoDestroy(): void {
        if (this.timeoutDestroyText === null) {
            return;
        }
        clearTimeout(this.timeoutDestroyText);
        this.timeoutDestroyText = null;
        this.autoDestroyRemainingMs = Math.max(
            0,
            this.autoDestroyRemainingMs - (Date.now() - this.autoDestroyStartedAt),
        );
    }

    private resumeAutoDestroy(): void {
        if (!this.autoDestroyPending || this.timeoutDestroyText !== null || this.pointerInside || this.focusInside) {
            return;
        }
        this.autoDestroyRemainingMs = Math.max(this.autoDestroyRemainingMs, MIN_REMAINING_AFTER_PAUSE_MS);
        this.startAutoDestroyTimer();
    }

    public destroy() {
        if (this.span) {
            this.span.removeEventListener("click", this.callback);
            this.span.removeEventListener("mouseenter", this.onPointerEnter);
            this.span.removeEventListener("mouseleave", this.onPointerLeave);
            this.span.removeEventListener("focusin", this.onFocusIn);
            this.span.removeEventListener("focusout", this.onFocusOut);
            this.removeEscapeHintListener(this.span);
        }
        this.removeActionButtons();
        this.autoDestroyPending = false;
        if (this.timeoutDestroyText) {
            clearTimeout(this.timeoutDestroyText);
            this.timeoutDestroyText = null;
        }
        super.destroy();
    }
}
