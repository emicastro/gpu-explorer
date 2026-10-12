# Diseño — GPU Inference Explorer v1

Status: accepted
Date: 2026-10-09

Responde el **cómo** de cada punto de [`requirements.md`](requirements.md). Las decisiones de producto están en [`brief.md`](brief.md) (D1–D15) y las de arquitectura en [`adr/`](adr/); acá se citan, no se re-argumentan.

## 1. Vista general

```
data/*.json ──include_str!──▶ crates/core (Rust puro)
                                  │ evaluate(hw, model, scenario) -> StepPlan
                                  ▼
                              crates/wasm (wasm-bindgen + serde-wasm-bindgen)
                                  │ ES module en web/src/wasm/
                                  ▼
content/*.md ──import.meta.glob──▶ web/ (React + R3F)
                                  store (zustand) ─▶ escena 3D · línea de tiempo · roofline · barra HBM · perillas · tooltips
```

- Una llamada a `evaluate` por cada cambio de perillas. La animación corre en JS sobre el `StepPlan`; no se cruza la frontera por frame (brief D5).
- Tipos TS generados desde Rust con ts-rs ([ADR 0001](adr/0001-rust-to-ts-types-with-ts-rs.md)).
- Datos embebidos en el núcleo ([ADR 0002](adr/0002-data-files-json-embedded-in-core.md)).

## 2. Repo y toolchain

[ADR 0006](adr/0006-repo-layout-and-js-toolchain.md) y [ADR 0003](adr/0003-wasm-build-with-wasm-bindgen-cli.md).

```
crates/core/      gpuviz-core: unidades, datos, ops, perfil de fusión, roofline, tiling, tiempo, memoria, evaluate
crates/wasm/      gpuviz-wasm: hardware(), models(), evaluate()
data/hardware/    h100-sxm.json
data/models/      qwen3-8b.json
data/fusion/      vllm-0.31.0-h100.json
data/traces/      trazas de referencia (D14)
content/          glossary/*.md, components/*.md
web/              app Vite; src/{core,generated,wasm,state,scene,views,glossary,ui}
scripts/          build-wasm.sh, verify.sh
tools/profiling/  scripts de perfilado (D14)
```

