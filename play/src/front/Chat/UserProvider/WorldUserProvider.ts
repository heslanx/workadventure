import type { Readable, Writable } from "svelte/store";
import { derived, writable } from "svelte/store";
import type { PartialAdminUser } from "../Connection/ChatConnection";
import type { SpaceUserExtended } from "../../Space/SpaceInterface";
import type { UserProviderInterface } from "./UserProviderInterface";
import { mapExtendedSpaceUserToChatUser } from "./ChatUserMapper";

export class WorldUserProvider implements UserProviderInterface {
    public readonly users: Readable<PartialAdminUser[]>;
    public readonly userCount: Readable<number>;
    private filter: Writable<string> = writable("");

    /**
     * `world` is the world space, or anything that holds its users in a `usersStore`: an extension that decides when the
     * world is watched hands the chat its own store of them, so that the chat does not subscribe the space's.
     */
    constructor(world: { readonly usersStore: Readable<ReadonlyMap<string, SpaceUserExtended>> }) {
        this.users = derived(
            [world.usersStore, this.filter],
            ([users, filter]) => {
                return Array.from(users.values())
                    .filter((user) => user.name.toLowerCase().includes(filter.toLowerCase()))
                    .map(mapExtendedSpaceUserToChatUser);
            },
            [],
        );
        this.userCount = derived(this.users, (users) => {
            // TOOD FIXME: this is workaround for the fact that we are not using the uuid as the key in the map
            return new Set(users.map((user) => user.uuid)).size;
        });
    }

    setFilter(searchText: string): Promise<void> {
        this.filter.set(searchText);
        return Promise.resolve();
    }
}
