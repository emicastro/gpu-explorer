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

- [ ] **3.1 Ops lógicas y perfil de fusión.** `ops.rs` (las ops de una capa y las de fuera del loop, con formas) y `data/fusion/vllm-0.31.0-h100.json` (plantillas con `name`, `ops`, `impl`, `when`). Tests de secuencia por capa: decode BF16 = 11 kernels, decode FP8 por bloques = 15, decode FP8 por tensor, decode W8A16, prefill BF16 sin `combine` cuando hay 1 split; el límite de capa cae en el kernel residual + RMSNorm. (R2; §4.1)
  Check: `cargo test -p gpuviz-core fusion`
- [ ] **3.2 Roofline y cota inferior.** FLOPs y bytes por kernel fusionado (entrada y salida del kernel) y por op suelta (para el ahorro por fusión); intensidad; si es memory- o compute-bound; cota inferior. Tests del brief §8: techo de decode 8B BF16 a batch 1 ≈ 221 tok/s; intensidad de la atención en decode = 4, independiente del batch; GEMMs de decode con intensidad ≈ M que cruzan el ridge cerca de M ≈ 295; contexto donde el KV iguala a los pesos ≈ 102k. (R1; §4.2)
  Check: `cargo test -p gpuviz-core roofline`
- [ ] **3.3 Tiling de FA3.** El kernel de preparación en decode con CUDA graphs (tope de 32), `num_splits_heuristic` fuera de CUDA graphs, tile 64×128 con PackGQA, `per_wave` sobre 132 CTAs persistentes. Tests: la tabla de splits del brief §7.2, fila por fila; 8 bloques sin split a batch 1. (R3, R11; §4.3)
  Check: `cargo test -p gpuviz-core fa3`
- [ ] **3.4 Tiling de GEMMs.** `flashinfer_swapab`, `deepgemm_sm90` (reimplementando el modelo de ciclos de `sm90.hpp`), `cutlass_fp8_tensor`, `cublas_bf16` (`simplified`) y los kernels elementwise. Tests: tiles FP8 por bloques a batch 1 (QKV 48, O 32, gate+up 192, down 32, tile 128×16); un caso de DeepGEMM con M = 256 contrastado a mano contra la heurística de C++ (documentar el cálculo en el test); la selección de CUTLASS por rango de M. (R3; §4.3)
  Check: `cargo test -p gpuviz-core gemm_tiling`
- [ ] **3.5 Tiempo realista y calibración.** Bloque `calibration` en el JSON de hardware (`η_m`, curva de `η_c`, `sms_para_saturar`, `t_overhead` con y sin CUDA graphs, todo `estimated` con fuentes). Test: decode 8B BF16, batch 1, contexto de 350, con la suma de `t_real` dentro de ±15 % de 7.28 ms y la suma de cotas inferiores por debajo. (R4; §4.4)
  Check: `cargo test -p gpuviz-core calibration`
- [ ] **3.6 Memoria, `evaluate` y frontera WASM.** Memoria (pesos, KV, libre, batch máximo, `overflow`); `evaluate` arma el `StepPlan` completo (kernels de fuera del loop incluidos, `layers`, `per_wave`); exports de WASM `hardware`, `models` y `evaluate`; wrapper en TS. Tests: todo `documented` tiene fuente (R6); un plan a 128k no da overflow a batch 1 y sí a batch 64; ida y vuelta desde Vitest. (R1, R5, R6; §3.3, §4.5, §5)
  Check: `cargo test -p gpuviz-core && scripts/build-wasm.sh && cd web && pnpm test core`

## 4. 3D: primer hito

- [ ] **4.1 Base de la escena y del store.** Store de zustand con sus cinco slices (§6.1). `<Scene>` con cámara, luces y fondo oscuro. Hook `window.__gpuviz` (solo en builds de prueba). Helpers de Playwright para leer el estado del store desde el e2e. (§6.1; ADR 0004)
  Check: `cd web && pnpm typecheck && pnpm test state && pnpm e2e smoke`
- [ ] **4.2 Navegación package ↔ die.** Máquina de estados de niveles; tween de cámara; fundido de los hermanos; migas de pan; Escape y Backspace. Tests unitarios de la máquina de estados; un e2e entra al die y vuelve. (R7; §6.2)
  Check: `cd web && pnpm test navigation && pnpm e2e navigation`
- [ ] **4.3 Geometría de package y die.** `layoutPackage` y `layoutDie` como funciones puras desde el árbol de hardware; paleta por función; instancing. Tests de cantidades: 6 sitios de HBM con 1 atenuado, 8 GPCs, 2 mitades de L2, 10 controladores. Checklist de review de R19: geometría propia, sin assets de terceros. (R8, R19; §6.3)
  Check: `cd web && pnpm test layout && pnpm build`
- [ ] **4.4 Hito: un kernel animado con datos reales.** Con el plan de `evaluate` (decode BF16, batch 1, 8k), animar un kernel (la GEMM QKV) recorriendo HBM → L2 → SM → tensor core, con partículas en escala logarítmica y el número exacto de bytes. El e2e lee la etiqueta de bytes y la compara con el plan. (R11; §6.6)
  Check: `cd web && pnpm test flow && pnpm e2e milestone`

