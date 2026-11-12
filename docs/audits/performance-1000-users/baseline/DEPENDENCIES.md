# Inventário de dependências do WorkAdventure

Commit `ddbe245a84c78c947dd9ae5310da1fc53cd3d278`. Inventário estático dos arquivos rastreados pelo Git.

20 manifestos; 419 declarações diretas; 217 nomes distintos. Inclui pacotes internos e ferramentas de desenvolvimento.

2901 entradas de instalação nos cinco package-lock.json; 1919 pares nome/versão distintos. Os dois yarn.lock adicionam 97 registros de seletores, com sobreposição; não se deve somar como pacotes distintos.

As versões abaixo são as declarações dos manifestos. As versões resolvidas constam de npm-locked-dependencies.csv e yarn-locked-dependencies.csv. Lockfiles de subprojetos podem representar instalações antigas ou independentes; esta lista não mede o bundle do navegador.

## Arquivos completos

- direct-dependencies.csv: todas as declarações diretas e seu escopo.
- npm-locked-dependencies.csv: todas as entradas npm, incluindo dependências transitivas e versões duplicadas.
- yarn-locked-dependencies.csv: todos os seletores e versões dos lockfiles Yarn.
- container-images.csv: imagens referenciadas nos Dockerfiles e arquivos Compose.
- helm-image-declarations.csv: expressões de imagens nos templates Helm, incluindo busybox do init container; os valores finais dependem dos values e subcharts.
- docker-os-packages.csv: instalações explícitas de pacotes de sistema nos Dockerfiles.

Dependências internas das imagens, pacotes do sistema herdados das imagens-base, serviços SaaS e iframes externos não foram expandidos. Isso exige imagens concretas por digest e um SBOM da implantação.

## back/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@anatine/zod-openapi` | `^2.2.8` | dependencies |
| `@aws-sdk/client-s3` | `^3.1054.0` | dependencies |
| `@grpc/grpc-js` | `^1.14.4` | dependencies |
| `@grpc/proto-loader` | `0.8.1` | dependencies |
| `@sentry/node` | `^10.54.0` | dependencies |
| `@types/express` | `^5.0.6` | dependencies |
| `@workadventure/messages` | `1.0.0` | dependencies |
| `@workadventure/shared-utils` | `1.0.0` | dependencies |
| `@workadventure/tiled-map-type-guard` | `^2.1.2` | dependencies |
| `axios` | `^1.16.1` | dependencies |
| `bigbluebutton-js` | `^0.2.0` | dependencies |
| `busboy` | `^1.6.0` | dependencies |
| `debug` | `^4.4.3` | dependencies |
| `deepmerge-ts` | `^7.1.5` | dependencies |
| `express` | `^5.2.1` | dependencies |
| `fast-json-patch` | `^3.1.1` | dependencies |
| `google-protobuf` | `^4.0.2` | dependencies |
| `jose` | `^6.2.3` | dependencies |
| `livekit-server-sdk` | `^2.15.3` | dependencies |
| `mkdirp` | `^3.0.1` | dependencies |
| `openapi3-ts` | `^4.5.0` | dependencies |
| `prom-client` | `^15.1.3` | dependencies |
| `protobuf-fieldmask` | `^2.0.0` | dependencies |
| `query-string` | `^9.5.1` | dependencies |
| `redis` | `^5.12.1` | dependencies |
| `rxjs` | `^7.8.2` | dependencies |
| `source-map-support` | `^0.5.21` | dependencies |
| `tsx` | `^4.22.3` | dependencies |
| `uuidv4` | `^6.0.7` | dependencies |
| `zod` | `^3.25.76` | dependencies |
| `@types/bigbluebutton-js` | `^0.2.3` | devDependencies |
| `@types/busboy` | `^1.5.4` | devDependencies |
| `@types/debug` | `^4.1.13` | devDependencies |
| `@types/google-protobuf` | `^3.15.12` | devDependencies |
| `@types/http-status-codes` | `^1.2.0` | devDependencies |
| `@types/mkdirp` | `^1.0.2` | devDependencies |
| `@types/node` | `^25.9.1` | devDependencies |
| `@workadventure/eslint-config` | `1.0.0` | devDependencies |
| `catch-unknown` | `^2.0.0` | devDependencies |
| `eslint` | `^9.39.4` | devDependencies |
| `lint-staged` | `^17.0.5` | devDependencies |
| `prettier` | `^3.8.3` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |
| `vitest` | `^4.1.7` | devDependencies |
| `vitest-mock-extended` | `^4.0.0` | devDependencies |

