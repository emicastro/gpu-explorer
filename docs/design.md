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
- **`data/models/qwen3-8b.json`:** los campos de `config.json` de Qwen/Qwen3-8B con los mismos nombres (brief §6.3), más un bloque `quantization_variants` con los esquemas FP8: `block` (`weight_block_size: [128, 128]`, activación 1×128 dinámica) y `per_tensor`.
- **`data/fusion/vllm-0.31.0-h100.json`:** el perfil de fusión (§4.1).
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
  - Cada kernel agrega `ops: Vec<OpId>` (las ops lógicas que fusiona), `phaseBreakdown` con los bytes por origen (pesos, KV, activaciones) para la barra de flujo, y `grid.perWave: Vec<u32>` (bloques por onda) para el mapeo a SMs.
  - `layers: Vec<LayerSpan>` indica qué rango de kernels corresponde a cada capa. No es un corte limpio: la suma residual se fusiona con la RMSNorm de la capa siguiente (brief §6.5), así que el rango se define por el kernel que **empieza** la capa.
- Errores: un enum con mensaje (escenario inválido, batch que no entra en HBM, id inexistente). En la frontera WASM se convierten en `JsError`.

## 4. Núcleo: el modelo

### 4.1 Ops lógicas y perfil de fusión (R2)

- `ops.rs` genera las ops lógicas de una capa de Qwen3 (brief §6.5, lista 1–11) y las de fuera del loop. Cada una lleva sus formas (M, N, K o tamaño del tensor) y sus bytes y FLOPs "sueltos".
- El perfil de fusión es **dato**. Es una lista ordenada de plantillas de kernel por capa, cada una con:
  - `name` (el nombre de vLLM, p. ej. `triton_red_fused_add_rms_norm`, `flash_fwd_sm90`, `flash_fwd_combine`);
  - `ops` (los ids de las ops que fusiona);
  - `impl` (la clave del modelo de tiling: `inductor_elementwise`, `cublas_bf16`, `cutlass_fp8_tensor`, `flashinfer_swapab`, `deepgemm_sm90`, `marlin_w8a16`, `fa3`, `fa3_combine`, `vllm_cache_write`, `fp8_act_quant`);
  - `when` (una condición sobre el escenario: `weights == fp8_block`, `phase == decode`, `splits > 1`, …).
- Secuencia por capa en decode BF16 (11 kernels): residual + RMSNorm, GEMM QKV, QK-norm + RoPE, escritura al KV, FA3, FA3 combine, GEMM O, residual + RMSNorm, GEMM gate+up, SiLU·mul, GEMM down.
  - Con FP8 por bloques se agrega un kernel de cuantización de la activación antes de cada GEMM: 15 por capa.
  - En prefill, sin CUDA graphs, el `combine` solo aparece si la heurística da `splits > 1`.
  - El `splitKreduce` de cuBLAS que se vio en Ampere no se modela en H100 (no hay fuente; `simplified`).
- Fuera del loop:
  - kernels de preparación de inputs (~8, `estimated`);
  - el `prepare_varlen_num_blocks` de FA3, una vez por paso;
  - embeddings + primera RMSNorm (fusionadas), RMSNorm final, gather del último token, LM head y sampling.
- La cuantización FP8 de la activación queda como kernel separado también en el camino DeepGEMM (`simplified`; brief §12).

### 4.2 Roofline y cota inferior (R1)

Fórmulas del brief §7.1, sin cambios.
- Pico de cómputo según el dtype efectivo del kernel: BF16, o FP8 solo si ambos operandos son FP8 (W8A8).
- Ancho de banda: HBM.
- Cota inferior = `max(FLOPs / pico, bytes / BW)`.
- Los bytes de un kernel fusionado son la entrada y salida del kernel, no la suma de sus ops: esa diferencia es el "ahorro por fusión" que muestra la UI (brief D7).

### 4.3 Tiling y ondas (R3)

Un módulo por `impl`, todos con la misma firma: `fn launch(shape, scenario, hw) -> Launch { blocks, tile, splits, per_wave, smem, regs, persistent, confidence }`.

