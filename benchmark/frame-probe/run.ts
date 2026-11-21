// The entry point: npx tsx frame-probe/run.ts <frames|compare|panel> <room url> [options]    (from benchmark/)
import { main } from "./cli";

main(process.argv.slice(2)).then(
    (exitCode) => {
        process.exitCode = exitCode;
    },
    (error: unknown) => {
        console.error(error);
        process.exitCode = 2;
    },
);