## benchmark/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@types/ws` | `^8.18.1` | dependencies |
| `@workadventure/messages` | `1.0.0` | dependencies |
| `ts-node-dev` | `^2.0.0` | dependencies |
| `typescript` | `^5.9.3` | dependencies |
| `ws` | `^8.21.0` | dependencies |

## contrib/tools/e2e-report/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@types/node` | `^25.9.1` | devDependencies |
| `tsx` | `^4.22.3` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |

## contrib/tools/generate-env-docs/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@types/node` | `^25.9.1` | dependencies |
| `@workadventure/messages` | `1.0.0` | dependencies |
| `@workadventure/shared-utils` | `1.0.0` | dependencies |
| `tsx` | `^4.22.3` | dependencies |
| `typescript` | `^5.9.3` | dependencies |
| `zod` | `^3.25.76` | dependencies |

## desktop/electron/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `electron-log` | `^4.4.6` | dependencies |
| `electron-settings` | `^4.0.2` | dependencies |
| `electron-updater` | `^6.8.10` | dependencies |
| `electron-window-state` | `^5.0.3` | dependencies |
| `@fontsource/oswald` | `^5.3.0` | devDependencies |
| `@fontsource/roboto-condensed` | `^5.3.0` | devDependencies |
| `@sveltejs/vite-plugin-svelte` | `^7.3.1` | devDependencies |
| `@tailwindcss/vite` | `^4.3.4` | devDependencies |
| `@typescript-eslint/eslint-plugin` | `^8.72.1` | devDependencies |
| `@typescript-eslint/parser` | `^8.72.1` | devDependencies |
| `@workadventure/design-system` | `^3.0.4` | devDependencies |
| `@workadventure/desktop-api` | `file:../../libs/desktop-api` | devDependencies |
| `electron` | `^45.0.0` | devDependencies |
| `electron-builder` | `^26.15.3` | devDependencies |
| `electron-vite` | `^6.0.0` | devDependencies |
| `eslint` | `^8.12.0` | devDependencies |
| `prettier` | `^2.6.2` | devDependencies |
| `svelte` | `^5.57.3` | devDependencies |
| `svelte-check` | `^4.7.8` | devDependencies |
| `tailwindcss` | `^4.3.4` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |
| `vite` | `^8.3.5` | devDependencies |
| `vitest` | `^4.1.7` | devDependencies |

## libs/eslint-config/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@eslint/compat` | `^2.1.0` | dependencies |
| `@eslint/js` | `^9.39.4` | dependencies |
| `@smarttools/eslint-plugin-rxjs` | `^1.0.22` | dependencies |
| `@typescript-eslint/parser` | `^8.60.0` | dependencies |
| `eslint-import-resolver-typescript` | `^4.4.4` | dependencies |
| `eslint-plugin-import` | `^2.32.0` | dependencies |
| `eslint-plugin-listeners` | `^1.5.1` | dependencies |
| `eslint-plugin-svelte` | `^3.18.0` | dependencies |
| `globals` | `^17.6.0` | dependencies |
| `svelte-eslint-parser` | `^1.6.1` | dependencies |
| `typescript-eslint` | `^8.60.0` | dependencies |
| `eslint` | `^9.39.4` | peerDependencies |

## libs/map-editor/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@types/uuid` | `^10.0.0` | dependencies |
| `@workadventure/math-utils` | `1.0.0` | dependencies |
| `@workadventure/messages` | `1.0.0` | dependencies |
| `@workadventure/shared-utils` | `^1.0.0` | dependencies |
| `@workadventure/tiled-map-type-guard` | `^2.1.2` | dependencies |
| `axios` | `^1.16.1` | dependencies |
| `catch-unknown` | `^2.0.0` | dependencies |
| `deepmerge-ts` | `^7.1.5` | dependencies |
| `ipaddr.js` | `^2.4.0` | dependencies |
| `uuid` | `^14.0.0` | dependencies |
| `zod` | `^3.25.76` | dependencies |
| `zod-to-json-schema` | `^3.25.2` | dependencies |
| `@types/node` | `^25.9.1` | devDependencies |
| `@workadventure/eslint-config` | `1.0.0` | devDependencies |
| `eslint` | `^9.39.4` | devDependencies |
| `lint-staged` | `^17.0.5` | devDependencies |
| `prettier` | `^3.8.3` | devDependencies |
| `tsx` | `^4.22.3` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |
| `vitest` | `^4.1.7` | devDependencies |

