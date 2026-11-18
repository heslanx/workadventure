# AGENTS.md - messages/

Protocol Buffer definitions and generated TypeScript.

## Build (run before other services that depend on messages)
```bash
npm install
npm run ts-proto
```

## Fork protocol rule
- The Konclui fork stays wire-compatible with upstream through phase 3 of the engine plan. Do not edit `messages/protos/*`: no velocity, no sender-side dead reckoning, no ack nonce, no new oneof case, no second proto file. The pusher rejects any other `apiVersionHash`, and the release path runs official server images.
- If the gate in `docs/konclui-migration/decisions.md` (C5) trips, fork additions are `optional` fields numbered 100 or higher, only in `PositionMessage`, `UserMovesMessage` and `UserMovedMessage`. Never add a oneof case. Never touch the nonce envelope.
- Any such addition first needs fork-built server images in the release path.

## Common issue
- "Cannot find module 'ts-proto-generated'": run the build commands above.
