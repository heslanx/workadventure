# Inserts the proposed controller-level test into the PR-head PusherRoomSocketController.test.ts (snapshot copy only).
import pathlib, sys
path = pathlib.Path(sys.argv[1])
src = path.read_text()
old_import = 'import { PusherWebSocket, type RawSocket } from "../../src/pusher/services/PusherWebSocket";\n'
new_import = 'import { PusherWebSocket, RESUME_STORE_MAX_MESSAGES, type RawSocket } from "../../src/pusher/services/PusherWebSocket";\n'
anchor = '    it("queues outgoing messages while a transport is closed and flushes them after replacement", async () => {\n'
test = '''    it("destroys the session of a backpressured socket that overflows its resume store, and lets the tab join afresh", async () => {
        vi.useFakeTimers();

        const open = vi.fn();
        const close = vi.fn();
        const controller = createController(
            (handlers) => {
                registeredHandlers = handlers;
            },
            open,
            close,
        );

        const socket = createSocket({ tabId: "tab-1" });
        // uWS runs the close handler synchronously from end().
        getEndMock(socket).mockImplementation((code: number, reason: string) => {
            Promise.resolve(registeredHandlers?.close(socket, code, new TextEncoder().encode(reason).buffer)).catch(
                (e: unknown) => console.error(e),
            );
        });
        // 0 = backpressure: every frame after the first one waits for a drain that never comes.
        getSendMock(socket).mockReturnValue(0);
        await registeredHandlers?.open(socket);

        const wrapper = getContextMap(controller).get("conn-1") as PusherWebSocket;
        for (let i = 0; i <= RESUME_STORE_MAX_MESSAGES; i++) {
            wrapper.send({ message: undefined });
        }
        await flushMicrotasks();

        expect(close).toHaveBeenCalledWith(wrapper, WS_CLOSE_CODE_SESSION_DESTROYED, expect.any(String));
        expect(getContextMap(controller).has("conn-1")).toBe(false);

        // The front does not resume after a 4000 close: it opens a new logical connection.
        const freshSocket = createSocket({ tabId: "tab-1", connectionId: "conn-2" });
        await registeredHandlers?.open(freshSocket);

        expect(open).toHaveBeenCalledTimes(2);
        expect(getContextMap(controller).get("conn-2")).not.toBe(wrapper);
    });

'''
assert src.count(old_import) == 1 and src.count(anchor) == 1
path.write_text(src.replace(old_import, new_import).replace(anchor, test + anchor))