## 5. 3D: niveles restantes

- [ ] **5.1 GPC, SM y sub-partición.** Layouts y navegación de los tres niveles; SMs deshabilitados en gris; lo físico se distingue de lo lógico (warps como abstracción, brief §4.1). Tests de cantidades; un e2e baja hasta la sub-partición y vuelve con Escape verificando las migas (R7 completo). (R7, R8; §6.2, §6.3)
  Check: `cd web && pnpm test layout && pnpm e2e navigation`
- [ ] **5.2 Panel de componente.** El panel muestra la prosa (con un stub de contenido hasta 8.1), las `specs` y "qué hace el LLM acá" según el kernel actual. Un e2e abre el panel de un SM. (R9; §6.4)
  Check: `cd web && pnpm test panel && pnpm e2e panel`
- [ ] **5.3 Ocupación por onda y lección de split-KV.** `smOccupancy` y resaltado de SMs por onda en los niveles die y GPC; para la atención, splits y bloques visibles. Tests: SMs ocupados = `per_wave[i]` acotado a 132; un e2e en decode a batch 1 y 8k ve 104 SMs ocupados en el kernel de atención. (R11; §6.6)
  Check: `cd web && pnpm test occupancy && pnpm e2e splitkv`

## 6. Reproducción del paso

- [ ] **6.1 Constructor de línea de tiempo.** `buildTimeline(plan, mode, focusLayer)`: modo didáctico con duración mínima, modo tiempo real proporcional, capas comprimidas y expandibles, marcas de capa. Solo tests unitarios. (R10; §6.5)
  Check: `cd web && pnpm test timeline`
- [ ] **6.2 Controles y sincronía con la escena.** Play, pausa, scrub y velocidad; el playhead en el store; la escena anima el kernel bajo el playhead. Un e2e hace scrub hasta la capa 3 y verifica el kernel activo. (R10; §6.5)
  Check: `cd web && pnpm test playback && pnpm e2e playback`

## 7. Perillas y vistas vinculadas

- [ ] **7.1 Panel de perillas.** Batch (log), contexto (log hasta 131072 con marca de YaRN), pesos (4 opciones; FP8 por bloques como FP8 por defecto), KV, fase y modo de tiempo. Cada cambio re-evalúa. Tests del store; un e2e mueve el contexto y verifica que cambia el KV en el plan. (R13; §6.8)
  Check: `cd web && pnpm test knobs && pnpm e2e knobs`
- [ ] **7.2 Vista de línea de tiempo de kernels.** Barras por kernel con selección compartida; resaltado en el 3D. (R14; §6.8)
  Check: `cd web && pnpm test selection && pnpm e2e timeline-view`
- [ ] **7.3 Roofline y barra de HBM.** Roofline log-log en SVG con techos de BF16 y FP8 y un punto por kernel; barra de HBM con el batch máximo y overflow en rojo. Un e2e hace click en un kernel de la línea de tiempo y verifica el punto resaltado en el roofline. (R13, R14; §6.8)
  Check: `cd web && pnpm test roofline && pnpm e2e linked-views`
- [ ] **7.4 `<Q>` y la regla de lint.** Componente de cantidad con indicador de confianza y fuentes al hacer hover o foco; regla de ESLint que prohíbe renderizar `number` en `views/` y `ui/`; migrar los usos existentes. (R16; §6.9)
  Check: `cd web && pnpm lint && pnpm test quantity`

## 8. Glosario y contenido

- [ ] **8.1 Pipeline de contenido.** Parser de frontmatter y renderer de `[[id]]`; `content/glossary/` sembrado desde `docs/GLOSSARY.md` (traducido al inglés); `content/components/` con una entrada por nodo del árbol de hardware. Test de contenido: links rotos, campos faltantes, componentes sin prosa y huérfanos. (R9, R15; §7; ADR 0005)
  Check: `cd web && pnpm test content`
- [ ] **8.2 Tooltips anidados.** Pila de tooltips; hover de 600 ms o foco; fijado con click o a los 1.5 s; anidados; Escape; el mismo componente en el 3D, sobre los componentes. Un e2e abre un tooltip y uno anidado con el mouse, y repite con el teclado. (R15; §7)
  Check: `cd web && pnpm test tooltip && pnpm e2e tooltips`

## 9. Producto

- [ ] **9.1 Presupuesto de rendimiento.** `renderInfo()` en builds de prueba; un e2e recorre todos los niveles y falla si los draw calls pasan de 200; medición manual de fps en GPU integrada en `docs/perf.md`. (R12; §6.7)
  Check: `cd web && pnpm e2e perf && test -s ../docs/perf.md`
- [ ] **9.2 Aviso de pantalla chica y pasada de textos.** Overlay a menos de 1024 px; revisión de que todo el texto visible esté en inglés. (R17; §8)
  Check: `cd web && pnpm e2e small-screen && pnpm build`
- [ ] **9.3 Deploy.** Crear el remoto en GitHub (lo hace el usuario) y escribir un workflow que corre `scripts/verify.sh` y publica `web/dist` en Pages, con el `base` de Vite correcto. (R20; §8; ADR 0007)
  Check: `gh run list --workflow deploy.yml --limit 1 --json conclusion -q '.[0].conclusion' | grep -qx success`
