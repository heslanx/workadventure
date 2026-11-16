import { writeFileSync } from "node:fs";
import { ConfigError, USAGE, parseConfig } from "./src/config";
import { runLoad } from "./src/runner";

const EXIT_USAGE = 1;
const EXIT_RUN_NOT_VALID = 2;

async function main(): Promise<number> {
    let config;
    try {
        config = parseConfig(process.argv.slice(2), process.env);
    } catch (error) {
        if (error instanceof ConfigError) {
            console.error(`${error.message}\n\n${USAGE}`);
            return EXIT_USAGE;
        }
        throw error;
    }

    const stop = new AbortController();
    const onSignal = () => stop.abort();
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    const summary = await runLoad(config, stop.signal);

    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    const json = JSON.stringify(summary, null, 2);
    if (config.output !== undefined) {
        writeFileSync(config.output, `${json}\n`);
    }
    console.log(json);

    return summary.reconciled && summary.sessions.accepted >= config.minAccepted ? 0 : EXIT_RUN_NOT_VALID;
}

main().then(
    (exitCode) => {
        process.exitCode = exitCode;
    },
    (error: unknown) => {
        console.error(error);
        process.exitCode = EXIT_USAGE;
    },
);
