# Tareas — GPU Inference Explorer v1

Status: accepted
Date: 2026-10-09

Cada tarea entra en una sesión de implementación y termina en un `Check:` que falla con salida distinta de cero. Se tilda solo en la sesión que la termina. Referencias: [`requirements.md`](requirements.md) (R*), [`design.md`](design.md) (§*), [`adr/`](adr/).

Orden: los grupos 1 y 2 primero. Después, el núcleo (3) y el 3D (4) avanzan en paralelo (brief §9). Desde 4.4 en adelante hace falta 3.6.

## 1. Esqueleto

- [x] **1.1 Workspace de Cargo y licencias.** `rust-toolchain.toml` (con el target wasm32); workspace con `crates/core` (`gpuviz-core`, lib) y `crates/wasm` (`gpuviz-wasm`, cdylib, `wasm-bindgen` fijado con `=`); `LICENSE-MIT`, `LICENSE-APACHE`, `LICENSE-CONTENT`; `license = "MIT OR Apache-2.0"`. (R18; §2; ADR 0003)
  Check: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && test -f LICENSE-MIT -a -f LICENSE-APACHE -a -f LICENSE-CONTENT`
- [x] **1.2 App web.** `web/` con pnpm, Vite, React, TS estricto, R3F, drei, zustand, ESLint, Vitest y Playwright (Chromium). Una página con un `<Canvas>` y una caja. Un test unitario trivial y un e2e que carga la página y falla si hay errores en la consola. `package.json` con `"license": "MIT OR Apache-2.0"`. (R17; §2, §6.1; ADR 0004, 0006)
  Check: `cd web && pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e`
- [x] **1.3 Pipeline WASM de punta a punta.** `scripts/build-wasm.sh` (verifica la versión de `wasm-bindgen-cli` contra el pin y escribe en `web/src/wasm/`, ignorado por git). El núcleo expone `version()`; `web/src/core/index.ts` lo envuelve; un test de Vitest lo llama con `initSync`. `scripts/verify.sh` con la receta completa de §2 (los pasos que todavía no existen se saltean con un aviso explícito). (§2, §5; ADR 0003)
  Check: `scripts/verify.sh`

## 2. Núcleo: tipos y datos

- [x] **2.1 Unidades y `Quantity`.** Newtypes con solo las operaciones con sentido físico; `Provenance` y `Quantity`; la confianza se propaga con el peor de los insumos; derive de ts-rs detrás de la feature `ts`, exportado a `web/src/generated/`. Un test `trybuild` (o un doctest `compile_fail`) prueba que `Bytes + Flops` no compila. (R6; §3.1; ADR 0001)
  Check: `cargo test -p gpuviz-core --features ts && git diff --exit-code web/src/generated && cargo clippy --all-targets --all-features -- -D warnings`
- [x] **2.2 Datos de H100 SXM.** `data/hardware/h100-sxm.json` (árbol completo hasta `unit`, con valores del brief D1 y sus fuentes; reparto de TPCs `simplified`; 6 sitios de HBM con 5 activos), un loader con `include_str!` y `deny_unknown_fields`. Tests: 132 SMs habilitados, 66 TPCs, 8 GPCs, 10 controladores activos; pico BF16 derivado ≈ 989 TFLOPS (±1 %); ridge ≈ 295 BF16 y ≈ 590 FP8. (R1, R8; §3.2; ADR 0002)
  Check: `cargo test -p gpuviz-core hardware`
- [x] **2.3 Config de Qwen3-8B.** `data/models/qwen3-8b.json` (campos de `config.json` más `quantization_variants`). Tests del brief §8: 8.19 B parámetros (6.95 B sin embeddings), 147 456 bytes de KV por token en BF16, ~15.1 GB de pesos leídos por decode en BF16, KV de un request de 32k = 4.5 GiB. (R1, R5; §3.2)
  Check: `cargo test -p gpuviz-core model`

## 3. Núcleo: el modelo

- [x] **3.1 Ops lógicas y perfil de fusión.** `ops.rs` (las ops de una capa y las de fuera del loop, con formas) y `data/fusion/vllm-0.31.0-h100.json` (plantillas con `name`, `ops`, `impl`, `when`). Tests de secuencia por capa: decode BF16 = 11 kernels, decode FP8 por bloques = 15, decode FP8 por tensor, decode W8A16, prefill BF16 sin `combine` cuando hay 1 split; el límite de capa cae en el kernel residual + RMSNorm. (R2; §4.1)
  Check: `cargo test -p gpuviz-core fusion`
- [x] **3.2 Roofline y cota inferior.** FLOPs y bytes por kernel fusionado (entrada y salida del kernel) y por op suelta (para el ahorro por fusión); intensidad; si es memory- o compute-bound; cota inferior. Tests del brief §8: techo de decode 8B BF16 a batch 1 ≈ 221 tok/s; intensidad de la atención en decode = 4, independiente del batch; GEMMs de decode con intensidad ≈ M que cruzan el ridge cerca de M ≈ 295; contexto donde el KV iguala a los pesos ≈ 102k. (R1; §4.2)
  Check: `cargo test -p gpuviz-core roofline`
- [x] **3.3 Tiling de FA3.** El kernel de preparación en decode con CUDA graphs (tope de 32), `num_splits_heuristic` fuera de CUDA graphs, tile 64×128 con PackGQA, `per_wave` sobre 132 CTAs persistentes. Tests: la tabla de splits del brief §7.2, fila por fila; 8 bloques sin split a batch 1. (R3, R11; §4.3)
  Check: `cargo test -p gpuviz-core fa3`
- [x] **3.4 Tiling de GEMMs.** `flashinfer_swapab`, `deepgemm_sm90` (reimplementando el modelo de ciclos de `sm90.hpp`), `cutlass_fp8_tensor`, `cublas_bf16` (`simplified`) y los kernels elementwise. Tests: tiles FP8 por bloques a batch 1 (QKV 48, O 32, gate+up 192, down 32, tile 128×16); un caso de DeepGEMM con M = 256 contrastado a mano contra la heurística de C++ (documentar el cálculo en el test); la selección de CUTLASS por rango de M. (R3; §4.3)
  Check: `cargo test -p gpuviz-core gemm_tiling`
- [x] **3.4b Grids del resto de los kernels.** Un `Launch` para cada `impl` que no cubren 3.3 ni 3.4: `fa3_combine` y `fa3_prepare` (`documented`, desde FA3 `9cd61de`), y `marlin_w8a16`, `vllm_cache_write`, `fp8_act_quant`, `vllm_prepare_inputs`, `torch_index` y `sampling` (`simplified`, desde el código o la traza de D14). Los no persistentes usan el helper de ocupación de `tiling/mod.rs` (ADR 0013). Tests: `prepare` lanza 1 CTA hasta 992 requests y 2 a partir de 993; el grid de `combine` en decode a batch 1 contrastado a mano contra `flash_fwd_combine_kernel.h` (documentar el cálculo en el test); todo kernel de todas las variantes de escenario tiene un `Launch` con fuente. Va antes de 3.5, que usa los SMs activos de cada kernel. (R3, R11; §4.3)
  Check: `cargo test -p gpuviz-core kernel_grid`
- [x] **3.5 Tiempo realista y calibración.** Bloque `calibration` en el JSON de hardware (`η_m`, curva de `η_c`, `sms_para_saturar`, `t_overhead` con y sin CUDA graphs, todo `estimated` con fuentes). Test: decode 8B BF16, batch 1, contexto de 350, con la suma de `t_real` dentro de ±15 % de 7.28 ms y la suma de cotas inferiores por debajo. (R4; §4.4)
  Check: `cargo test -p gpuviz-core calibration`
- [x] **3.5b Relleno de CUDA graphs.** En decode con CUDA graphs (hasta 512 tokens), el núcleo rellena M hasta el tamaño capturado más cercano (`[1, 2, 4] + 8..248 de a 8 + 256..512 de a 16`, `documented` desde vLLM v0.31.0) antes de elegir plantillas de fusión, contar bytes y cortar tiles. Verificar en vLLM qué kernels ven el M rellenado (las GEMMs y los elementwise sí; la atención y el `combine`, confirmar) y documentarlo en §4.1–§4.3. Tests: decode FP8 por bloques a batch 25 va por DeepGEMM con M = 32; batch 3 se rellena a 4; los pasos de más de 512 tokens no se rellenan, y un prefill chico sí (graph PIECEWISE), pero no su atención; los bytes de activación crecen con el relleno y los de pesos no. (R1, R3; §4.1–§4.3, §10)
  Check: `cargo test -p gpuviz-core graph_padding`
- [x] **3.5c Overhead por kernel según el graph.** `t_overhead` se cobra por kernel y no por paso: 4 µs si el kernel corre dentro de un CUDA graph, 6 µs si se lanza a mano. Dentro del graph: en decode de hasta 512 tokens (FULL), los kernels del modelo, la atención y la escritura al KV; en prefill de hasta 512 (PIECEWISE), solo los kernels del modelo. Fuera, siempre: la preparación de inputs, el `prepare` de FA3, el gather del último token, el LM head y el sampling. Sin recalibrar: los valores no cambian, cambia a qué kernel se aplica cada uno. Tests: decode a batch 1 cobra 6 µs a los 11 kernels de fuera del modelo y 4 µs al resto; un prefill de 300 tokens cobra 4 µs a los kernels del modelo y 6 µs a la atención y la escritura al KV; un paso de más de 512 tokens cobra 6 µs a todo; el ancla de calibración sigue dentro de ±15 %. (R4; §4.1, §4.4, §10)
  Check: `cargo test -p gpuviz-core graph_overhead`
- [x] **3.6 Memoria, `evaluate` y frontera WASM.** Memoria (pesos, KV, libre, batch máximo, `overflow`); `evaluate` arma el `StepPlan` completo (kernels de fuera del loop incluidos, `layers`, `per_wave`); exports de WASM `hardware`, `models` y `evaluate`; wrapper en TS. Tests: todo `documented` tiene fuente (R6); un plan a 128k no da overflow a batch 1 y sí a batch 64; ida y vuelta desde Vitest. (R1, R5, R6; §3.3, §4.5, §5)
  Check: `cargo test -p gpuviz-core && scripts/build-wasm.sh && cd web && pnpm test core`

## 4. 3D: primer hito

- [x] **4.1 Base de la escena y del store.** Store de zustand con sus cinco slices (§6.1). `<Scene>` con cámara, luces y fondo oscuro. Hook `window.__gpuviz` (solo en builds de prueba). Helpers de Playwright para leer el estado del store desde el e2e. (§6.1; ADR 0004)
  Check: `cd web && pnpm typecheck && pnpm test state && pnpm e2e smoke`
- [x] **4.2 Navegación package ↔ die.** Máquina de estados de niveles; tween de cámara; fundido de los hermanos; migas de pan; Escape y Backspace. Tests unitarios de la máquina de estados; un e2e entra al die y vuelve. (R7; §6.2)
  Check: `cd web && pnpm test navigation && pnpm e2e navigation`
- [x] **4.3 Geometría de package y die.** `layoutPackage` y `layoutDie` como funciones puras desde el árbol de hardware; paleta por función; instancing. Tests de cantidades: 6 sitios de HBM con 1 atenuado, 8 GPCs, 2 mitades de L2, 10 controladores. Checklist de review de R19: geometría propia, sin assets de terceros. (R8, R19; §6.3)
  Check: `cd web && pnpm test layout && pnpm build`
- [x] **4.4 Hito: un kernel animado con datos reales.** Con el plan de `evaluate` (decode BF16, batch 1, 8k), animar un kernel (la GEMM QKV) recorriendo HBM → L2 → SM → tensor core, con partículas en escala logarítmica y el número exacto de bytes. El e2e lee la etiqueta de bytes y la compara con el plan. (R11; §6.6)

- [x] **4.5 Pasada visual: metal y detalle.** El estilo de [ADR 0017](adr/0017-metallic-materials-and-detail-density.md) se aplica al package y al die, tomando como referencia el video `h9Z4oGN89MU`. Lo que manda, en orden: materiales metálicos, densidad de detalle y fluidez.
  - `materials.ts` arma los materiales: sustrato, silicio, metal, contactos y bloques de función con el color de `palette.ts`. Cada grupo que se desvanece tiene su propio juego, así que el fundido de 4.2 sigue andando.
  - Environment generado en código una sola vez, con `<Lightformer>` y sin presets ni archivos. Bordes biselados con una geometría compartida.
  - Detalle contable con la cantidad del árbol: los SMs de cada GPC en el die, con los deshabilitados atenuados. Detalle de superficie con texturas generadas en runtime: pistas del sustrato, micro-bumps del interposer y grano de lógica. El detalle no recibe raycast.
  - `window.__gpuviz.renderInfo()` en builds de prueba. Pixel ratio adaptativo con `<PerformanceMonitor>`, con tope de 2.
  - Tests: cada `PartKind` tiene material; los SMs dibujados en el die son 144, con 132 habilitados; el fundido de un grupo no cambia la opacidad de los materiales de otro. Un e2e en package y en die exige ≤ 200 draw calls y ≤ 500 000 triángulos, y que el click al die siga entrando.
  - Review: el usuario aprueba capturas de los dos niveles. Checklist de R19: sin HDRIs, imágenes ni modelos de terceros. (R12, R19, R21; §6.3, §6.7)
  Check: `cd web && pnpm test flow && pnpm e2e milestone`

- [x] **4.6 Legibilidad: etiquetas y flujo por etapas.** Se aplica la [ADR 0018](adr/0018-scene-labels-and-staged-flow.md), a pedido del usuario después de revisar las capturas de la 4.5.
  - `scene/labels.ts` (función pura) y etiquetas fijas por tipo en el package y en el die, con la cantidad del árbol. No toman eventos del puntero.
  - Flujo: tramos compartidos dibujados en un `lineSegments`, ondas con un solo reloj, llegada a un SM habilitado y el tramo actual resaltado en la etiqueta del DOM y en las del nivel (`flow/stage.ts`).
  - Tests: las etiquetas del die dicen `SM ×132 (+12 off)` y `×10 (+2 off)` para los controladores, y la del package `×5 (+1 off)` para la HBM; cada ruta termina sobre un SM habilitado; se dibujan 26 tramos; las fases de una onda caben en su desfasaje. Un e2e en el die lee las etiquetas, ve cambiar el tramo resaltado y sigue dentro del presupuesto; el click al die sigue entrando con las etiquetas encima.
  - Review: el usuario aprueba capturas de los dos niveles. (R8, R11, R17; §6.6, §6.6b)
  Check: `cd web && pnpm test flow labels && pnpm e2e milestone`

## 5. 3D: niveles restantes

- [x] **5.1 GPC, SM y sub-partición.** ([ADR 0019](adr/0019-nested-level-frames-and-instance-picks.md).) Layouts y navegación de los tres niveles; SMs deshabilitados en gris; lo físico se distingue de lo lógico (warps como abstracción, brief §4.1). Tests de cantidades; un e2e baja hasta la sub-partición y vuelve con Escape verificando las migas (R7 completo). Los tres niveles usan los materiales y la regla del detalle de 4.5 (ADR 0017). Va después de 4.5. Review: el usuario aprueba capturas de los tres niveles. (R7, R8, R21; §6.2, §6.3)
  Check: `cd web && pnpm test layout && pnpm e2e navigation`
- [x] **5.2 Panel de componente.** El panel muestra la prosa (con un stub de contenido hasta 8.1), las `specs` y "qué hace el LLM acá" según el kernel actual. Un e2e abre el panel de un SM. (R9; §6.4)
  Check: `cd web && pnpm test panel && pnpm e2e panel`
- [x] **5.3 Ocupación por onda y lección de split-KV.** `smOccupancy` y resaltado de SMs por onda en los niveles die y GPC; para la atención, splits y bloques visibles. Tests: SMs ocupados = `per_wave[i]` acotado a 132; un e2e en decode a batch 1 y 8k ve 104 SMs ocupados en el kernel de atención. De paso: `nodeAtLevel` (`scene/layout.ts`) deja de usar `try/catch` como control de flujo. ([ADR 0020](adr/0020-sm-order-and-scene-kernel.md); R11; §6.6)
  Check: `cd web && pnpm test occupancy && pnpm e2e splitkv`

## 6. Reproducción del paso

- [x] **6.1 Constructor de línea de tiempo.** `buildTimeline(plan, mode, focusLayer)`: modo didáctico con duración mínima, modo tiempo real proporcional, capas comprimidas y expandibles, marcas de capa. Solo tests unitarios. (R10; §6.5)
  Check: `cd web && pnpm test timeline`
- [x] **6.2 Controles y sincronía con la escena.** Play, pausa, scrub y velocidad; el playhead en el store; la escena anima el kernel bajo el playhead: el playhead escribe `sceneKernel` (ADR 0020), que ya leen la escena, `FlowLabel` y el panel, y la onda de los SMs sigue al playhead en vez del reloj de la escena. El selector de kernel de la tarjeta de ocupación pasa a mover el playhead, o se quita. Un e2e hace scrub hasta la capa 3 y verifica el kernel activo. (R10; §6.5)
  Check: `cd web && pnpm test playback && pnpm e2e playback`

## 7. Perillas y vistas vinculadas

- [x] **7.1 Panel de perillas.** Batch (log), contexto (log hasta 131072 con marca de YaRN), pesos (4 opciones; FP8 por bloques como FP8 por defecto), KV, fase y modo de tiempo. Cada cambio re-evalúa. Tests del store; un e2e mueve el contexto y verifica que cambia el KV en el plan. (R13; §6.8)
  Check: `cd web && pnpm test knobs && pnpm e2e knobs`
- [x] **7.2 Vista de línea de tiempo de kernels.** Barras por kernel con selección compartida; resaltado en el 3D. (R14; §6.8)
  Check: `cd web && pnpm test selection && pnpm e2e timeline-view`
- [x] **7.3 Roofline y barra de HBM.** Roofline log-log en SVG con techos de BF16 y FP8 y un punto por kernel; barra de HBM con el batch máximo y overflow en rojo. Un e2e hace click en un kernel de la línea de tiempo y verifica el punto resaltado en el roofline; otro mueve el contexto y verifica que cambia la barra de HBM (el e2e de R13, que la 7.1 no puede hacer porque la barra todavía no existe). (R13, R14; §6.8)
  Check: `cd web && pnpm test roofline && pnpm e2e linked-views`
- [x] **7.4 `<Q>` y la regla de lint.** Se aplica la [ADR 0022](adr/0022-numbers-outside-q.md).
  - `<Q>` con indicador de confianza y un popover mínimo de fuentes al hacer hover o foco, que se cierra con Escape o blur (la 8.2 lo absorbe sin cambiar las props). `<Num>` para los números que no afirman nada.
  - Regla de ESLint local y con tipos sobre los hijos de JSX en todo `web/src/`, salvo los módulos de `<Q>` y `<Num>`: marca expresiones `number` y textos derivados de un operando `number`.
  - Migrar a `<Q>`:
    - `formatQuantity` y `countText` de `panel/facts.ts`;
    - los bytes de `FlowLabel`;
    - los números de `OccupancyCard`, con las cabezas KV como `Quantity` del config (ADR 0010);
    - `HbmBar` (sale `gb()`, también de los `title`);
    - los puntos del roofline (`attained`).
  - Migrar a `<Num>`: los ticks del roofline, el tiempo y la velocidad de `Transport` y los valores de las perillas.
  - Etiquetas 3D: `SceneLabel.confidence`, la peor de los nodos contados, dibujada como el mismo punto, sin eventos del puntero.
  - Tests: el render del indicador por nivel de confianza; el popover abre con foco y cierra con Escape; la regla marca `{n}`, `{x.toFixed(1)}` y `{gb(bytes)}` y deja pasar `<Q>` y `<Num>`; la etiqueta de los SMs del GPC lleva la confianza `simplified` del reparto de TPCs. (R16; §6.9)
  Check: `cd web && pnpm lint && pnpm test quantity`

## 8. Glosario y contenido

- [x] **8.1 Pipeline de contenido.** Parser de frontmatter y renderer de `[[id]]`; `content/glossary/` sembrado desde `docs/GLOSSARY.md` (traducido al inglés); `content/components/` con una entrada por nodo del árbol de hardware; el panel de componente lee de ahí (`proseFor` en `panel/facts.ts` deja de devolver el stub). Test de contenido: links rotos, campos faltantes, componentes sin prosa y huérfanos. (R9, R15; §7; ADR 0005)
  Check: `cd web && pnpm test content`
- [x] **8.2 Tooltips anidados.** Pila de tooltips; hover de 600 ms o foco; fijado con click o a los 1.5 s; anidados; Escape; el mismo componente en el 3D, sobre los componentes. Un e2e abre un tooltip y uno anidado con el mouse, y repite con el teclado. (R15; §7)
  Check: `cd web && pnpm test tooltip && pnpm e2e tooltips`

## 9. Producto

- [x] **9.1 Presupuesto de rendimiento.** Con el `renderInfo()` de 4.5, un e2e recorre todos los niveles (navegando por el store, no con clicks a fracciones fijas del canvas, que quedan solo en `navigation.spec.ts` para R7) y falla si los draw calls pasan de 200 o los triángulos de 500 000; medición manual de fps en GPU integrada en `docs/perf.md`. (R12; §6.7)
  Check: `cd web && pnpm e2e perf && test -s ../docs/perf.md`
- [ ] **9.2 Aviso de pantalla chica y pasada de textos.** Overlay a menos de 1024 px; revisión de que todo el texto visible esté en inglés. Overlay de error si `initCore()` falla (hoy es un `await` suelto en `main.tsx` y la página queda en negro). Etiquetas que tapan lo que nombran: los núcleos de la sub-partición (FP32, INT32, FP64, load/store) y SM y TPC en el GPC (anclajes `first-top` y `last-front` de `scene/labels.ts`). (R17; §8)
  Check: `cd web && pnpm e2e small-screen && pnpm build`
- [ ] **9.3 Deploy.** Crear el remoto en GitHub (lo hace el usuario) y escribir un workflow que corre `scripts/verify.sh` y publica `web/dist` en Pages, con el `base` de Vite correcto. (R20; §8; ADR 0007)
  Check: `gh run list --workflow deploy.yml --limit 1 --json conclusion -q '.[0].conclusion' | grep -qx success`
