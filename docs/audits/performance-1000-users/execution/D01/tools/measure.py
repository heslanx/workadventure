#!/usr/bin/env python3
"""Run one command and append wall time, CPU time, peak RSS and exit code as a JSON line.

GNU time is not installed in the job container, so this uses wait4 accounting
(RUSAGE_CHILDREN), which is the same source GNU time reads. ru_maxrss is the
largest resident set of any single waited-for descendant, not a sum over the
process tree.

usage: measure.py <label> <results.jsonl> <logfile> -- <command...>
"""
import json
import resource
import subprocess
import sys
import time


def main() -> int:
    label, results_path, log_path = sys.argv[1:4]
    if sys.argv[4] != "--":
        raise SystemExit("expected -- before the command")
    command = sys.argv[5:]

    started = time.monotonic()
    with open(log_path, "wb") as log:
        completed = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
    wall = time.monotonic() - started
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)

    record = {
        "label": label,
        "command": " ".join(command),
        "exit_code": completed.returncode,
        "wall_s": round(wall, 3),
        "user_s": round(usage.ru_utime, 3),
        "sys_s": round(usage.ru_stime, 3),
        "peak_rss_kb": usage.ru_maxrss,
        "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(results_path, "a", encoding="utf-8") as results:
        results.write(json.dumps(record) + "\n")
    print(json.dumps(record))
    return completed.returncode


if __name__ == "__main__":
    sys.exit(main())