## libs/math-utils/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@types/node` | `^25.9.1` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |

## libs/messages/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@anatine/zod-openapi` | `^2.2.8` | dependencies |
| `@bufbuild/protobuf` | `^2.12.0` | dependencies |
| `@grpc/grpc-js` | `^1.14.4` | dependencies |
| `google-protobuf` | `^4.0.2` | dependencies |
| `long` | `^5.3.2` | dependencies |
| `openapi3-ts` | `^4.5.0` | dependencies |
| `rxjs` | `7.8.2` | dependencies |
| `zod` | `^3.25.76` | dependencies |
| `@types/node` | `^25.9.1` | devDependencies |
| `tsx` | `^4.22.3` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |
| `zod-to-json-schema` | `^3.25.2` | devDependencies |

## libs/room-api-clients/room-api-client-js/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@bufbuild/protobuf` | `^2.12.0` | dependencies |
| `@grpc/grpc-js` | `1.14.4` | dependencies |
| `long` | `^5.3.2` | dependencies |
| `nice-grpc` | `^2.1.16` | dependencies |
| `@types/node` | `^25.9.1` | devDependencies |
| `@workadventure/eslint-config` | `file:../../eslint-config` | devDependencies |
| `eslint` | `^10.4.0` | devDependencies |
| `grpc-tools` | `^1.13.1` | devDependencies |
| `lint-staged` | `^17.0.5` | devDependencies |
| `prettier` | `^3.8.3` | devDependencies |
| `ts-proto` | `^2.11.8` | devDependencies |
| `tsx` | `^4.22.3` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |

## libs/shared-utils/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@grpc/grpc-js` | `^1.14.4` | dependencies |
| `@workadventure/map-editor` | `1.0.0` | dependencies |
| `@workadventure/tiled-map-type-guard` | `^2.1.2` | dependencies |
| `axios` | `^1.16.1` | dependencies |
| `catch-unknown` | `^2.0.0` | dependencies |
| `debug` | `^4.4.3` | dependencies |
| `rxjs` | `^7.8.2` | dependencies |
| `zod` | `^3.25.76` | dependencies |
| `@types/debug` | `^4.1.13` | devDependencies |
| `@types/node` | `^25.9.1` | devDependencies |
| `@workadventure/eslint-config` | `1.0.0` | devDependencies |
| `eslint` | `^9.39.4` | devDependencies |
| `lint-staged` | `^17.0.5` | devDependencies |
| `prettier` | `^3.8.3` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |
| `vitest` | `^4.1.7` | devDependencies |

## libs/store-utils/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@types/debug` | `^4.1.13` | devDependencies |
| `@types/node` | `^25.9.1` | devDependencies |
| `@workadventure/eslint-config` | `1.0.0` | devDependencies |
| `eslint` | `^9.39.4` | devDependencies |
| `lint-staged` | `^17.0.5` | devDependencies |
| `svelte` | `^5.55.9` | devDependencies |
| `svelte-check` | `^4.4.8` | devDependencies |
| `prettier` | `^3.8.3` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |
| `rxjs` | `^7.8.2` | devDependencies |
| `vitest` | `^4.1.7` | devDependencies |

## libs/tailwind/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@tailwindcss/forms` | `^0.5.11` | dependencies |
| `@workadventure/design-system` | `^3.0.1` | dependencies |
| `tailwindcss` | `^4.3.0` | dependencies |

