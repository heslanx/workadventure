"""Move Function: renderItems' body and its helpers from RoomTimeline.svelte to RoomTimelineRenderItems.ts.

usage: python3 -I move_render_items.py <Room dir>
Every moved line is copied verbatim, 4 spaces less indented; each boundary line is asserted first.
"""
import pathlib
import sys

room = pathlib.Path(sys.argv[1])
svelte = room / "RoomTimeline.svelte"
module = room / "RoomTimelineRenderItems.ts"
lines = svelte.read_text().split("\n")


def expect(index: int, text: str) -> None:
    assert lines[index] == text, (index + 1, lines[index], text)


def dedent(block: list[str]) -> list[str]:
    out = []
    for line in block:
        assert line == "" or line.startswith("    "), line
        out.append(line[4:])
    return out


# HEAD line numbers are 1-based; list indexes are 0-based.
expect(84, "    // Time gap threshold for message grouping (5 minutes)")
expect(85, "    const TIME_GAP_THRESHOLD = 5 * 60 * 1000;")
expect(86, "")
expect(242, "    function isValidDate(d: Date) {")
expect(279, "    }")
expect(280, "")
expect(281, "    let renderItems = $derived.by(() => {")
expect(282, "        const out: RoomTimelineRenderItem[] = [];")
expect(283, "        let lastDayKey: string | null = null;")
expect(284, "        let previousMessage: ChatMessage | undefined = undefined;")
expect(285, "        const currentTimelineItems = $timelineItems ?? [];")
expect(286, "")
expect(287, "        for (const timelineItem of currentTimelineItems) {")
expect(337, "        });")
expect(338, "")
expect(339, "        previousRenderItems = reuseUnchangedRenderItems(out, previousRenderItems);")
expect(340, "        return previousRenderItems;")
expect(341, "    });")

constant = dedent(lines[84:86])
helpers = dedent(lines[242:280])
body = dedent(lines[282:285] + lines[286:338])

moved = (
    constant
    + [""]
    + helpers
    + [""]
    + [
        "/**",
        " * The rows of the timeline: a separator before the first item of each local day, and for each item",
        " * whether it shows its sender header and its time.",
        " */",
        "export function buildRenderItems(currentTimelineItems: readonly ChatTimelineItem[]): RoomTimelineRenderItem[] {",
    ]
    + body
    + ["", "    return out;", "}", ""]
)

# The directive is for eslint-plugin-svelte's rune rule, which does not run on .ts files.
directive = "    // eslint-disable-next-line svelte/prefer-svelte-reactivity"
assert moved.count(directive) == 1
moved.remove(directive)

derived = [
    "    let renderItems = $derived.by(() => {",
    "        const out = buildRenderItems($timelineItems ?? []);",
    "        previousRenderItems = reuseUnchangedRenderItems(out, previousRenderItems);",
    "        return previousRenderItems;",
    "    });",
]
new_lines = lines[:84] + lines[87:242] + derived + lines[342:]
text = "\n".join(new_lines)
for old, new in [
    ("        type ChatMessage,\n", ""),
    ("        type ChatTimelineItem,\n", ""),
    (
        'import { reuseUnchangedRenderItems, type RoomTimelineRenderItem } from "./RoomTimelineRenderItems";',
        'import {\n        buildRenderItems,\n        reuseUnchangedRenderItems,\n        type RoomTimelineRenderItem,\n    } from "./RoomTimelineRenderItems";',
    ),
]:
    assert text.count(old) == 1, old
    text = text.replace(old, new)
svelte.write_text(text)

mod = module.read_text()
head = 'import type { ChatTimelineItem } from "../../Connection/ChatConnection";\n'
assert mod.startswith(head)
mod = (
    'import { get } from "svelte/store";\n'
    'import type { ChatMessage, ChatTimelineItem } from "../../Connection/ChatConnection";\n'
    'import LL from "../../../../i18n/i18n-svelte";\n'
    + mod[len(head):]
)
anchor = "\n/**\n * The sender each row was rendered with."
assert mod.count(anchor) == 1
mod = mod.replace(anchor, "\n" + "\n".join(moved) + anchor, 1)
module.write_text(mod)
