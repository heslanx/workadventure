"""Extract Method on handleConnectToRoom's three back-stream handlers (stage 1 -> stage 2).

Moves each handler body unchanged except for indentation (12 spaces less) and the two
statements that write and read the close reason, which now go through a holder object.
Usage: python3 -I extract.py <SocketManager.ts>
"""

import sys

path = sys.argv[1]
lines = open(path, encoding="utf-8").read().split("\n")


def at(n):
    return lines[n - 1]


assert at(272) == "            let backConnectionCloseReason: string | undefined;"
assert at(276) == "            streamToBack"
assert at(277) == '                .on("data", (message: ServerToClientMessage) => {'
assert at(317) == "                })"
assert at(318) == '                .on("end", () => {'
assert at(346) == "                })"
assert at(347) == '                .on("error", (err: Error) => {'
assert at(370) == "                });"
assert at(403) == "        }" and at(404) == "    }" and at(405) == ""


def dedent(block):
    out = []
    for line in block:
        if line == "":
            out.append(line)
        else:
            assert line.startswith(" " * 12), line
            out.append(line[12:])
    return out


data_body = dedent(lines[277:316])  # 278-316
end_body = dedent(lines[318:345])  # 319-345
error_body = dedent(lines[347:369])  # 348-369

WRITE_OLD = "                backConnectionCloseReason = message.message.backConnectionCloseReasonMessage.reason;"
WRITE_NEW = "                backConnectionClose.reason = message.message.backConnectionCloseReasonMessage.reason;"
READ_OLD = '                    backConnectionCloseReason ?? "No close reason received from back server.";'
READ_NEW = '                    backConnectionClose.reason ?? "No close reason received from back server.";'
assert data_body.count(WRITE_OLD) == 1 and end_body.count(READ_OLD) == 1
data_body[data_body.index(WRITE_OLD)] = WRITE_NEW
end_body[end_body.index(READ_OLD)] = READ_NEW

registration = [
    '            const backConnectionClose: BackConnectionClose = { reason: undefined };',
]
handlers = [
    "            streamToBack",
    '                .on("data", (message: ServerToClientMessage) =>',
    "                    this.handleMessageFromBack(client, socketData, message, backConnectionClose),",
    "                )",
    '                .on("end", () => this.closeSocketWhenBackEnds(client, socketData, apiClient, backConnectionClose))',
    '                .on("error", (err: Error) => this.closeSocketWhenBackFails(client, socketData, apiClient, err));',
]

methods = (
    [
        "",
        "    private handleMessageFromBack(",
        "        client: PusherWebSocket,",
        "        socketData: SocketData,",
        "        message: ServerToClientMessage,",
        "        backConnectionClose: BackConnectionClose,",
        "    ): void {",
    ]
    + data_body
    + [
        "    }",
        "",
        "    private closeSocketWhenBackEnds(",
        "        client: PusherWebSocket,",
        "        socketData: SocketData,",
        "        apiClient: RoomManagerClient,",
        "        backConnectionClose: BackConnectionClose,",
        "    ): void {",
    ]
    + end_body
    + [
        "    }",
        "",
        "    private closeSocketWhenBackFails(",
        "        client: PusherWebSocket,",
        "        socketData: SocketData,",
        "        apiClient: RoomManagerClient,",
        "        err: Error,",
        "    ): void {",
    ]
    + error_body
    + ["    }"]
)

new = lines[:271] + registration + lines[272:275] + handlers + lines[370:404] + methods + lines[404:]

text = "\n".join(new)

IMPORT_OLD = 'import type { BackConnection } from "../models/Websocket/SocketData";\n'
IMPORT_NEW = 'import type { BackConnection, SocketData } from "../models/Websocket/SocketData";\n'
assert text.count(IMPORT_OLD) == 1
text = text.replace(IMPORT_OLD, IMPORT_NEW)

ANCHOR = 'import { Metadata } from "@grpc/grpc-js";\n'
assert text.count(ANCHOR) == 1
text = text.replace(
    ANCHOR,
    ANCHOR + 'import type { RoomManagerClient } from "@workadventure/messages/src/ts-proto-generated/services";\n',
)

TYPE_ANCHOR = "export class SocketManager implements ZoneEventListener {\n"
assert text.count(TYPE_ANCHOR) == 1
text = text.replace(
    TYPE_ANCHOR,
    "// Written by a socket's back-stream data handler, read by its end handler.\n"
    "type BackConnectionClose = { reason: string | undefined };\n\n" + TYPE_ANCHOR,
)

open(path, "w", encoding="utf-8").write(text)
