"""Summarize a vLLM torch-profiler trace into the per-step kernel sequence.

Each engine step is a `gpu_user_annotation` range named like
`execute_context_<n>(<tokens>)_generation_<n>(<tokens>)`. For every step this
prints the kernels in launch order with grid, block, registers and shared
memory, and the innermost CPU op that launched them.

Usage: python summarize_trace.py TRACE.json.gz OUT.json
"""

import bisect
import gzip
import json
import sys


def innermost_op(ops_by_tid: dict, tid, ts: float):
    """Innermost cpu_op on `tid` whose range contains `ts`."""
    ops = ops_by_tid.get(tid, [])
    best = None
    i = bisect.bisect_right([o["ts"] for o in ops], ts)
    for o in reversed(ops[:i]):
        if o["ts"] <= ts <= o["ts"] + o["dur"]:
            if best is None or o["dur"] < best["dur"]:
                best = o
    return best["name"] if best else None


def main() -> None:
    trace_path, out_path = sys.argv[1], sys.argv[2]
    events = json.load(gzip.open(trace_path))["traceEvents"]

    ops_by_tid: dict = {}
    for e in events:
        if e.get("cat") == "cpu_op":
            ops_by_tid.setdefault(e["tid"], []).append(e)
    for ops in ops_by_tid.values():
        ops.sort(key=lambda o: o["ts"])

    launches = {
        e["args"]["correlation"]: e
        for e in events
        if e.get("cat") in ("cuda_runtime", "cuda_driver") and "correlation" in e.get("args", {})
    }
    kernels = sorted((e for e in events if e.get("cat") == "kernel"), key=lambda e: e["ts"])
    steps = sorted(
        (e for e in events if e.get("cat") == "gpu_user_annotation"), key=lambda e: e["ts"]
    )

    out = []
    for step in steps:
        start, end = step["ts"], step["ts"] + step["dur"]
        seq = []
        for k in kernels:
            if not start <= k["ts"] <= end:
                continue
            a = k["args"]
            launch = launches.get(a.get("correlation"))
            seq.append(
                {
                    "name": k["name"],
                    "launched_by": innermost_op(ops_by_tid, launch["tid"], launch["ts"]) if launch else None,
                    "dur_us": round(k["dur"], 3),
                    "grid": a.get("grid"),
                    "block": a.get("block"),
                    "regs_per_thread": a.get("registers per thread"),
                    "smem_bytes": a.get("shared memory"),
                }
            )
        out.append({"step": step["name"], "dur_us": round(step["dur"], 3), "kernels": seq})

    with open(out_path, "w") as f:
        json.dump(out, f, indent=1)
    for s in out:
        print(f"\n== {s['step']}  ({len(s['kernels'])} kernels, {s['dur_us']} us)")
        for k in s["kernels"]:
            print(f"  {k['name'][:90]:90}  {str(k['launched_by'])[:40]:40}  grid={k['grid']}")


if __name__ == "__main__":
    main()
