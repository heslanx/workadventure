# Common Issues

| Issue                                               | Solution                                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JavaScript heap out of memory during the Play build | Run with `NODE_OPTIONS=--max-old-space-size=16384 npm run build` from `play/`.                                                                               |
| `Cannot find module 'ts-proto-generated'`           | Install dependencies in `messages/`, then run `npm run ts-proto`.                                                                                            |
| Generated i18n types are missing or stale           | Run `npm run typesafe-i18n` from `play/`.                                                                                                                    |
| Vite in Docker does not see a file saved on macOS   | With Colima, set `mountInotify: true`. If saves still go unseen (editors that save by renaming a temp file), start the stack with `VITE_WATCH_POLLING=true`. |
| A Vitest test fails with `window is not defined`    | `play` tests run in Node by default. Put `// @vitest-environment jsdom` on the test file's first line.                                                       |
