import "./front/style/index.css";

import { mount } from "svelte";
import App from "./front/Components/App.svelte";
import { HtmlUtils } from "./front/WebRtc/HtmlUtils";
import { e2eHooks } from "./front/Utils/E2EHooks";
import { installKonclui } from "./front/Konclui/integration";

// Initialize E2E hooks
declare global {
    interface Window {
        e2eHooks: typeof e2eHooks;
    }
}
window.e2eHooks = e2eHooks;

installKonclui();

const app = mount(App, {
    target: HtmlUtils.getElementByIdOrFail("app"),
});

export default app;
