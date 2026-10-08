"""Capture the kernel sequence vLLM runs for one Qwen3-8B step.

Uses the real Qwen3-8B dimensions with only a few layers and random
("dummy") weights so it fits on an 8 GB consumer GPU. Weights do not
change which kernels run. CUDA graphs are disabled so each kernel shows
up in the trace; torch.compile (and its fusions) stays on.

Usage: python profile_vllm.py OUT_DIR
"""

import random
import sys

from vllm import LLM, SamplingParams

NUM_LAYERS = 3  # layer 0 skips the fused residual add; layer 2 is a typical layer
BATCH = 4
PROMPT_LEN = 256
DECODE_STEPS = 4


def main() -> None:
    out_dir = sys.argv[1]
    llm = LLM(
        model="Qwen/Qwen3-8B",
        load_format="dummy",
        hf_overrides={"num_hidden_layers": NUM_LAYERS},
        dtype="bfloat16",
        max_model_len=2048,
        max_num_seqs=8,
        gpu_memory_utilization=0.7,
        compilation_config={"cudagraph_mode": "NONE"},
        profiler_config={
            "profiler": "torch",
            "torch_profiler_dir": out_dir,
            "torch_profiler_with_stack": False,
        },
    )

    rng = random.Random(0)

    def make_prompts() -> list[dict]:
        return [
            {"prompt_token_ids": [rng.randrange(1000, 100000) for _ in range(PROMPT_LEN)]}
            for _ in range(BATCH)
        ]

    params = SamplingParams(max_tokens=DECODE_STEPS, ignore_eos=True, temperature=0.0)

    # Fresh prompts for the profiled run: reusing the warm-up prompts would hit
    # the prefix cache and shrink the profiled prefill.
    llm.generate(make_prompts(), params)  # warm-up
    llm.start_profile()
    llm.generate(make_prompts(), params)
    llm.stop_profile()


if __name__ == "__main__":
    main()
