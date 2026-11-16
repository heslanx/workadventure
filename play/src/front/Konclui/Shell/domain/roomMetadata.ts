import { z } from "zod";

/**
 * The anti-corruption layer for `MapDetailsData.metadata`, which the admin API sends as free-form JSON.
 *
 * Konclui is the default design of every room. The only shape that opts a room out is a `konclui` object whose
 * `shell` is the literal `false`; anything else, including absent, `null` or malformed metadata, keeps the shell.
 */
const ShellOptOutSchema = z.object({
    konclui: z.object({ shell: z.literal(false) }),
});

export function isShellEnabled(metadata: unknown): boolean {
    return !ShellOptOutSchema.safeParse(metadata).success;
}