- Rust: workspace con `resolver = "2"`. La edición y el toolchain se fijan en `rust-toolchain.toml`, con el target `wasm32-unknown-unknown`. `wasm-bindgen` queda fijado con `=` en `crates/wasm/Cargo.toml`.
- Web: pnpm, Vite, React, TypeScript estricto, `@react-three/fiber`, `@react-three/drei`, zustand, Vitest, Playwright (solo Chromium) y ESLint.
- `scripts/verify.sh`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, chequeo de drift de tipos (`cargo test -p gpuviz-core --features ts && git diff --exit-code web/src/generated`), `scripts/build-wasm.sh`, y en `web/`: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm e2e`.

## 3. Núcleo: tipos y datos

### 3.1 Unidades y `Quantity` (R6)

- Newtypes con aritmética explícita: `Bytes(f64)`, `Flops(f64)`, `Seconds(f64)`, `BytesPerSec(f64)`, `FlopsPerSec(f64)`, `Count(u64)`. Solo se implementan las operaciones con sentido físico: `Bytes / BytesPerSec = Seconds`, `Flops / Bytes = Intensity`, etc. Sumar `Bytes + Flops` no compila.
- `Quantity { value, unit, confidence, sources }` es el tipo de **salida** que se serializa. Se construye solo desde un newtype y una `Provenance { confidence, sources }`, así que no hay forma de producir un número sin confianza.
- La confianza se propaga en los cálculos con el peor de los insumos: `estimated` > `simplified` > `documented`. Las fuentes se unen.
- Test (R6): recorrer un `StepPlan` serializado; todo `documented` tiene al menos una fuente.

### 3.2 Archivos de datos (ADR 0002)

- **`data/hardware/h100-sxm.json`:** un árbol `HwNode` (brief §6.2) con `specs: Record<string, Quantity>`, donde cada valor trae `value`, `unit` (en unidades base), `confidence` y `sources` ([ADR 0009](adr/0009-data-quantities-in-base-units.md)). `count` y `enabled` también son `Quantity`; las variantes que no se repiten parejo (los GPCs) son nodos separados con su propio `count` ([ADR 0008](adr/0008-hardware-tree-shape.md)).
  - Niveles: `board`, `package`, `die`, `gpc`, `tpc`, `sm`, `subpartition`, `unit`.
  - `count` / `enabled` resuelven los SMs y los sitios de HBM deshabilitados. El reparto por GPC es `simplified`: 66 TPCs en 8 GPCs, con 6 GPCs de 8 TPCs y 2 de 9, sumando 66. El sitio de HBM inactivo se elige arbitrariamente y queda marcado.
  - Valores de partida: brief D1. Lo derivable (pico BF16, ridge point) no se guarda: lo calcula el núcleo y lo verifica un test.
- **`data/models/qwen3-8b.json`:** el `config.json` de Qwen/Qwen3-8B tal cual, bajo `config`, con una sola `provenance` para todo el archivo ([ADR 0010](adr/0010-model-file-provenance.md)). Lo acompaña un bloque `quantization_variants` con los esquemas FP8, cada uno con su confianza y sus fuentes: `block` (pesos en bloques de 128×128, activación 1×128 dinámica) y `per_tensor` (`--quantization fp8_per_tensor` en vLLM v0.31.0: escala estática por tensor en los pesos, dinámica por token en la activación).
- **`data/fusion/vllm-0.31.0-h100.json`:** el perfil de fusión (§4.1).
- El archivo de hardware tiene dos claves: `tree` (el árbol) y `calibration` (los parámetros del tiempo realista, §4.4) ([ADR 0014](adr/0014-hardware-file-wraps-tree-and-calibration.md)).
- Un test parsea cada archivo con `deny_unknown_fields` y valida invariantes, p. ej. la suma de `enabled` por nivel.

### 3.3 API del núcleo

```rust
pub fn hardware(id: &str) -> Result<HwNode, CoreError>;  // la raíz del árbol
pub fn model(id: &str) -> Result<ModelConfig, CoreError>;
pub fn evaluate(hw: &str, model: &str, scenario: &Scenario) -> Result<StepPlan, CoreError>;
```

- `Scenario` y `StepPlan` siguen el brief §6.4 y §6.6, con estos ajustes:
  - `weights: "bf16" | "fp8_block" | "fp8_tensor" | "fp8_w8a16"`.
  - `contexts: Vec<u32>`, uno por request. La UI de v1 los manda iguales (brief D9).
  - Cada kernel agrega `ops: Vec<OpId>` (las ops lógicas que fusiona), `phaseBreakdown` con los bytes leídos y escritos por origen (pesos, KV, activaciones) para la barra de flujo, y `grid.perWave: Vec<u32>` (bloques por onda) para el mapeo a SMs.
  - También agrega `impl`, la `provenance` de su plantilla de fusión, `bytes.unfused` (para el ahorro por fusión), `precision` (el pico contra el que se mide) y `time.realisticBound` (con pocos SMs activos, el techo del tiempo realista puede no ser el de la cota). El `id` es `k` más el índice de lanzamiento.
  - Los números de `grid` (`blocks`, `splits`, `slots`, `waves`, `waveEfficiency`, `activeSms`) son `Quantity`, con la procedencia del `Launch`. `tile` es `[m, n, k]` y `perWave` es una lista de números: son formas, no valores que la UI muestre sueltos.
  - `totals` suma FLOPs, bytes y los dos tiempos, y da `tokensPerSecond` (unidad `tok/s`) para cada uno, con el M real. `roofs` trae los picos BF16 y FP8 y el ancho de banda, derivados del árbol, para la vista de roofline.
  - `layers: Vec<LayerSpan>` indica qué rango de kernels corresponde a cada capa. No es un corte limpio: la suma residual se fusiona con la RMSNorm de la capa siguiente (brief §6.5), así que el rango se define por el kernel que **empieza** la capa.
- Errores: un enum con mensaje (escenario inválido, batch que no entra en HBM, id inexistente). En la frontera WASM se convierten en `JsError`.

## 4. Núcleo: el modelo

### 4.1 Ops lógicas y perfil de fusión (R2)

- `ops.rs` genera las ops lógicas de un paso de Qwen3 (brief §6.5, lista 1–11, y las de fuera del loop), cada una con su capa y sus formas (M, N, K o filas × columnas). Los bytes y FLOPs "sueltos" salen de esas formas (§4.2).
  - Con pesos W8A8 (`fp8_block`, `fp8_tensor`) se agregan cuatro ops de cuantización de la activación por capa, una antes de cada GEMM. W8A16 no cuantiza la activación.
- **Relleno de CUDA graphs** (`documented`, vLLM v0.31.0: `config/compilation.py`, `v1/cudagraph_dispatcher.py`, `v1/worker/gpu_model_runner.py`, `v1/attention/backends/flash_attn.py`). Un paso de hasta 512 tokens se rellena hasta el tamaño capturado más cercano (`[1, 2, 4]`, de 8 a 248 de a 8, de 256 a 512 de a 16). En decode corre un graph FULL, que incluye la atención. En prefill corre uno PIECEWISE, con la atención y la escritura al KV fuera del graph.
  - Las ops del modelo ven el M rellenado (`Scenario::padded_tokens`): embeddings, norms, cuantización, las cuatro GEMMs, QK-norm + RoPE y SiLU·mul. Las plantillas de fusión se eligen con ese M, así que un batch de 25 a 31 va por DeepGEMM.
  - La escritura al KV y la atención ven solo los tokens reales. En PIECEWISE la atención usa la metadata real. En FULL la metadata se rellena con requests de largo 0 (query y KV) y el `slot_mapping` con −1, así que FA3, `combine` y la escritura al KV no hacen trabajo de más. Solo el `prepare` de FA3 ve el batch rellenado (`Scenario::metadata_batch`).
  - Lo que corre fuera del modelo ve el batch real: la preparación de inputs, el gather del último token, el LM head (`hidden_states[logits_indices]`) y el sampling.
- El perfil de fusión es **dato**, con la forma de [ADR 0011](adr/0011-fusion-profile-shape.md): tres listas ordenadas de plantillas (`prologue`, `layer`, `epilogue`). Cada plantilla tiene:
  - `name` (el nombre del kernel, p. ej. `triton_red_fused_fused_add_rms_norm`, `FlashAttnFwdSm90`, `FlashAttnFwdCombine`);
  - `ops` (los tipos de op que fusiona; `kind@prev` es la op de la capa anterior);
  - `impl` (la clave del modelo de tiling: `inductor_elementwise`, `cublas_bf16`, `cutlass_fp8_tensor`, `flashinfer_swapab`, `deepgemm_sm90`, `marlin_w8a16`, `fa3`, `fa3_combine`, `fa3_prepare`, `vllm_cache_write`, `fp8_act_quant`, `vllm_prepare_inputs`, `torch_index`, `sampling`);
  - `when` (condiciones que deben cumplirse todas: `phase`, `weights`, `tokens` (M), `attentionSplits`, `firstLayer`);
  - `confidence` y `sources` (claves de un mapa de fuentes del archivo).
- `fuse(model, scenario, attention_splits)` devuelve las ops, los kernels y los `LayerSpan`. Falla si una op no corre en ningún kernel o corre en dos (salvo la preparación de inputs y la atención, que ocupan varios).
- Secuencia por capa en decode BF16 (11 kernels): residual + RMSNorm, GEMM QKV, QK-norm + RoPE, escritura al KV, FA3, FA3 combine, GEMM O, residual + RMSNorm, GEMM gate+up, SiLU·mul, GEMM down.
  - **FP8 por bloques: 15 por capa.** Un kernel de cuantización antes de cada GEMM, en las dos ramas: `scale_1x128_kernel` + `fp8_gemm_kernel_swapAB` con M < 32, `per_token_group_quant_8bit_kernel` + `sm90_fp8_gemm_1d2d_impl` con M ≥ 32. `documented`: la cuantización y el `torch.cond` están dentro del custom op `dynamic_flashinfer_deepgemm_blockscale_gemm`, opaco para Inductor, así que no se puede fusionar con la RMSNorm.
  - **FP8 por tensor: 12 por capa.** La cuantización por token es PyTorch nativo bajo Inductor, que la fusiona con la RMSNorm previa (QKV, gate+up) y con SiLU·mul (down). Solo la de la GEMM O queda sola, porque la salida de FA3 es opaca. `simplified`: inferido del comportamiento de Inductor, sin traza.
  - **W8A16: 11 por capa,** con Marlin en lugar de cuBLAS (`simplified`: vLLM lo usa en H100 solo si se fuerza).
  - El `combine` corre solo si FA3 ve `splits > 1` del lado del host (§4.3). Con hasta 512 tokens en el paso (el CUDA graph más grande que captura vLLM en H100), vLLM le pasa el tope de 32, así que corre siempre, también en un prefill chico. Por encima, depende de la heurística de FA3.
  - El `splitKreduce` de cuBLAS que se vio en Ampere no se modela en H100 (no hay fuente; `simplified`).
- Fuera del loop:
  - preparación de inputs: 7 kernels en decode y 12 en prefill (`estimated`; los de la traza de D14, cuya cantidad depende de cómo cambió el batch);
  - el `prepare_varlen_num_blocks_kernel` de FA3, una vez por paso en las dos fases;
  - embeddings + primera RMSNorm (fusionadas, en la capa 0), RMSNorm final con la última suma residual, gather del último token, LM head (BF16 en todos los formatos de pesos) y sampling (`estimated`).

### 4.2 Roofline y cota inferior (R1)

Fórmulas del brief §7.1, sin cambios.
- Pico de cómputo según el dtype efectivo del kernel: BF16, o FP8 solo si ambos operandos son FP8 (W8A8).
- Ancho de banda: HBM.
- Cota inferior = `max(FLOPs / pico, bytes / BW)`.
- Los bytes de un kernel fusionado son la entrada y salida del kernel, no la suma de sus ops: esa diferencia es el "ahorro por fusión" que muestra la UI (brief D7).
  - La regla sale del flujo de tensores entre ops ([ADR 0012](adr/0012-fused-kernel-bytes-from-op-dataflow.md)). Cada op declara qué lee y qué escribe. Un kernel lee lo que sus ops leen y él mismo no escribió. Escribe lo que otro kernel lee y lo que sobrevive al paso: el KV cache y los tokens muestreados.
  - Por ejemplo, el kernel residual + RMSNorm lee 2 tensores `[M, h]` y el peso de la norma, y escribe 2: la salida normalizada y el residual nuevo, que la suma residual siguiente vuelve a leer.
  - Con split-KV, FA3 escribe parciales fp32 (salida y LSE por split y cabeza Q) y `combine` los lee. Eso hace que el "ahorro" de `combine` sea negativo. `roofline` recibe los splits de cada request (§4.3). Un request con 1 split no tiene parciales: FA3 escribe su salida directo y `combine` lo saltea. Es `documented` (FA3 `9cd61de`). La LSE final (4 B por cabeza Q y token) no se cuenta.
  - No se cuentan los tensores de índices y metadatos (ids de token, slot mappings, block tables) ni la tabla cos/sin de RoPE.
  - Con relleno de CUDA graph (§4.1), las ops rellenadas leen y escriben las filas del relleno, y su procedencia cita la fuente del relleno. Los bytes de pesos no cambian, salvo las filas de la tabla de embeddings, que se leen por token.
- Los kernels se ejecutan en serie. La cota del paso es la suma de las cotas de sus kernels, y el techo de throughput es `M / cota`, con el M real.
- Con las activaciones contadas, las GEMMs de decode cruzan el ridge en `M* = r·NK / (NK − r·(N+K))`, con `r` el ridge. Para las formas de Qwen3-8B eso da entre 322 y 345, no exactamente 295. El 295 sale de contar solo los pesos.
  - Con el relleno, el primer batch que cruza es el primero cuyo tamaño capturado pasa `M*`. Por encima de 256 los tamaños van de a 16, así que puede ser hasta 15 menos que `M*`.

### 4.3 Tiling y ondas (R3)

Un módulo por `impl` bajo `tiling/`. Cada uno devuelve un `Launch { blocks, tile, splits, slots, per_wave, persistent, provenance }`. `slots` son las CTAs residentes a la vez: el grid persistente, o SMs × CTAs por SM ([ADR 0013](adr/0013-launch-carries-resident-slots.md)).

| `impl` | Fuente | Confianza |
|---|---|---|
| `fa3` | brief §7.2, con FA3 `9cd61de` y vLLM v0.31.0 (abajo) | `documented` |
| `flashinfer_swapab` | `get_best_gemm_config` (FlashInfer 0.7.0.post1), M < 32 | `documented` |
| `deepgemm_sm90` | heurística de `sm90.hpp` (DeepGEMM `e1f418c`), M ≥ 32, reimplementada con su modelo de ciclos L1/L2 | `documented` |
| `cutlass_fp8_tensor` | tabla de `scaled_mm_sm90_fp8_dispatch.cuh` (vLLM v0.31.0) y scheduler persistente de CUTLASS v4.7.1 | `documented` |
| `cublas_bf16` | la misma tabla con BK a la mitad (mismos bytes por etapa) | `simplified` |
| `inductor_elementwise` | traza de D14: una CTA de 512 hilos por token en las reducciones sobre `h`, una de 128 por 4 filas de cabeza en QK-norm + RoPE, una de 256 por 512 elementos en SiLU·mul | `simplified` |
| `fa3_combine`, `fa3_prepare` | grid del código fuente de FA3 `9cd61de` | `documented` |
| `marlin_w8a16`, `vllm_cache_write`, `fp8_act_quant`, `vllm_prepare_inputs`, `torch_index`, `sampling` | grid del código fuente o de la traza de D14 | `simplified` |

- **FA3** (`tiling::fa3`) decide los splits en tres capas:
  1. vLLM pasa un tope: 32 si el paso tiene ≤ 512 tokens (en cualquier fase), 0 si no.
  2. El host de FA3 fija `num_splits`: el tope, o con 0 `num_splits_heuristic` para un solo request con los largos máximos (varlen solo conoce los máximos). Con más de 992 requests, 1. Si es > 1, corre `combine`.
  3. El kernel de preparación da a cada request `clamp(⌈n_i / ⌈1.1 · Σ m_j·n_j · n_kv / SMs⌉⌉, 1, num_splits)`, con `m` tiles de Q (GQA empaquetado) y `n` bloques de KV. En decode `m = 1`: es la fórmula del brief §7.2.
  - Tiles (siempre causal; PackGQA siempre, porque `d == dv`): 64×128 si `T · n_q/n_kv ≤ 64`, si no 128×128. Con KV en FP8: 64×96 y 128×192.
  - Bloques = `Σ_i m · n_kv · splits_i`, sobre un grid persistente de una CTA por SM.
- **GEMMs** (`tiling::{flashinfer, deepgemm, cutlass}`):
  - FlashInfer (swap AB): BM = 64 si N ≤ 64, si no 128, sobre las filas del peso; BN ∈ {16, 24, …, 128} sobre los tokens. Gana el que da menos ondas; a igualdad, el de última onda más llena, y después el BN más chico.
  - DeepGEMM: candidatos de bloque y cluster, filtros de registros, unroll del kernel 1D2D y etapas de pipeline. Gana el de menos ciclos según su modelo de tráfico L1/L2 dividido por la eficiencia de onda, con la aritmética entera y `float` del C++.
  - CUTLASS: la tabla por rango de M (swap AB hasta M = 64). Los tiles se redondean a clusters enteros. Con clusters de más de una CTA, el grid es `get_max_cta_occupancy`: 132 con clusters de 2, 116 con clusters de 4.
  - No se modela split-K.
- Las GEMMs, la cuantización y los kernels de Inductor cortan sus tiles sobre el M rellenado (§4.1).
- **Resto de los kernels** (`tiling::{fa3_aux, marlin, engine}`; `tiling::launch` despacha por `impl`):
  - `prepare` (FA3): `⌈b / 992⌉` CTAs de `32 · min(⌈b / 31⌉, 32)` hilos (warps redondeados a potencia de 2), con `b` el batch de la metadata: rellenado en decode.
  - `combine` (FA3): tile `kBlockM × kBlockK` = 8×128 (16×64 si `dv ≤ 64`), 256 hilos, `b · ⌈T · h / kBlockM⌉ · ⌈dv / kBlockK⌉` CTAs. Con grids ralos el scheduler lanza `⌈total_q · h / kBlockM⌉ + b` y las sobrantes salen al instante; `blocks` cuenta solo las que trabajan.
  - Marlin: persistente, 132 CTAs; la config `{thread_k, thread_n}` sale de `determine_exec_config` (`simplified`: no se chequea la shared memory, y un M grande se cuenta como un solo lanzamiento).
  - Cache write: una CTA por token real. Con el relleno, las CTAs de los tokens de relleno salen al instante (`slot_mapping` = −1) y no se cuentan. Cuantización FP8: FlashInfer lanza `8 · SMs` CTAs fijas (M < 32); vLLM, una CTA por 32 grupos de 128. `index`: una CTA de 128 hilos por 512 elementos. Sampling: una CTA por request. Inputs: grids de la traza D14 según el kernel y la cantidad de requests.
  - Registros y shared memory de `combine`, `prepare` y los kernels de `engine` no están citados, así que `slots` cuenta solo el límite de hilos (ADR 0013).
- Kernels no persistentes: `slots = SMs × CTAs por SM`, el mínimo de los límites de hilos, bloques, registros y shared memory del SM (`tiling::Sm`, ADR 0013).
- Kernels persistentes (FA3 varlen, DeepGEMM, FlashInfer): grid de 132 CTAs. Las "ondas" son las rondas de tiles que reparte el scheduler: `ondas = ⌈tiles / 132⌉`.
- `per_wave[i]` = tiles activos en la ronda `i`. El 3D asigna tiles a SMs en orden de índice de SM. El scheduler real no es determinista, así que esa asignación es `simplified`.

### 4.4 Tiempo realista (R4)

Por kernel (`time::realistic`):

```
bw_ef      = BW · η_m · min(1, sms_activos / sms_para_saturar)
compute_ef = pico · η_c(FLOPs) · min(1, sms_activos / SMs)
t_real     = max(FLOPs / compute_ef, bytes / bw_ef) + t_overhead
```

- `sms_activos` = `min(blocks, SMs)` del `Launch` (§4.3).
- `compute_ef` también se reparte por SM: un kernel en 24 SMs no puede usar los tensor cores de los otros 108. La cota inferior (§4.2) no lo hace: es el límite físico del chip entero.
- `η_m` = 0.93 (STREAM, brief §7.1).
- `sms_para_saturar` = 32: cuántos SMs hacen falta para saturar HBM. Sale de la ley de Little (~2.3 MB en vuelo contra ~64–96 KB por CTA de un kernel con pipeline de TMA). Responde la pregunta abierta de las 32 CTAs (brief §12): alcanzan, más o menos, en los kernels con pipeline.
- `η_c(FLOPs)` interpola la tabla de rangos del brief §7.1 en log de FLOPs, y se acota en los extremos: 0.40 a 1e10, 0.55 a 1e11 (formas típicas de LLM), 0.75 a 1e12 (GEMMs grandes y cuadradas). La misma curva vale para la atención y los elementwise.
- `t_overhead` es por kernel: 4 µs si vLLM lo reproduce desde un CUDA graph y 6 µs si lo lanza a mano (`time::in_cuda_graph`; `documented` cuál es cuál, `estimated` los valores). Solo hay graph en pasos de hasta 512 tokens (§4.1):
  - en decode (FULL), todos los kernels del modelo, incluidas la atención y la escritura al KV;
  - en prefill (PIECEWISE), los kernels del modelo menos la atención y la escritura al KV, porque vLLM corta el graph en `unified_attention_with_output` y `unified_kv_cache_update`;
  - nunca en los kernels de alrededor del modelo: la preparación de inputs, el `prepare` de FA3, el gather del último token, el LM head y el sampling.
- Todos los parámetros viven en el bloque `calibration` del archivo de hardware, al lado del árbol ([ADR 0014](adr/0014-hardware-file-wraps-tree-and-calibration.md)). Todos son `estimated`, con fuentes. Las eficiencias usan la unidad adimensional `"1"`.
- Test de calibración: decode 8B BF16, batch 1, contexto de 350 → suma de `t_real` dentro de ±15 % de 7.28 ms (GPUStack), y suma de cotas inferiores menor que 7.28 ms.
  - Da 6.58 ms (−10 %), contra una cota de 4.54 ms. De la diferencia, ~1.65 ms son `t_overhead` (397 kernels del graph y 11 de alrededor del modelo) y ~0.35 ms son `η_m`.
  - Los ~0.7 ms que faltan son tiempo del host por paso (scheduling, sampling, procesar la salida), que el TPOT medido incluye y el modelo por kernel no. La versión del benchmark (vLLM v0.11.0) tampoco es la del perfil de fusión.

### 4.5 Memoria (R5)

Sigue cómo vLLM v0.31.0 dimensiona el KV cache al arrancar (`gpu_worker.py`, `determine_available_memory`): una fracción `gpu_memory_utilization` de la capacidad, menos los pesos y lo que no es KV.

- `weights`: las cuatro GEMMs de cada capa en el formato de los pesos, con sus escalas FP32 (bloques de 128×128 o una por tensor), y el resto en BF16 (embeddings, LM head, norms). W8A16 usa el checkpoint por bloques.
- `kv` = Σ ⌈contexto / 16⌉ · 16 × KV por token (brief §7.1). vLLM asigna el KV en bloques enteros de 16 tokens (`documented`).
- `headroom` = capacidad × (1 − `gpu_memory_utilization`). Es 0.92 por defecto en v0.31.0 (`documented`).
- `activations` = la memoria que no es pesos ni KV: el pico de activaciones del perfilado y lo que no es de torch. 2 GiB, `estimated`. La memoria de los CUDA graphs no se resta: vLLM solo la estima con `VLLM_MEMORY_PROFILER_ESTIMATE_CUDAGRAPHS`, así que sale del `headroom`.
- Los dos parámetros viven en el bloque `calibration` del archivo de hardware: describen cómo corre el stack en esta GPU ([ADR 0014](adr/0014-hardware-file-wraps-tree-and-calibration.md)).
- `free` = capacidad − `headroom` − pesos − `activations` − KV, y 0 si no entra. Sin overflow, las cinco partes suman la capacidad.
- `maxBatch` = cuántos requests del contexto más largo del batch entran después de pesos, `activations` y `headroom`. Con Qwen3-8B en BF16: 12 a 32k, 3 a 128k.
- Si el escenario no entra, `evaluate` devuelve el plan con `memory.overflow = true`. No es un error: la UI lo muestra en rojo.

## 5. Frontera WASM

- `crates/wasm` exporta `hardware(id)`, `models()`, `evaluate(hw, model, scenario)`. Recibe y devuelve valores JS vía `serde-wasm-bindgen`.
  - Serializa con `Serializer::json_compatible()` ([ADR 0015](adr/0015-step-plan-wire-shape.md)): objetos en lugar de `Map`, `null` para `None` y números para `u64`. Por eso ts-rs genera `number` para los enteros grandes (`TS_RS_LARGE_INT` en `.cargo/config.toml`).
  - `models()` devuelve los `ModelConfig` sin `quantization_variants`: el núcleo los usa, la UI elige un formato de pesos y no un esquema.
  - `evaluate` elige el perfil de fusión según el hardware (`h100-sxm` → `vllm-0.31.0-h100`).
- `web/src/core/index.ts` envuelve el módulo y castea a los tipos generados (ADR 0001).
- El store guarda las perillas (`Knobs`: batch y un contexto). `toScenario` las expande a un `Scenario` con un contexto por request; en prefill, `newTokens` es el contexto entero.
- `init()` es asíncrono en el navegador. En Vitest, `initSync` lee los bytes del `.wasm` del disco.
- Test de ida y vuelta: un `Scenario` construido en TS → `evaluate` → el `StepPlan` tiene la forma generada (Vitest).

## 6. Web

### 6.1 Estructura y estado (ADR 0004)

- Slices del store:
  - `scenario` (perillas)
  - `plan` (el último `StepPlan`)
  - `selection` (kernel o componente seleccionado)
  - `playback` (playhead, velocidad, modo de escala temporal, play/pausa)
  - `navigation` (camino de niveles)
- Cambiar `scenario` dispara `evaluate` de forma síncrona: tarda microsegundos. El plan se reemplaza entero.
- En la escena, el playhead se lee con `getState()` dentro de `useFrame`.

### 6.2 Navegación (R7)

- Máquina de estados de niveles. El camino es una lista de ids del árbol de hardware.
- Cada nivel es un sub-árbol de escena con **coordenadas locales y escala normalizada** (brief §4.2). Al entrar a un hijo:
  1. la cámara vuela hacia él (tween de posición y target, ~600 ms);
  2. los hermanos se desvanecen;
  3. se monta el nivel hijo.
- Migas de pan en HTML. `Escape` y `Backspace` vuelven un nivel; `Tab` recorre los componentes clickeables.

### 6.3 Geometría (R8, R19)

- Toda la geometría es procedural: cajas y planos parametrizados, generados desde el árbol de hardware por funciones puras `layout<Level>(node) -> Placement[]`. Así se testean las cantidades sin renderizar.
- Package: el die al centro, 6 sitios de HBM alrededor (2 columnas de 3), uno inactivo atenuado, sobre el interposer.
- Die: 8 GPCs en dos filas de 4, la L2 en dos mitades al centro, 10 controladores en los bordes junto a las HBM activas, el GigaThread engine.
- GPC: TPCs con 2 SMs cada uno; los SMs deshabilitados se ven grises.
- SM: 4 sub-particiones, shared memory / L1, TMA.
- Sub-partición: warp scheduler, register file, tensor core, CUDA cores.
- Colores por función, definidos en una sola paleta (brief D13).
- Instancing (`InstancedMesh`) para todo lo que se repite más de 8 veces.

### 6.4 Panel de componente (R9)

Click o hover sobre un componente → panel con la prosa de `content/components/<contentId>.md` (qué hace, qué guarda), sus `specs` como cantidades (§6.9), y "qué hace el LLM acá" calculado del plan para el kernel actual: bytes que pasan, bloques que tiene, si usa tensor cores.

### 6.5 Línea de tiempo y reproducción (R10)

- `buildTimeline(plan, mode, focusLayer) -> Segment[]` es una función pura.
  - **Modo didáctico:** `max(t_min, escala · t_real)`.
  - **Modo tiempo real:** proporcional.
  - Las capas fuera de `focusLayer` se comprimen en un solo segmento por capa, que se puede expandir.
- Controles: play, pausa, scrub (con marcas de capa), velocidad 0.25×–4×.

### 6.6 Mapeo a SMs y flujo de datos (R11)

- `smOccupancy(kernel, wave) -> Set<smIndex>` es una función pura (§4.3).
- Flujo HBM → L2 → SM → tensor core:
  - partículas instanciadas por tramo;
  - cantidad y ancho de flujo en escala logarítmica de los bytes (brief §4.3);
  - etiqueta con el número exacto.
- Primer hito (brief §9): dos niveles (package y die) y un kernel animado con datos reales del plan.

### 6.7 Rendimiento (R12)

- Presupuesto de ≤ 200 draw calls por frame.
- La app expone `window.__gpuviz.renderInfo()` en builds de prueba, y un e2e recorre los niveles y lo verifica.
- Los fps se miden a mano en una GPU integrada y se anotan en `docs/perf.md`.

### 6.8 Perillas y vistas vinculadas (R13, R14)

- **Perillas:**
  - batch: entero, de 1 a 512, escala log;
  - contexto: slider log de 1 a 131072, con marca de YaRN desde 32k (brief D11);
  - pesos, KV, fase y modo de tiempo: selectores.
- **Línea de tiempo de kernels:** barras por kernel; click = selección.
- **Roofline:** SVG propio, log-log, con un punto por kernel y techos de BF16 y FP8. El punto seleccionado se resalta.
- **Barra de HBM:** pesos + KV + libre sobre 80 GB, con el batch máximo.
- Las tres leen `selection` y escriben en ella. El 3D resalta el kernel o componente seleccionado.

### 6.9 Cantidades en la UI (R16)

- `<Q value={Quantity} />` es el único componente que muestra números: formatea con unidad y pone un indicador de confianza (punto o borde por nivel).
- Con hover o foco muestra las fuentes, con el mismo sistema de tooltips que el glosario.
- Una regla de ESLint del repo prohíbe renderizar `number` en JSX dentro de `views/` y `ui/`.

## 7. Glosario y contenido (R15, R9; ADR 0005)

- `content/glossary/<id>.md`: el frontmatter trae `id`, `name`, `short`, `related` y `sources`; el cuerpo es la definición larga.
- `content/components/<contentId>.md`: el frontmatter trae `id`, `does`, `stores`; el cuerpo es la prosa.
- Parser: separar el frontmatter y leerlo con `yaml`. Renderer de un subconjunto chico de Markdown más `[[id]]` y `[[id|texto]]`.
- **Tooltips:** una pila de tooltips abiertos.
  - Se abren con hover de 600 ms o con foco.
  - Se fijan con click, o solos a los 1.5 s.
  - Un tooltip fijado acepta hover adentro, y desde ahí se abren los anidados.
  - `Escape` cierra el último.
  - El 3D usa el mismo componente, anclado al puntero.
- **Test de contenido:** todo `[[id]]` existe; todo componente del árbol tiene su archivo; no hay archivos huérfanos. Los términos del glosario de trabajo (`docs/GLOSSARY.md`, en español) son la semilla del glosario del sitio en inglés, pero no se sincronizan.

## 8. Producto (R17, R18, R20)

- Aviso de pantalla chica: un overlay a menos de 1024 px de ancho, que no bloquea.
- Licencias: `LICENSE-MIT`, `LICENSE-APACHE` y `LICENSE-CONTENT` (CC BY 4.0); `license = "MIT OR Apache-2.0"` en los `Cargo.toml` y en `package.json`.
- Deploy ([ADR 0007](adr/0007-hosting-on-github-pages.md)): un workflow de GitHub Actions corre `scripts/verify.sh` y publica `web/dist`. Depende de crear el remoto, así que es la última tarea.

## 9. Trazabilidad

| Requisito | Diseño | Tareas |
|---|---|---|
| R1 | §4.1, §4.2 | 3.1, 3.2, 3.6 |
| R2 | §4.1 | 3.1 |
| R3 | §4.3 | 3.3, 3.4 |
| R4 | §4.4 | 3.5 |
| R5 | §4.5 | 3.6 |
| R6 | §3.1 | 2.1, 3.6 |
| R7 | §6.2 | 4.2 |
| R8 | §6.3 | 4.3, 5.1 |
| R9 | §6.4, §7 | 5.2, 8.1 |
| R10 | §6.5 | 6.1, 6.2 |
| R11 | §6.6 | 4.4, 5.3 |
| R12 | §6.7 | 9.1 |
| R13 | §6.8 | 7.1 |
| R14 | §6.8 | 7.2, 7.3 |
| R15 | §7 | 8.1, 8.2 |
| R16 | §6.9 | 7.4 |
| R17 | §8 | 1.2, 9.2 |
| R18 | §8 | 1.1 |
| R19 | §6.3 | 4.3 (review) |
| R20 | §8 | 9.3 |

## 10. Riesgos y pendientes

- **Agrupación de kernels en H100 sin traza propia** (brief D14 y §12): la fusión de la cuantización por token en el camino FP8 por tensor queda `simplified` hasta tener una corrida en H100. La saturación de HBM (`sms_para_saturar` = 32) y el `t_overhead` por kernel quedan `estimated` (§4.4). Una traza de nsys en H100 los reemplazaría por medidas. La cuantización del camino FP8 por bloques ya no es una incógnita: el código fuente la deja en un kernel aparte (§4.1).
- **El tiling de cuBLAS BF16 es una aproximación** (`simplified`). Es el camino BF16, el que más se va a mirar; la UI tiene que decirlo con claridad.
- **El 3D es el riesgo principal de esfuerzo** (brief §2). Por eso el grupo 4 llega a un hito visible con datos reales temprano, en paralelo con el núcleo.
