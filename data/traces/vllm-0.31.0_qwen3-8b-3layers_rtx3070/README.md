# Traza de kernels: vLLM v0.31.0, Qwen3-8B (3 capas), RTX 3070

Referencia para el perfil de fusión de vLLM (decisión D14 de `docs/brief.md`). Sirve para **qué kernels corren y qué ops fusiona cada uno**. No sirve para tiempos, tiles de GEMM, kernel de atención ni FP8 en H100: esta GPU es Ampere (sm86).

## Entorno

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 3070, 8 GB, sm86 |
| Driver | 615.71.09 |
| vLLM | 0.31.0 |
| PyTorch | 2.13.0+cu130 (CUDA 13.0) |
| Triton | 3.7.1 |
| FlashInfer | 0.7.0.post1 (solo sampling) |
| Fecha | 2026-10-08 |

## Cómo se generó

Guía completa para reproducirlo: [`docs/profiling.md`](../../../docs/profiling.md). Resumen:

```sh
uv venv --python 3.12 venv
VIRTUAL_ENV=venv uv pip install vllm==0.31.0
venv/bin/python tools/profiling/profile_vllm.py OUT_DIR
python3 tools/profiling/summarize_trace.py OUT_DIR/*.pt.trace.json.gz kernels.json
```

Configuración (ver `tools/profiling/profile_vllm.py`): dimensiones reales de Qwen3-8B con `num_hidden_layers = 3`, pesos `dummy`, BF16, `cudagraph_mode: NONE` (torch.compile activo, nivel `-O2` por defecto), 4 prompts aleatorios de 256 tokens, 4 tokens generados, calentamiento con otros prompts para no pegarle a la caché de prefijos.

vLLM eligió: backend `FLASH_ATTN` con **FlashAttention 2** (en H100 sería FA3) y FlashInfer para el sampling.

## Archivos

- `trace.json.gz`: traza cruda del profiler de PyTorch (se abre en <https://ui.perfetto.dev>).
- `kernels.json`: secuencia de kernels por paso del motor, con grid, block, registros, shared memory y la op de CPU que lanzó cada uno.

Pasos capturados (vLLM mezcla prefill y decode en un mismo paso cuando puede):

| Paso | Contenido | Kernels |
|---|---|---|
| `execute_context_1(256)_generation_0(0)` | prefill puro, 1 request × 256 tokens | 43 |
| `execute_context_3(768)_generation_1(1)` | mixto: 3 prefills + 1 decode | 43 |
| `execute_context_0(0)_generation_4(4)` | decode puro, batch 4 | 51 / 50 |
| `execute_context_0(0)_generation_3(3)` | decode puro, batch 3 | 50 |

## Secuencia por capa

Los nombres `triton_*` los genera Inductor; qué ops fusiona cada uno se confirmó leyendo el código Triton generado (caché de compilación de vLLM).

| # | Kernel | Ops lógicas | Notas |
|---|---|---|---|
| 1 | `triton_red_fused_fused_add_rms_norm_*` | suma residual (de la capa anterior) + RMSNorm de entrada | En la capa 0 es `triton_red_fused__to_copy_embedding_rms_norm_0`: lookup de embeddings + RMSNorm |
| 2 | GEMM (`aten::mm` → cuBLAS) | proyección QKV | Una sola GEMM |
| 3 | `triton_red_fused_1` / `_3` | QK-norm + RoPE sobre Q y K | Fusionadas por Inductor, aunque el pass explícito de vLLM esté apagado en CUDA |
| 4 | `reshape_and_cache_flash_kernel` | escritura al KV cache | Kernel propio de vLLM |
| 5 | `aten::copy_` | (solo decode) reordenamiento de Q | Intercambio de layout de FA2 para GQA cuando `max_seqlen_q == 1`. Confirmado: lo lanza `_vllm_fa2_C::varlen_fwd` → `aten::reshape` → `aten::clone`. **No existe con FA3** (PackGQA lo hace dentro del kernel) |
| 6 | `flash_fwd_splitkv_kernel` (+ `flash_fwd_splitkv_combine_kernel` en decode) | atención | Split-KV: en decode, batch 4, grid `[1, 2, 32]` = 2 splits × 32 (B · n_kv) |
| 7 | `aten::copy_` | (solo decode) reordenamiento de la salida | Copia de vuelta a la salida, dentro de `_vllm_fa2_C::varlen_fwd`. Ver 5 |
| 8 | GEMM | proyección O | |
| 9 | `triton_red_fused_fused_add_rms_norm_0` | suma residual + RMSNorm post-atención | |
| 10 | GEMM (+ `splitKreduce_kernel` en decode) | gate + up | En decode cuBLAS eligió **split-K** (4 partes) y un kernel extra de reducción |
| 11 | `triton_poi_fused_mul_silu_slice_1` | SiLU · mul | |
| 12 | GEMM | down | |

Después de la última capa: suma residual + RMSNorm final (fusionadas), y fuera del rango anotado del forward: `gather` de los hidden states del último token, **LM head** (GEMM; ~3 ms, el kernel más largo de la traza con solo 3 capas) y kernels de sampling.

Al inicio de cada paso corren ~8 kernels chicos de preparación de inputs (`_prepare_*`, `_gather_block_tables_kernel`, `_compute_slot_mappings_kernel`).

## Hallazgos para el modelo

1. **El límite entre kernels no coincide con el límite entre capas.** La suma residual del final de la capa *i* va fusionada con la RMSNorm de entrada de la capa *i+1*. La UI tiene que mostrarlo así.
2. **Fusiones confirmadas:** residual + RMSNorm; QK-norm + RoPE; embeddings + primera RMSNorm; SiLU·mul en su propio kernel; QKV en una GEMM; escritura al KV aparte.
3. **Kernels por capa:** 10 en prefill y ~13 en decode (por los `copy_` y el `combine` del split-KV y el `splitKreduce` de split-K). En H100 con FA3 los dos `copy_` desaparecen.
4. **Split-KV aparece incluso a batch 4** con contexto de 256 tokens: la lección de D9 se ve en una traza real.
5. **Split-K en GEMMs de decode:** con M chico, cuBLAS parte la dimensión K para llenar la GPU. El modelo de tiling ya contempla `split_k`; hay que mostrarlo.
