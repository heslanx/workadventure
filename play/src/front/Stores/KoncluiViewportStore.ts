import { writable } from "svelte/store";
import type { ViewportBounds } from "./KoncluiLayout";

export const koncluiViewportStore = writable<ViewportBounds | undefined>(undefined);