## map-storage/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@aws-sdk/client-s3` | `^3.1054.0` | dependencies |
| `@grpc/grpc-js` | `^1.14.4` | dependencies |
| `@grpc/proto-loader` | `^0.8.1` | dependencies |
| `@sentry/node` | `^10.54.0` | dependencies |
| `@tsconfig/svelte` | `^5.0.8` | dependencies |
| `@workadventure/map-editor` | `1.0.0` | dependencies |
| `@workadventure/messages` | `1.0.0` | dependencies |
| `@workadventure/shared-utils` | `1.0.0` | dependencies |
| `@workadventure/tiled-map-type-guard` | `^2.1.2` | dependencies |
| `axios` | `^1.16.1` | dependencies |
| `axios-cache-interceptor` | `^1.12.0` | dependencies |
| `body-parser` | `^2.3.0` | dependencies |
| `busboy` | `1.6.0` | dependencies |
| `catch-unknown` | `^2.0.0` | dependencies |
| `concurrently` | `^9.2.5` | dependencies |
| `cors` | `^2.8.6` | dependencies |
| `express` | `^5.2.1` | dependencies |
| `fast-json-patch` | `^3.1.1` | dependencies |
| `fs-extra` | `^11.3.5` | dependencies |
| `google-protobuf` | `^4.0.2` | dependencies |
| `jose` | `^6.2.3` | dependencies |
| `mime` | `^4.1.0` | dependencies |
| `multer` | `^2.1.1` | dependencies |
| `nodemon` | `^3.1.14` | dependencies |
| `npm-check-updates` | `^22.2.1` | dependencies |
| `p-limit` | `^7.3.0` | dependencies |
| `passport` | `^0.7.0` | dependencies |
| `passport-http` | `^0.3.0` | dependencies |
| `passport-http-bearer` | `^1.0.1` | dependencies |
| `reflect-metadata` | `^0.2.2` | dependencies |
| `rimraf` | `^6.1.3` | dependencies |
| `rxjs` | `^7.8.2` | dependencies |
| `tsx` | `^4.22.3` | dependencies |
| `unzipper` | `^0.12.3` | dependencies |
| `zip-stream` | `^7.0.5` | dependencies |
| `zod` | `^3.23.8` | dependencies |
| `zod-error` | `^1.5.0` | dependencies |
| `zod-to-json-schema` | `^3.25.2` | dependencies |
| `@sveltejs/vite-plugin-svelte` | `^7.1.2` | devDependencies |
| `@total-typescript/ts-reset` | `^0.6.1` | devDependencies |
| `@types/cors` | `^2.8.19` | devDependencies |
| `@types/express` | `^5.0.6` | devDependencies |
| `@types/fs-extra` | `^11.0.4` | devDependencies |
| `@types/mime` | `^3.0.4` | devDependencies |
| `@types/multer` | `^2.1.0` | devDependencies |
| `@types/node` | `^25.9.1` | devDependencies |
| `@types/passport` | `^1.0.17` | devDependencies |
| `@types/passport-http` | `^0.3.11` | devDependencies |
| `@types/passport-http-bearer` | `^1.0.42` | devDependencies |
| `@types/unzipper` | `^0.10.11` | devDependencies |
| `@types/zip-stream` | `^7.0.0` | devDependencies |
| `@workadventure/eslint-config` | `1.0.0` | devDependencies |
| `eslint` | `^9.39.4` | devDependencies |
| `lint-staged` | `^17.0.5` | devDependencies |
| `prettier` | `^3.8.3` | devDependencies |
| `prettier-plugin-svelte` | `^4.0.1` | devDependencies |
| `source-map-support` | `^0.5.21` | devDependencies |
| `svelte` | `^5.55.9` | devDependencies |
| `svelte-check` | `^4.4.8` | devDependencies |
| `ts-loader` | `^9.5.7` | devDependencies |
| `tsconfig-paths` | `4.2.0` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |
| `vite` | `^8.0.16` | devDependencies |
| `vitest` | `^4.1.7` | devDependencies |

## maps/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@workadventure/iframe-api-typings` | `^1.30.7` | devDependencies |