| `impl` | Fuente | Confianza |
|---|---|---|
| `fa3` | brief §7.2: kernel de preparación en decode con CUDA graphs (tope de 32); `num_splits_heuristic` fuera de CUDA graphs; tile 64×128 con un warpgroup y PackGQA en decode | `documented` |
| `flashinfer_swapab` | `get_best_gemm_config` (FlashInfer 0.7.0.post1), M < 32 | `documented` |
| `deepgemm_sm90` | heurística de `sm90.hpp` (DeepGEMM `e1f418c`), M ≥ 32, reimplementada con su modelo de ciclos L1/L2 | `documented` |
| `cutlass_fp8_tensor` | tabla de `scaled_mm_sm90_fp8_dispatch.cuh` | `documented` |
| `cublas_bf16` | tiles representativos de Hopper (los de CUTLASS BF16 equivalentes) | `simplified` |
| `marlin_w8a16`, `inductor_elementwise`, `vllm_cache_write`, `fp8_act_quant` | grid del código fuente o de la traza de D14 | `simplified` |

- Kernels persistentes (FA3 varlen, DeepGEMM, FlashInfer): grid de 132 CTAs. Las "ondas" son las rondas de tiles que reparte el scheduler: `ondas = ⌈tiles / 132⌉`.
- `per_wave[i]` = tiles activos en la ronda `i`. El 3D asigna tiles a SMs en orden de índice de SM. El scheduler real no es determinista, así que esa asignación es `simplified`.

### 4.4 Tiempo realista (R4)

Por kernel:

```
bw_ef      = BW · η_m · min(1, sms_activos / sms_para_saturar)
compute_ef = pico · η_c(forma)
t_real     = max(FLOPs / compute_ef, bytes / bw_ef) + t_overhead
```

- `η_m` = 0.93 (STREAM, brief §7.1).
- `sms_para_saturar`: cuántos SMs hacen falta para saturar HBM. Es un parámetro `estimated`, que responde la pregunta abierta de las 32 CTAs (brief §12).
- `η_c(forma)` sale de la tabla de rangos del brief §7.1, interpolada por tamaño.
- `t_overhead` es por kernel: con CUDA graphs en decode, menor que sin ellos en prefill.
- Todos los parámetros viven en `data/hardware/h100-sxm.json`, en un bloque `calibration`, con confianza `estimated` y fuentes.
- Test de calibración: decode 8B BF16, batch 1, contexto de 350 → suma de `t_real` dentro de ±15 % de 7.28 ms (GPUStack), y suma de cotas inferiores menor que 7.28 ms.

### 4.5 Memoria (R5)

- `weights` = parámetros × bytes por peso, más las escalas FP8.
- `kv` = Σ contextos × KV por token (brief §7.1).
- `free` = capacidad − pesos − KV − reserva de activaciones (`estimated`).
- `maxBatch` = cuántos requests del contexto actual entran en el espacio libre.
- Si el escenario no entra, `evaluate` devuelve el plan con `memory.overflow = true`. No es un error: la UI lo muestra en rojo.

## 5. Frontera WASM

- `crates/wasm` exporta `hardware(id)`, `models()`, `evaluate(hw, model, scenario)`. Recibe y devuelve valores JS vía `serde-wasm-bindgen`.
- `web/src/core/index.ts` envuelve el módulo y castea a los tipos generados (ADR 0001).
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

- **Agrupación de kernels en H100 sin traza propia** (brief D14 y §12): la fusión de la cuantización FP8 y la saturación de HBM con 32 CTAs quedan `simplified` / `estimated` hasta tener una corrida en H100.
- **El tiling de cuBLAS BF16 es una aproximación** (`simplified`). Es el camino BF16, el que más se va a mirar; la UI tiene que decirlo con claridad.
- **El 3D es el riesgo principal de esfuerzo** (brief §2). Por eso el grupo 4 llega a un hito visible con datos reales temprano, en paralelo con el núcleo.
