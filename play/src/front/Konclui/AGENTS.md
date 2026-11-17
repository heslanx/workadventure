# AGENTS.md - play/src/front/Konclui/

The Konclui bounded context: the office shell and the Konclui features of the client. It sits downstream of
WorkAdventure. It reads upstream stores and classes as they are, and upstream never imports it.

## The seam

- `integration.ts` is the composition root. `installKonclui()` registers every Konclui adapter through the ports in
  `../ExternalModule/ClientExtensionPoints.ts`.
- `play/src/svelte.ts` is the only upstream file that imports this folder, once, to call `installKonclui()`.
- To change upstream behaviour, add or widen a port in `ClientExtensionPoints.ts`. An empty port must keep the
  upstream behaviour. Do not import Konclui from an upstream file.
- Tokens enter through `libs/tailwind/style/konclui.css`, imported by `libs/tailwind/style/index.css`.

## Domains and layers

Each domain is a folder (`Shell`, `Presence`, `Workplace`, `Rooms`, `Expression`, `Identity`, `Ambience`,
`Notifications`, `Preferences`) with up to four layers. Files are named by feature, tests sit beside their source,
and there are no barrel `index.ts` files.

| Layer         | May import                                                                                                  | Must not import                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `domain/`     | other `domain/` files, `zod`, `import type` from the pure modules the test lists                            | `svelte`, `phaser`, stores, components, `window`, `document` |
| `stores/`     | `domain/`, upstream stores, `svelte/store`                                                                  | components, Phaser objects                                   |
| `components/` | `stores/`, `domain/`, upstream stores, upstream components, port stores from `ClientExtensionPoints`, `$LL` | Phaser scene internals                                       |
| `phaser/`     | `domain/`, `stores/` (read), upstream Phaser classes                                                        | components                                                   |

A domain imports another only along the edge table in `architecture.test.ts` (`domainEdges`), and a new domain
folder needs an entry there. `Shell` composes the other domains; no domain imports `Shell`.

## Rules

- Put a decision in `domain/` as a pure function and test it there. Parse admin metadata, Room API events and map
  properties with `zod` in `domain/` before a store sees them.
- User-facing text goes through `$LL.konclui.*`, with the key present in all 17 locales under `play/src/i18n`.
- Observe one element with `ResizeObserver` when you need its size. Do not use `MutationObserver`, `setInterval`, or
  a `setTimeout` under 1000 ms. Write the delay as a number literal: the test rejects one it cannot read.
- A control that cannot act now stays focusable with `aria-disabled` and a visible reason. Do not use `disabled`.
- Report errors. No empty `catch`, and no fallback that hides a failure.
- When closing a surface removes the focused element, move focus to the control that reopens it.
- A test must fail when the change it covers is reverted.

## Checks

Run from `play/` with Node 24 first on `PATH`, one command at a time:

```bash
npm run typesafe-i18n && npm run i18n:check
npm run typecheck && npm run svelte-check && npm run lint && npm run pretty-check
npx vitest run src/front/Konclui src/front/ExternalModule/ClientExtensionPoints.test.ts
```

`architecture.test.ts` is the fitness test. It checks the seam, the `domain/` import allowlist, that `stores/` and `phaser/`
import no component, that `components/` import no `phaser/` file or upstream Phaser module, the domain graph, barrels,
polling and page observers, the overlay flags and empty catches. Review holds the rest of the layer table. When it
fails, change the code, not the rule. A rule changes only with an explicit decision by the context owner, recorded in
the commit that changes the test.

## Related guides

- `../../../AGENTS.md` (play) and the repository `AGENTS.md`
- `docs/konclui-migration/README.md` for product contracts, the isolated runtime and verification
- `docs/agent/svelte.md`, `docs/agent/testing-vitest.md`, `docs/agent/i18n.md`, `docs/agent/typescript-style.md`