## messages/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@anatine/zod-openapi` | `^2.2.8` | dependencies |
| `@grpc/grpc-js` | `^1.14.4` | dependencies |
| `google-protobuf` | `^4.0.2` | dependencies |
| `npm-run-all` | `^4.1.5` | dependencies |
| `openapi3-ts` | `^4.5.0` | dependencies |
| `ts-proto` | `^2.11.8` | dependencies |
| `zod` | `^3.25.76` | dependencies |
| `@bufbuild/protobuf` | `^2.12.0` | devDependencies |
| `@types/google-protobuf` | `^3.15.12` | devDependencies |
| `@types/node` | `^25.9.1` | devDependencies |
| `@typescript-eslint/eslint-plugin` | `^7.18.0` | devDependencies |
| `@typescript-eslint/parser` | `^7.18.0` | devDependencies |
| `chokidar-cli` | `^3.0.0` | devDependencies |
| `dtslint` | `^4.0.5` | devDependencies |
| `eslint` | `^8.56.0` | devDependencies |
| `eslint-config-airbnb-typescript` | `^18.0.0` | devDependencies |
| `eslint-plugin-import` | `^2.32.0` | devDependencies |
| `eslint-plugin-sonarjs` | `^4.0.3` | devDependencies |
| `grpc_tools_node_protoc_ts` | `^5.3.3` | devDependencies |
| `grpc-tools` | `^1.13.1` | devDependencies |
| `lint-staged` | `^17.0.5` | devDependencies |
| `prettier` | `^3.8.3` | devDependencies |
| `rimraf` | `^6.1.3` | devDependencies |
| `shelljs` | `^0.10.0` | devDependencies |
| `sync-directory` | `^6.0.5` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |

## package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `husky` | `^9.1.7` | devDependencies |
| `patch-package` | `^8.0.1` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |

