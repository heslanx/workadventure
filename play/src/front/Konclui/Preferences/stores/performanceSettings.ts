import { localUserStore } from "../../../Connection/LocalUserStore";
import { pauseTileAnimations } from "./gameCommands";
import { savedSetting } from "./savedSetting";

/** The map's tile animations. Upstream saves the opposite, "disable animations", and the running map is told too. */
export const mapAnimations = savedSetting(
    () => !localUserStore.getDisableAnimations(),
    (on: boolean) => {
        localUserStore.setDisableAnimations(!on);
        pauseTileAnimations(!on);
    },
);