## play/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `@16bits/nes.css` | `^2.3.2` | dependencies |
| `@anatine/zod-openapi` | `^2.2.8` | dependencies |
| `@aws-sdk/client-s3` | `^3.1054.0` | dependencies |
| `@aws-sdk/s3-request-presigner` | `^3.1054.0` | dependencies |
| `@floating-ui/dom` | `^1.7.6` | dependencies |
| `@fontsource/press-start-2p` | `^5.2.7` | dependencies |
| `@fontsource/roboto` | `^5.2.10` | dependencies |
| `@fontsource/roboto-condensed` | `^5.2.8` | dependencies |
| `@grpc/grpc-js` | `^1.14.4` | dependencies |
| `@jitsi/rnnoise-wasm` | `^0.2.1` | dependencies |
| `@livekit/track-processors` | `^0.7.2` | dependencies |
| `@mediapipe/tasks-vision` | `^0.10.35` | dependencies |
| `@sentry/browser` | `^10.54.0` | dependencies |
| `@sentry/node` | `^10.54.0` | dependencies |
| `@sentry/svelte` | `^10.54.0` | dependencies |
| `@sveltejs/svelte-virtual-list` | `^3.0.1` | dependencies |
| `@tailwindcss/forms` | `^0.5.11` | dependencies |
| `@tsconfig/svelte` | `^5.0.8` | dependencies |
| `@workadventure/desktop-api` | `1.0.0` | dependencies |
| `@workadventure/eslint-config` | `1.0.0` | dependencies |
| `@workadventure/map-editor` | `1.0.0` | dependencies |
| `@workadventure/math-utils` | `1.0.0` | dependencies |
| `@workadventure/messages` | `1.0.0` | dependencies |
| `@workadventure/noise-suppression` | `^0.2.0` | dependencies |
| `@workadventure/shared-utils` | `1.0.0` | dependencies |
| `@workadventure/simple-peer` | `^12.3.0` | dependencies |
| `@workadventure/store-utils` | `1.0.0` | dependencies |
| `@workadventure/tailwind` | `1.0.0` | dependencies |
| `@workadventure/tiled-map-type-guard` | `^2.1.2` | dependencies |
| `axios` | `^1.16.1` | dependencies |
| `axios-cache-interceptor` | `^1.12.0` | dependencies |
| `axios-retry` | `^4.5.0` | dependencies |
| `buffer` | `^6.0.3` | dependencies |
| `cancelable-promise` | `^4.3.1` | dependencies |
| `catch-unknown` | `^2.0.0` | dependencies |
| `cheerio` | `^1.2.0` | dependencies |
| `chroma-js` | `^3.2.0` | dependencies |
| `concurrently` | `^9.2.5` | dependencies |
| `cookie-parser` | `^1.4.7` | dependencies |
| `cors` | `^2.8.6` | dependencies |
| `cross-env` | `^10.1.0` | dependencies |
| `debug` | `^4.4.3` | dependencies |
| `deepmerge-ts` | `^7.1.5` | dependencies |
| `dompurify` | `^3.4.13` | dependencies |
| `easystarjs` | `^0.4.4` | dependencies |
| `emoji-picker-element` | `^1.29.1` | dependencies |
| `express` | `^5.2.1` | dependencies |
| `fast-deep-equal` | `^3.1.3` | dependencies |
| `fast-json-patch` | `^3.1.1` | dependencies |
| `google-protobuf` | `^4.0.2` | dependencies |
| `highlight-words` | `^2.0.0` | dependencies |
| `highlight.js` | `^11.11.1` | dependencies |
| `hyper-express` | `^6.17.3` | dependencies |
| `jose` | `^6.2.3` | dependencies |
| `limiter` | `^3.0.0` | dependencies |
| `live-directory` | `moufmouf/live-directory#hot_reload_param` | dependencies |
| `livekit-client` | `^2.23.0` | dependencies |
| `livekit-server-sdk` | `^2.15.3` | dependencies |
| `marked` | `^18.0.4` | dependencies |
| `marked-highlight` | `^2.2.4` | dependencies |
| `matrix-js-sdk` | `^42.4.0` | dependencies |
| `mustache` | `^4.2.0` | dependencies |
| `openapi3-ts` | `^4.5.0` | dependencies |
| `openid-client` | `^5.7.1` | dependencies |
| `p-limit` | `^7.3.0` | dependencies |
| `phaser` | `4.2.0` | dependencies |
| `phaser4-rex-plugins` | `4.0.7` | dependencies |
| `prom-client` | `^15.1.3` | dependencies |
| `protobuf-fieldmask` | `^2.0.0` | dependencies |
| `qs` | `^6.16.0` | dependencies |
| `queue-typescript` | `^1.0.1` | dependencies |
| `quill` | `2.0.3` | dependencies |
| `quill-delta-to-html` | `^0.12.1` | dependencies |
| `redis` | `^5.12.1` | dependencies |
| `rxjs` | `^7.8.2` | dependencies |
| `sdp-transform` | `^2.15.0` | dependencies |
| `source-map-support` | `^0.5.21` | dependencies |
| `stanza` | `^12.22.1` | dependencies |
| `svelte-modals` | `^2.0.1` | dependencies |
| `svelte-outside` | `^0.0.5` | dependencies |
| `svelte-pan-zoom` | `^0.0.13` | dependencies |
| `svelte-select` | `^5.8.3` | dependencies |
| `swagger-jsdoc` | `^6.3.0` | dependencies |
| `swagger-ui-dist` | `^5.32.6` | dependencies |
| `throttle-debounce` | `^5.0.2` | dependencies |
| `ts-proto-descriptors` | `^2.1.0` | dependencies |
| `tsx` | `^4.22.3` | dependencies |
| `typesafe-i18n` | `^5.27.1` | dependencies |
| `unplugin-icons` | `^23.0.1` | dependencies |
| `uuid` | `^14.0.0` | dependencies |
| `uWebSockets.js` | `github:uNetworking/uWebSockets.js#v20.67.0` | dependencies |
| `zod` | `^3.25.76` | dependencies |
| `@iconify-json/tabler` | `^1.2.35` | devDependencies |
| `@posthog/types` | `^1.376.2` | devDependencies |
| `@rollup/plugin-inject` | `^5.0.5` | devDependencies |
| `@sentry/cli` | `^3.5.1` | devDependencies |
| `@sentry/vite-plugin` | `^5.3.0` | devDependencies |
| `@sveltejs/vite-plugin-svelte` | `^7.1.2` | devDependencies |
| `@tailwindcss/vite` | `^4.3.0` | devDependencies |
| `@types/chroma-js` | `^3.1.2` | devDependencies |
| `@types/cookie-parser` | `^1.4.10` | devDependencies |
| `@types/cors` | `^2.8.19` | devDependencies |
| `@types/debug` | `^4.1.13` | devDependencies |
| `@types/dom-screen-wake-lock` | `^1.0.3` | devDependencies |
| `@types/express` | `^5.0.6` | devDependencies |
| `@types/google-protobuf` | `^3.15.12` | devDependencies |
| `@types/http-status-codes` | `^1.2.0` | devDependencies |
| `@types/jsonwebtoken` | `^9.0.10` | devDependencies |
| `@types/mustache` | `^4.2.6` | devDependencies |
| `@types/node` | `^25.9.1` | devDependencies |
| `@types/qs` | `^6.15.1` | devDependencies |
| `@types/quill` | `^2.0.14` | devDependencies |
| `@types/sdp-transform` | `^2.15.0` | devDependencies |
| `@types/swagger-jsdoc` | `^6.0.4` | devDependencies |
| `@types/throttle-debounce` | `^5.0.2` | devDependencies |
| `@types/uuid` | `^10.0.0` | devDependencies |
| `@types/xmpp__client` | `^0.14.1` | devDependencies |
| `@types/xmpp__jid` | `^1.3.3` | devDependencies |
| `eslint` | `^9.39.4` | devDependencies |
| `eslint-plugin-svelte` | `^3.18.0` | devDependencies |
| `globals` | `^17.6.0` | devDependencies |
| `jsdom` | `^29.1.1` | devDependencies |
| `lint-staged` | `^17.0.5` | devDependencies |
| `patch-package` | `^8.0.1` | devDependencies |
| `prettier` | `^3.8.3` | devDependencies |
| `prettier-plugin-svelte` | `^4.0.1` | devDependencies |
| `svelte` | `^5.55.9` | devDependencies |
| `svelte-check` | `^4.4.8` | devDependencies |
| `svelte-eslint-parser` | `^1.6.1` | devDependencies |
| `tailwindcss` | `^4.3.0` | devDependencies |
| `tslib` | `^2.8.1` | devDependencies |
| `typescript` | `^5.9.3` | devDependencies |
| `vite` | `^8.1.4` | devDependencies |
| `vite-plugin-node-polyfills` | `^0.28.0` | devDependencies |
| `vite-tsconfig-paths` | `^6.1.1` | devDependencies |
| `vitest` | `^4.1.7` | devDependencies |
| `vitest-mock-extended` | `^4.0.0` | devDependencies |
| `vitest-websocket-mock` | `^0.5.0` | devDependencies |

## play/packages/iframe-api-typings/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `rxjs` | `^7.8.2` | dependencies |
| `zod` | `^3.25.76` | dependencies |

## tests/package.json

| Dependência | Versão declarada | Escopo |
|---|---|---|
| `catch-unknown` | `^2.0.0` | dependencies |
| `@playwright/test` | `^1.63.0` | devDependencies |
| `@types/adm-zip` | `^0.5.0` | devDependencies |
| `@types/dockerode` | `^3.3.11` | devDependencies |
| `@workadventure/eslint-config` | `1.0.0` | devDependencies |
| `@workadventure/iframe-api-typings` | `^1.25.6` | devDependencies |
| `adm-zip` | `^0.6.0` | devDependencies |
| `axios` | `^1.15.2` | devDependencies |
| `dockerode` | `^3.3.4` | devDependencies |
| `dotenv-cli` | `^6.0.0` | devDependencies |
| `eslint` | `^9.39.4` | devDependencies |
| `eslint-plugin-playwright` | `^2.2.2` | devDependencies |
| `lint-staged` | `^13.0.3` | devDependencies |
| `prettier` | `^3.8.3` | devDependencies |

## Imagens de containers

| Fonte | Linha | Declaração |
|---|---:|---|
| `back/Dockerfile` | 2 | `FROM --platform=$BUILDPLATFORM node:24-trixie-slim AS proto-builder` |
| `back/Dockerfile` | 11 | `FROM node:24-trixie-slim` |
| `contrib/docker/docker-compose.prod.yaml` | 3 | `image: traefik:v3.6.1` |
| `contrib/docker/docker-compose.prod.yaml` | 31 | `image: thecodingmachine/workadventure-play:${VERSION}` |
| `contrib/docker/docker-compose.prod.yaml` | 171 | `image: thecodingmachine/workadventure-back:${VERSION}` |
| `contrib/docker/docker-compose.prod.yaml` | 228 | `image: matthiasluedtke/iconserver:v3.21.0` |
| `contrib/docker/docker-compose.prod.yaml` | 254 | `image: redis:6` |
| `contrib/docker/docker-compose.prod.yaml` | 260 | `image: thecodingmachine/workadventure-map-storage:${VERSION}` |
| `contrib/docker/tests/docker-compose.test.yaml` | 14 | `image: thecodingmachine/php:8.1-v4-apache-node12` |
| `contrib/docker/tests/docker-compose.test.yaml` | 41 | `image: livekit/livekit-server:v1.13.11` |
| `contrib/docker/tests/docker-compose.test.yaml` | 68 | `image: livekit/egress:v1.15.0` |
| `contrib/docker/tests/docker-compose.test.yaml` | 94 | `image: rustfs/rustfs:1.0.0-alpha.83` |
| `contrib/docker/tests/docker-compose.test.yaml` | 124 | `image: amazon/aws-cli:2.31.1` |
| `docker-compose.e2e.yml` | 13 | `image: ghcr.io/workadventure/play-dev-build:amd64-${GITHUB_SHA}` |
| `docker-compose.e2e.yml` | 59 | `image: ghcr.io/workadventure/back-dev-build:amd64-${GITHUB_SHA}` |
| `docker-compose.e2e.yml` | 77 | `image: ghcr.io/workadventure/map-storage-dev-build:amd64-${GITHUB_SHA}` |
| `docker-compose.e2e.yml` | 99 | `image: ghcr.io/workadventure/maps-dev-build:amd64-${GITHUB_SHA}` |
| `docker-compose.e2e.yml` | 120 | `image: alpine:3.14` |
| `docker-compose.livekit.yaml` | 3 | `image: livekit/livekit-server:v1.13.11` |
| `docker-compose.livekit.yaml` | 23 | `image: livekit/egress:v1.15.0` |
| `docker-compose.livekit.yaml` | 57 | `image: rustfs/rustfs:1.0.0-alpha.83` |
| `docker-compose.livekit.yaml` | 75 | `image: amazon/aws-cli:2.31.1` |
| `docker-compose.rustfs.yaml` | 9 | `image: rustfs/rustfs:1.0.0-alpha.83` |
| `docker-compose.rustfs.yaml` | 29 | `image: amazon/aws-cli:2.31.1` |
| `docker-compose.yaml` | 3 | `image: traefik:v3.6.1` |
| `docker-compose.yaml` | 34 | `image: ghcr.io/thecodingmachine/nodejs:v2-24-trixie` |
| `docker-compose.yaml` | 215 | `image: thecodingmachine/php:8.1-v4-apache-node12` |
| `docker-compose.yaml` | 235 | `image: ghcr.io/thecodingmachine/nodejs:v2-24-trixie` |
| `docker-compose.yaml` | 288 | `image: ghcr.io/thecodingmachine/nodejs:v2-24-trixie` |
| `docker-compose.yaml` | 330 | `image: ghcr.io/thecodingmachine/nodejs:v2-24-trixie-build` |
| `docker-compose.yaml` | 343 | `image: redis:6` |
| `docker-compose.yaml` | 346 | `image: redislabs/redisinsight:latest` |
| `docker-compose.yaml` | 354 | `image: matthiasluedtke/iconserver:v3.21.0` |
| `docker-compose.yaml` | 363 | `image: ghcr.io/soluto/oidc-server-mock:0.7.0` |
| `docker-compose.yaml` | 487 | `image: matrixdotorg/synapse:v1.140.0` |
| `map-storage/Dockerfile` | 6 | `FROM --platform=$BUILDPLATFORM node:24-trixie-slim AS proto-builder` |
| `map-storage/Dockerfile` | 15 | `FROM --platform=$BUILDPLATFORM node:24-trixie-slim AS builder` |
| `map-storage/Dockerfile` | 37 | `FROM node:24-trixie-slim` |
| `maps/Dockerfile` | 1 | `FROM thecodingmachine/php:8.1-v4-apache-node12` |
| `play/Dockerfile` | 6 | `FROM --platform=$BUILDPLATFORM node:24-trixie-slim AS proto-builder` |
| `play/Dockerfile` | 15 | `FROM --platform=$BUILDPLATFORM node:24-trixie-slim AS builder` |
| `play/Dockerfile` | 58 | `FROM ${PREVIOUS_FRONT_IMAGE} AS previous-front` |
| `play/Dockerfile` | 65 | `FROM nginx:1.30-alpine3.24 AS front` |
| `play/Dockerfile` | 73 | `FROM node:24-trixie-slim` |

## Dependências Helm

| Chart | Versão declarada | Condição |
|---|---|---|
| redis | 17.11.7 | infraestrutura Redis |
| common | 2.x.x | biblioteca Helm |
| livekit-server | 1.9.0 | livekit.enabled |
| egress | 1.8.4 | livekit.egress.enabled |

Fonte: contrib/helm/Chart.yaml. Chart.lock registra common 2.36.0; as versões dos charts não são as versões dos servidores.
