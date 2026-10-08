# GPU Inference Explorer — Brief del proyecto

> **Estado: borrador v2.** Las decisiones marcadas **[cerrada]** fueron confirmadas; el resto sigue abierto. Toda decisión incluye el motivo y una condición de "Revisar si…": si aparece evidencia en contra, se cambia la decisión y se actualiza este archivo. Ningún número de hardware o de modelo se da por bueno sin un test o una fuente que lo respalde.
>
> Vocabulario: ver [`docs/GLOSSARY.md`](docs/GLOSSARY.md).

---

## 1. Qué es

Un sitio web con visualizaciones 3D interactivas que muestran cómo interactúan el hardware de una GPU y el software de inferencia de un LLM. El usuario puede:

- Navegar la GPU por niveles (placa → package → die → GPC → SM → sub-partición → tensor core) y clickear componentes.
- Ver en cada componente **qué hace**, **qué guarda** y **qué está haciendo el LLM ahí**.
- Reproducir un paso de inferencia como animación (play / pausa / scrub): qué kernels corren, en qué SMs, cuántos bytes se mueven y cuántos FLOPs se hacen.
- Mover perillas (batch, contexto, precisión de pesos y de KV, prefill/decode) y ver cómo cambian los cuellos de botella.
- Pasar el mouse sobre cualquier término técnico para ver su definición, con tooltips anidados.

**Audiencia:** ingenieros que quieren entrar a inference engineering y necesitan conectar "cómo funciona un transformer" con "qué pasa en el silicio".

**Hueco que cubre:** hay visualizaciones del modelo sin hardware (LLM Visualization de Bycroft), explicaciones de hardware orientadas a gráficos/gaming (Branch Education, LearnOpenCV, ambas sobre GA102) y calculadoras 2D de inferencia (LLM-Viewer hace roofline por capa). Ninguna conecta token → capa → kernel → SM → bytes de HBM en una sola vista 3D navegable.

## 2. Principio central

**El 3D es la experiencia; el núcleo es la garantía de que lo que muestra es verdad.**

- El **núcleo** es un módulo de cálculo puro (sin UI) que, dado un hardware, un modelo y un escenario, produce la secuencia de kernels con FLOPs, bytes, intensidad aritmética, tiempos y su mapeo a SMs (tiles y ondas). Todo lo que la UI muestra como número sale de acá.
- El **3D** es la vista principal y la razón de ser del producto. No es una capa decorativa: es lo que más riesgo y trabajo tiene, y se prototipa desde el principio, en paralelo con el núcleo.
- Las vistas 2D (línea de tiempo, roofline, barra de HBM) acompañan al 3D y están vinculadas: seleccionar algo en una lo resalta en las demás.

---

## 3. Decisiones

### D1 — Hardware: NVIDIA H100 SXM

- **Por qué:** común en la industria, bien documentada (whitepaper de Hopper), con features relevantes para inferencia moderna (FP8, TMA, shared memory grande).
- **Revisar si:** el público usa mayoritariamente otra GPU (H200, B200, MI300X), o Blackwell se vuelve la referencia.
- El hardware es un **archivo de datos**, no código. H200 (mismo die, 141 GB HBM3e, ~4.8 TB/s) debería salir casi gratis y sirve para mostrar el efecto del ancho de banda en decode.

Números de partida (**verificar todos contra el whitepaper antes de usarlos**):

| Parámetro | Valor | Nota |
|---|---|---|
| SMs | 132 (8 GPCs, 66 TPCs) | El die completo tiene 144 SMs / 72 TPCs. Los SMs deshabilitados varían por unidad, así que el reparto por GPC no es parejo → `simplified` |
| HBM3 | 80 GB, ~3.35 TB/s | 5 stacks activos en el package (verificar) |
| L2 | 50 MB | Dividida en dos particiones (verificar detalle) |
| Shared memory / L1 por SM | 256 KB combinados, hasta 228 KB de shared memory | |
| Register file por SM | 256 KB (64 KB por sub-partición) | |
| Tensor cores | 4 por SM (1 por sub-partición) | |
| BF16 denso | ~989 TFLOPS | Pico teórico. Derivarlo en un test: SMs × FLOPs/clk/SM × reloj (4096 FLOPs/clk/SM implica ~1.83 GHz; verificar qué reloj asume NVIDIA) |
| FP8 denso | ~1979 TFLOPS | Solo con ambos operandos en FP8 (W8A8) |
| NVLink | 900 GB/s | Agregado bidireccional (~450 GB/s por sentido). Fuera de v1 |
| Ridge point | ~295 FLOP/byte (BF16), ~590 (FP8) | |

### D2 — Modelos: Qwen3-8B (denso) y Qwen3-30B-A3B (MoE)

- **Por qué:** misma familia y generación: comparten tokenizer y tipos de operación (RMSNorm, QK-norm, RoPE, GQA, SwiGLU). Ambos usan GQA estándar en todas las capas (sin ventana deslizante ni atención lineal) y entran en una H100 en BF16.
- **Revisar si:** el MoE chico deja de ser representativo de producción, o conviene una generación más nueva (verificar que mantenga atención estándar: las arquitecturas híbridas con atención lineal cambian por completo el modelo del KV cache).

Valores de `config.json` oficiales:

| | Qwen3-8B | Qwen3-30B-A3B |
|---|---|---|
| `num_hidden_layers` | 36 | 48 |
| `hidden_size` | 4096 | 2048 |
| `num_attention_heads` / `num_key_value_heads` | 32 / 8 | 32 / 4 |
| `head_dim` | 128 | 128 |
| MLP | denso, `intermediate_size` 12288 | 128 expertos, `moe_intermediate_size` 768, 8 activos por token, sin experto compartido, `norm_topk_prob: true`, MoE en todas las capas |
| `vocab_size` | 151936 | 151936 |
| `tie_word_embeddings` | false | false |
| `rope_theta` | 1e6 | 1e6 |
| `max_position_embeddings` | 40960 | 40960 |

Notas:
- No solo cambia el MLP. El MoE es más angosto (2048), más profundo (48 capas) y tiene la mitad de cabezas KV.
- En el MoE, `n_q · d = 4096 ≠ hidden_size = 2048`: QKV es 2048 → 5120 y O es 4096 → 2048. Error fácil de cometer; tiene test.
- Contexto nativo: 32k. Hasta 128k con YaRN (ver D11).

### D3 — Modelo analítico con mapeo a SMs, sin simulación por ciclos [cerrada]

- **Por qué:** el objetivo es enseñar intuiciones correctas (memory-bound vs compute-bound, efecto del batch, peso del KV cache). Un roofline por kernel alcanza para los números. Para que el 3D muestre qué hace cada SM, se suma un **modelo de tiling y ondas**: cuántos thread blocks lanza cada kernel, cómo se reparten en los 132 SMs y cuántas ondas hacen falta. Sigue siendo analítico y testeable. Simular ciclos es caro y frágil.
- **Revisar si:** algún fenómeno clave no se puede explicar sin modelar ocupación fina, latencias o solapamiento de kernels.

### D4 — Dos modos de tiempo: cota inferior y realista [cerrada]

- **Cota inferior:** `max(FLOPs / pico, bytes / ancho de banda)`. El límite físico: 100 % de eficiencia, cero overhead.
- **Realista:** la cota corregida con factores de eficiencia y overhead por kernel, calibrados contra benchmarks públicos. Siempre `estimated`.
- **Por qué:** en kernels chicos la cota inferior se equivoca por órdenes de magnitud (un RMSNorm de 8 KB: cota ~2.4 ns, realidad del orden de µs). La distancia entre ambas es una lección en sí misma: por qué nunca se llega al techo.
- **Revisar si:** la calibración no logra quedar en el mismo orden de magnitud que los benchmarks públicos.

### D5 — Stack: núcleo en Rust → WASM, UI y 3D en TypeScript + React Three Fiber [cerrada]

- **Por qué:** el núcleo no se usa fuera del sitio, así que la elección de Rust no es por reuso ni por rendimiento (en TS también correría en microsegundos). Es por: unidades verificadas por el compilador (newtypes `Bytes`, `Flops`, `Seconds`), que es la clase de bug más probable acá; tests nativos del núcleo; y preferencia del autor. La UI va en TS porque el sitio es intensivo en texto (explicaciones, tooltips anidados, tablas, fuentes) y R3F + drei resuelven cámara, etiquetas HTML e instancing.
- **Forma:**
  - Workspace de Cargo: `core` (puro, sin dependencias de WASM) y `wasm` (bindings finos con wasm-bindgen).
  - Frontera gruesa: una llamada `evaluate(hw, model, scenario) -> StepPlan` por cada cambio de perillas. La animación corre en JS sobre ese plan; nada cruza la frontera por frame.
  - Tipos TS generados desde Rust (tsify o ts-rs): una sola fuente de verdad.
  - Datos de hardware y modelos en archivos JSON/TOML, leídos por el núcleo.
- **Revisar si:** el pipeline de build (wasm-pack + Vite) frena la iteración más de lo que aportan las garantías de tipos.

### D6 — Motor de referencia: vLLM [cerrada]

- **Por qué:** es el motor open source más adoptado (junto a SGLang y TensorRT-LLM) y su código es legible. La secuencia de kernels, las fusiones y los backends de atención se derivan de su implementación de Qwen3 en una **versión fijada**.
- **Versión fijada: vLLM v0.31.0** (2026-10-05). Hallazgos en el código de esa versión:
  - **Atención en H100:** backend `FLASH_ATTN` (primero en la prioridad de Hopper; FlashInfer es el segundo) con **FlashAttention 3**.
  - **Compilación:** nivel por defecto `-O2`: torch.compile (Inductor) + CUDA graphs `FULL_AND_PIECEWISE`. Con Inductor, los custom ops quedan en `none` por defecto: RMSNorm, suma residual, SiLU·mul, QK-norm y RoPE se escriben en PyTorch y **Inductor genera kernels Triton fusionados**. La agrupación exacta no está escrita a mano en el código; sale del compilador.
  - **Fusiones con nombre propio:** RoPE + escritura al KV y QK-norm + RoPE + KV existen pero en v0.31.0 solo se activan en ROCm. En CUDA, la escritura al KV es un kernel aparte (`reshape_and_cache_flash`).
  - **Estructura del modelo (`qwen3.py`):** QKV en una sola GEMM, O aparte, gate+up en una sola GEMM, RMSNorm con suma residual fusionada en la API.
- **Revisar si:** cambia el motor dominante en la industria, o la versión fijada queda muy atrás de lo que se usa.

### D7 — Ops lógicas y kernels, en dos capas [cerrada]

- **Por defecto se ven los kernels reales de vLLM.** Debajo hay una capa de ops lógicas (RMSNorm, RoPE, SiLU·mul…) y un mapeo op → kernel definido por un "perfil de fusión".
- **Por qué:** permite mostrar *por qué* existe cada fusión ("estas 2 ops se volvieron 1 kernel y se ahorraron X MB de HBM"), conecta con la descripción del transformer que el usuario ya conoce (Bycroft, papers) y aísla los cambios entre versiones de vLLM en un solo archivo.
- **Revisar si:** la capa de ops confunde más de lo que aclara.

### D8 — Precisión: pesos y KV como perillas separadas [cerrada]

- **Pesos:** BF16 / FP8. FP8 como lo corre vLLM en H100: **W8A8** (confirmado en v0.31.0: GEMMs CUTLASS `scaled_mm` para sm90 con las activaciones cuantizadas a FP8 en tiempo de ejecución). Ojo: el checkpoint oficial `Qwen3-8B-FP8` usa cuantización por bloques de 128, que va por otro camino de kernels que el FP8 por tensor (verificar cuál). W8A16 se muestra como variante explicativa:
  - **W8A16:** pesos en FP8 (mitad de bytes desde HBM), multiplicación en BF16. Gana en decode, no en prefill. En el roofline: el punto se mueve a la derecha.
  - **W8A8:** pesos y activaciones en FP8, multiplicación en FP8. Ahorra bytes **y** duplica el pico de cómputo. En el roofline: el punto se mueve a la derecha y el techo sube.
- **KV cache:** BF16 / FP8. Es la palanca principal en contextos largos.
- **Revisar si:** vLLM cambia su esquema FP8 por defecto en Hopper.

### D9 — Contextos del batch [cerrada]

- **v1:** contexto uniforme (una sola perilla), pero el núcleo representa internamente una **lista de largos por request**.
- **v1.1:** presets de contextos mezclados ("chat típico", "un documento RAG largo + muchos cortos") sin tocar el núcleo.
- **Lección de split-KV / FlashDecoding (obligatoria):** el modelo de tiling la muestra incluso con contexto uniforme. En decode a batch 1, un kernel de atención que paraleliza solo por (request × cabeza) lanza ~32 bloques y deja ocupados ~24 % de los 132 SMs, mientras cada bloque recorre todo el contexto. Split-KV parte el contexto en trozos para llenar la GPU. Con contextos mezclados aparece la segunda mitad del problema: un request largo deja SMs trabajando mientras otros esperan.
- **Por qué:** en roofline puro, un batch mezclado equivale a uno uniforme con la misma suma de contextos. La diferencia solo aparece en el reparto entre SMs.

### D10 — Precisión del dato visible

- Cada número de la UI muestra su nivel de confianza (`documented` / `simplified` / `estimated`) y su fuente. La confianza es **por valor**, no por nodo.

### D11 — Perilla de contexto: logarítmica hasta 128k [cerrada]

- Escala logarítmica de 1 a 131072 tokens. A partir de 32k, una marca: "requiere YaRN; el costo de cómputo y el tamaño del KV son los mismos".
- **Por qué:** a batch 1, la lectura del KV recién supera a la de los pesos cerca de los ~100k tokens en el 8B (~62k en el MoE). Sin pasar 32k no se ve el régimen de contexto largo con un solo usuario.

### D12 — Plataforma e idioma [cerrada]

- **Solo escritorio.** Mouse y teclado. Pantallas chicas muestran un aviso.
- **Sitio en inglés.** Este brief y el glosario de trabajo quedan en español.
- Sitio estático, sin backend.
- **Propiedad intelectual:** toda la geometría 3D es propia. No se reutilizan imágenes de NVIDIA (whitepaper, die shots, renders) ni de las referencias visuales; se usan solo como guía. No se sugiere aval de NVIDIA.

### D13 — Estilo visual [cerrada]

- 3D limpio y estilizado, **basado en la disposición física real del die y del package** (aproximada y marcada `simplified`), con color por función. No fotorrealista. La disposición física enseña: L2 en dos mitades al centro, controladores de memoria en los bordes junto a la HBM.
- **Referencias:** el video "How do Graphics Cards Work? Exploring GPU Architecture" y el artículo de LearnOpenCV "Modern GPU Architecture Explained" (que se basa en ese video). Lo que se toma de ellas: zoom progresivo placa → die → GPC → SM → core; color por función (tensor cores, CUDA cores, L2, controladores de memoria); renders sobre fondo oscuro.
- **Diferencias con las referencias:** ellas usan GA102 (gaming: RT cores, GDDR6X). H100 no tiene RT cores, usa HBM en el mismo package, tiene TMA y tensor cores más grandes. Ninguna de las dos muestra flujo de datos real ni números; eso es lo nuevo.
- **Revisar si:** la abstracción confunde más de lo que aclara.

### D14 — Traza de kernels: perfilado local en una RTX 3070, sin costo [cerrada]

- La agrupación de los kernels elementwise en vLLM v0.31.0 la genera Inductor y no se puede leer del código. Se obtiene perfilando localmente en la GPU del autor (RTX 3070, 8 GB, Ampere sm86), sin alquilar hardware.
- **Cómo entra en 8 GB:** el modelo usa las dimensiones reales de Qwen3-8B pero solo 3 capas (`--hf-overrides '{"num_hidden_layers": 3}'`) y pesos aleatorios (`--load-format dummy`), unos 3.6 GB en BF16. Los pesos no cambian qué kernels corren. Hacen falta al menos 2 capas, porque la capa 0 no fusiona la suma residual: la tercera es una capa "típica".
- **Herramientas, gratis:** el profiler de PyTorch integrado en vLLM (`--profiler-config`, trazas para Perfetto) y, como contraste, el código Triton que genera Inductor (caché de compilación de vLLM o `TORCH_LOGS=output_code`). Nsight Systems es opcional. Se perfila sin CUDA graphs (`cudagraph_mode: NONE`), que no cambian qué kernels corren pero ocultan los kernels individuales en la traza.
- **Qué se toma de la traza:** nombres y orden de los kernels por capa, qué ops fusiona cada uno, y cuántos kernels hay por paso de decode y de prefill.
- **Qué no se toma, porque en Ampere es distinto:** tiempos, tiles de GEMM (cuBLAS elige kernels de sm86), el kernel de atención (FA2 en lugar de FA3) y todo FP8 (Ampere no tiene FP8: vLLM usa Marlin, W8A16). Para H100 eso sigue saliendo del código (D6), de fuentes públicas y del modelo analítico.
- **Supuesto, marcado `simplified`:** la agrupación que decide Inductor no depende de la arquitectura. La configuración de cada kernel Triton puede cambiar, pero qué ops quedan juntas no debería cambiar.
- La traza se guarda en el repo como dato de referencia, con GPU, driver, versiones de vLLM, PyTorch y CUDA, y los comandos usados.
- **Revisar si:** aparece una traza pública de H100 que contradiga la agrupación, o si hay fondos para una corrida corta en H100.

### D15 — Hosting y licencia [cerrada]

- Sitio estático en GitHub Pages o Cloudflare Pages.
- Código: MIT o Apache-2.0, a elección del usuario (licencia dual, convención de Rust). Contenido (textos, glosario, geometría 3D propia): CC BY 4.0.

---

## 4. Experiencia 3D

### 4.1 Niveles

| Nivel | Qué se ve | Qué muestra el núcleo ahí |
|---|---|---|
| Placa (módulo SXM) | Módulo, conectores NVLink, alimentación | — (contexto) |
| Package | Die en el centro, stacks de HBM alrededor sobre el interposer | Ocupación de HBM (pesos / KV / libre), bytes leídos por paso |
| Die | 8 GPCs, L2 en dos mitades, controladores de memoria en los bordes, GigaThread engine | Bytes HBM → L2 por kernel, qué GPCs están activos |
| GPC | TPCs y SMs (incluidos los deshabilitados) | Qué SMs tienen bloques en la onda actual |
| SM | 4 sub-particiones, shared memory / L1, TMA | Tile del kernel actual: qué hay en shared memory y en registros, bytes por bloque |
| Sub-partición | Warp scheduler, register file, tensor core, CUDA cores | Si el kernel usa tensor cores o CUDA cores (texto + resaltado) |

Lo físico (sub-partición, tensor core) y lo lógico (thread, warp, thread block, grid) se distinguen visualmente: los warps son una abstracción de scheduling, no una pieza de silicio.

### 4.2 Navegación [cerrada]

- **v1: niveles discretos con transiciones animadas.** Click en un componente: la cámara vuela hacia él, sus hijos aparecen y los hermanos se desvanecen. Retroceso con migas de pan y teclado. Es lo que hacen las referencias, y da la mayor parte de la sensación de zoom continuo con mucho menos costo.
- **No es requisito: zoom continuo (semantic zoom)**, a evaluar cuando v1 funcione bien, con la rueda del mouse, donde los niveles aparecen según el tamaño en pantalla. Cuesta más: manejo de nivel de detalle para miles de objetos, una escala de ~10⁵ entre placa y tensor core (requiere coordenadas locales por nivel o depth buffer logarítmico), etiquetas que se pisan y desorientación con cámara libre.
- **Diseño para no cerrarse la puerta:** cada nivel vive en su propio sistema de coordenadas local con escala normalizada (no la escala física). Así el zoom continuo se agrega después sin rehacer la escena.

### 4.3 Animación de un paso

- Controles de play / pausa / scrub y velocidad.
- Un paso de decode del 8B son ~36 capas × ~8–10 kernels, todas iguales. Propuesta: una capa se reproduce en detalle y el resto se comprime; la barra de scrub marca las capas.
- **Toggle de escala temporal [cerrada]:**
  - **Modo didáctico (por defecto):** cada kernel dura al menos un tiempo mínimo legible, para poder seguir el flujo y pensar.
  - **Modo tiempo real (proporcional):** la duración es proporcional al tiempo estimado; los kernels chicos casi desaparecen y se ve la escala real (qué domina el paso).
  - Los kernels van de µs a ms, por eso ninguno de los dos modos alcanza solo.
- Las magnitudes de bytes van de KB a GB (5 órdenes). Las partículas y anchos de flujo usan escala logarítmica, con el número exacto siempre visible.

### 4.4 Vistas vinculadas

- **Línea de tiempo de kernels:** la columna vertebral narrativa. Seleccionar un kernel lo resalta en el 3D y en el roofline.
- **Roofline:** cada kernel es un punto; se mueve al cambiar perillas.
- **Barra de HBM:** pesos + KV + libre sobre 80 GB; muestra el batch máximo.

### 4.5 Rendimiento

- 60 fps en escritorio con GPU integrada moderna. Instancing para SMs, unidades y partículas.

---

## 5. Glosario y tooltips

- **Tooltips anidados al estilo Crusader Kings 3:** hover de ~0.5–1 s sobre un término abre su definición corta; dentro de ella, otros términos también tienen tooltip. Pasado un momento (o con click) el tooltip queda fijo y se puede entrar con el mouse.
- **Marcado explícito** en el contenido (p. ej. `[[kv-cache]]`), no detección automática: "kernel" también significa kernel de sistema operativo, y hay plurales y mayúsculas.
- **Glosario como datos:** un registro por término con `id`, nombre, definición corta (tooltip), definición larga (página de glosario), términos relacionados y fuentes. Un test falla si un `[[término]]` no existe.
- **Mismo sistema en el 3D:** hover sobre un componente (L2, SM, tensor core) abre el mismo tooltip.
- Accesible con teclado (foco = hover).

---

## 6. Modelo de datos (borrador)

### 6.1 Cantidades con unidad

```ts
type Quantity = {
  value: number;
  unit: "B" | "KiB" | "MiB" | "GiB" | "GB" | "B/s" | "TB/s" | "FLOP" | "FLOP/s" | "s" | "Hz" | "count";
  confidence: "documented" | "simplified" | "estimated";
  sources?: string[];
};
```

(En el núcleo Rust, estas unidades son newtypes; el tipo TS se genera.)

### 6.2 Árbol de hardware

```ts
type HwNode = {
  id: string;
  name: string;
  level: "board" | "package" | "die" | "gpc" | "tpc" | "sm" | "subpartition" | "unit";
  count?: number;                     // instancias en el padre
  enabled?: number;                   // instancias habilitadas (SMs/TPCs deshabilitados)
  specs: Record<string, Quantity>;
  contentId: string;                  // prosa (does / stores / llmRole) en archivos de contenido aparte
  children?: HwNode[];
};
```

La prosa vive en archivos de contenido separados del modelo numérico, en inglés, con marcado de glosario.

### 6.3 Config de modelo

Un archivo por modelo, derivado directamente de su `config.json` (mismos nombres de campo).

### 6.4 Escenario

```ts
type Scenario = {
  phase: "prefill" | "decode";
  contexts: number[];                 // largo por request; v1 = todos iguales
  newTokens: number;                  // decode: 1; prefill: largo del prompt
  weights: "bf16" | "fp8_w8a8" | "fp8_w8a16";
  kv: "bf16" | "fp8";
  timeMode: "lower_bound" | "realistic";
};
```

### 6.5 Ops lógicas y kernels por capa (Qwen3)

Batch `B`, tokens nuevos por request `T`, contexto `S`, `M = B·T`.

Ops lógicas:

1. RMSNorm de entrada
2. Proyección QKV (GEMM): `h × (n_q + 2·n_kv)·d`
3. QK-norm (RMSNorm por cabeza sobre Q y K)
4. RoPE
5. Escritura al KV cache
6. Atención: lee K y V de `S` tokens
7. Proyección de salida O (GEMM): `n_q·d × h`
8. Suma residual
9. RMSNorm post-atención
10. MLP:
    - **Denso:** GEMM gate+up `h × 2I`, SiLU·mul, GEMM down `I × h`
    - **MoE:** router GEMM `h × E`, softmax + top-k (con renormalización), permutación de tokens por experto, GEMM agrupado gate+up, SiLU·mul, GEMM agrupado down, des-permutación y suma ponderada
11. Suma residual

Fuera del loop: lookup de embeddings, RMSNorm final, LM head (GEMM `h × V`), sampling.

Kernels: el perfil de fusión de vLLM v0.31.0 en H100 agrupa estas ops (ver D6). Lo que se sabe del código:

- GEMMs: QKV (1), O (1), gate+up (1), down (1) por capa. BF16 → cuBLAS vía PyTorch; FP8 → CUTLASS.
- Atención: FlashAttention 3; la escritura al KV es un kernel aparte.
- Elementwise: kernels Triton generados por Inductor. Agrupación medida en la traza de D14 (`data/traces/vllm-0.31.0_qwen3-8b-3layers_rtx3070/`):
  1. suma residual de la capa anterior + RMSNorm de entrada (en la capa 0: lookup de embeddings + RMSNorm)
  2. GEMM QKV
  3. QK-norm + RoPE (un kernel)
  4. escritura al KV (`reshape_and_cache_flash`)
  5. atención con split-KV (+ kernel `combine` en decode; en decode también dos `copy_` de reordenamiento alrededor)
  6. GEMM O
  7. suma residual + RMSNorm post-atención
  8. GEMM gate+up (en decode, cuBLAS usa split-K + kernel de reducción)
  9. SiLU·mul
  10. GEMM down
- **El límite entre kernels no coincide con el límite entre capas:** la suma residual del final de una capa se fusiona con la RMSNorm de entrada de la siguiente. La UI lo muestra así.
- Fuera del forward: RMSNorm final (fusionada con la última suma residual), gather del último token, LM head, sampling. Al inicio de cada paso, ~8 kernels chicos de preparación de inputs.
- Decode corre con CUDA graphs: el overhead de lanzamiento por kernel es bajo pero no cero.

### 6.6 Salida del núcleo

```ts
type StepPlan = {
  kernels: Array<{
    id: string;
    name: string;                     // nombre como en vLLM
    ops: string[];                    // ops lógicas que fusiona
    layer: number | null;
    flops: Quantity;
    bytes: { hbmRead: Quantity; hbmWrite: Quantity };
    intensity: number;
    bound: "memory" | "compute";
    time: { lowerBound: Quantity; realistic: Quantity };
    grid: { blocks: number; tile?: [number, number]; waves: number; waveEfficiency: number;
            smemPerBlock?: Quantity; regsPerBlock?: Quantity; splits?: number };
  }>;
  memory: { weights: Quantity; kv: Quantity; free: Quantity; maxBatch: number };
  totals: { time: { lowerBound: Quantity; realistic: Quantity }; tokensPerSecond: number };
};
```

---

## 7. Fórmulas

### 7.1 Roofline

- GEMM: `FLOPs = 2·M·N·K`; bytes ≈ pesos `N·K·bytes_w` + activaciones de entrada y salida.
- Atención por capa: `FLOPs ≈ 4·B·T·n_q·d·S_ef`; bytes ≈ lectura del KV `B·S·2·n_kv·d·bytes_kv` + Q y salida.
  - Decode: `S_ef = S`.
  - Prefill con máscara causal: `S_ef ≈ prefijo + T/2` (usar `S` completo sobreestima ~2×).
- Elementwise (norms, RoPE, activaciones): FLOPs bajos, bytes = leer + escribir el tensor. Las fusiones eliminan lecturas/escrituras intermedias.
- Intensidad aritmética = `FLOPs / bytes`. Se compara con el ridge point.
- Cota inferior = `max(FLOPs / pico, bytes / ancho_de_banda)`.
- Realista = `max(FLOPs / (η_c · pico), bytes / (η_m · ancho_de_banda)) + t_overhead`, con `η` y `t_overhead` calibrados contra benchmarks públicos (`estimated`).
  - **Calibración en dos capas:** primero microbenchmarks de hardware (más robustos), después benchmarks de punta a punta como chequeo de orden de magnitud.
  - Puntos de partida: `η_m` ≈ 0.93 (STREAM triad en H100: ~3.12 TB/s de 3.35, Kempner Institute). `η_c` depende de la forma: GEMMs grandes y cuadradas llegan a ~70–93 % del pico en cuBLAS; formas típicas de LLM, ~500–560 TFLOPS (~50–57 %). Fuentes heterogéneas en reloj, dtype y versión: tratar como rango, no como valor.
- KV cache por token = `2 · capas · n_kv · d · bytes_kv`.

### 7.2 Tiling y ondas

- GEMM: `bloques = ⌈M/BM⌉ · ⌈N/BN⌉ · split_k`.
  - **FP8 (CUTLASS):** los tiles son públicos. `scaled_mm_sm90_fp8_dispatch.cuh` elige la configuración según M, N y K; p. ej. `128×128×128` por defecto, `64×128×128` para M ≤ 128, `64×16×256` para M chicos con N chico, `256×128×128` para M y K grandes. `documented` para la versión fijada.
  - **BF16 (cuBLAS):** los tiles los elige la heurística cerrada de cuBLAS; no hay fuente pública. Usar tiles representativos de Hopper (p. ej. los de CUTLASS) y marcar `simplified`.
- Atención de decode: `bloques = B · cabezas · splits`. FA3 paraleliza por request y cabeza KV (agrupando las Q de GQA) y elige `splits` (split-KV) con una heurística propia: leer la heurística de FA3 en la versión que trae vLLM v0.31.0.
- `ondas = ⌈bloques / (SMs · bloques_por_SM)⌉`; `eficiencia_de_onda = bloques / (ondas · SMs · bloques_por_SM)`.
- `bloques_por_SM` según shared memory, registros y threads por bloque contra los límites del SM.

### 7.3 MoE

- Expertos únicos tocados por capa con ruteo uniforme: `E · (1 − (1 − k/E)^M)`. Con `E = 128`, `k = 8`: 8 a M = 1, ~82 a M = 16, ~126 a M = 64. La ventaja de ancho de banda del MoE se diluye al crecer el batch. El ruteo real no es uniforme → `simplified`.

---

## 8. Validación

Tests de cordura obligatorios en el núcleo:

| Chequeo | Valor esperado |
|---|---|
| Parámetros Qwen3-8B (desde el config) | ~8.19 B (6.95 B sin embeddings) |
| Parámetros totales Qwen3-30B-A3B | ~30.5 B |
| Parámetros activos Qwen3-30B-A3B | ~3.35 B |
| KV cache por token, Qwen3-8B, BF16 | 147 456 bytes (144 KiB) |
| KV cache por token, Qwen3-30B-A3B, BF16 | 98 304 bytes (96 KiB) |
| Formas del MoE | QKV 2048 → 5120; O 4096 → 2048 |
| Bytes de pesos leídos en decode, 8B, BF16 | ~15.1 GB (no se lee la tabla de embeddings, solo una fila) |
| Techo de decode 8B, batch 1, BF16, contexto corto | ~221 tok/s (15.1 GB / 3.35 TB/s) |
| Techo de decode 30B-A3B, batch 1, BF16, contexto corto | ~550 tok/s (~6.1 GB) |
| Intensidad de la atención en decode | `n_q / n_kv` = 4 (8B) y 8 (30B-A3B), **independiente del batch** |
| Intensidad de GEMMs de decode, BF16 | ≈ M; cruza el ridge cerca de M ≈ 295 |
| Contexto donde el KV iguala a los pesos, batch 1, BF16 | ~102k (8B), ~62k (30B-A3B) |
| KV de un request de 32k, 8B, BF16 | 4.5 GiB |
| Pico BF16 derivado | SMs × FLOPs/clk/SM × reloj ≈ 989 TFLOPS |
| Atención de decode sin split-KV, batch 1 | ~32 bloques → ~24 % de SMs ocupados (`simplified`) |
| Expertos únicos (ruteo uniforme) | 8 / ~82 / ~126 a M = 1 / 16 / 64 |

Además:

- Cruzar los techos con benchmarks públicos de vLLM en H100: los reales deben quedar por debajo de la cota inferior y cerca del modo realista.
  - Dato disponible: issue vllm#25915 (H100, `vllm bench throughput`, entrada 1024 / salida 2048): Qwen3-8B BF16 ~4.5–5.4k tok/s de salida y FP8 casi igual (v0.8.5 y v0.10.2). Útil como caso: a batch alto, FP8 de pesos casi no ayuda.
  - No se encontró un número público confiable de decode a batch 1 de Qwen3-8B con vLLM en H100. Candidato a revisar: SemiAnalysis InferenceX.
- Cruzar resultados por capa con LLM-Viewer.
- Cada número de la UI muestra confianza y fuente.

---

## 9. Alcance de v1

- H100 SXM + Qwen3-8B, un paso de inferencia.
- Decode (foco) y prefill (toggle).
- Perillas: batch, contexto (log hasta 128k), pesos (BF16 / FP8), KV (BF16 / FP8), modo de tiempo.
- 3D: placa → package → die → GPC → SM → sub-partición, navegación por niveles discretos con transiciones animadas, animación play / pausa / scrub de un paso, mapeo de tiles y ondas a SMs, lección de split-KV.
- Vistas vinculadas: línea de tiempo, roofline, barra de HBM.
- Glosario con tooltips anidados.

**Orden de trabajo:** núcleo y prototipo 3D en paralelo desde el inicio. El primer hito del 3D es navegar dos niveles y animar un kernel recorriendo HBM → L2 → SM → tensor core con datos reales del núcleo.

## 10. Roadmap

- **v1:** ver §9.
- **v1.1:** presets de contextos mezclados; H200 como segundo hardware.
- **Post-v1, a evaluar:** zoom continuo.
- **v2:** Qwen3-30B-A3B. Ruteo de expertos, GEMMs agrupados, efecto del batch sobre expertos tocados, comparación lado a lado con el denso.
- **v3:** multi-GPU (tensor parallelism sobre NVLink) y un MoE grande.
- **v4:** otros tipos de modelo (difusión, encoders) y comparación con inferencia en CPU.

## 11. Fuera de alcance de v1

Entrenamiento, simulación por ciclos, múltiples GPUs, cuantización por debajo de FP8, speculative decoding, scheduling entre requests (continuous batching se explica, no se simula), soporte móvil.

## 12. Preguntas abiertas

- **Checkpoint FP8:** ¿por qué camino de kernels va el FP8 por bloques de `Qwen3-8B-FP8` en v0.31.0 (CUTLASS blockwise, DeepGEMM, Triton)? Define los tiles en FP8.
- **Split-KV de FA3:** leer la heurística de `num_splits` en la versión de FA3 que trae vLLM v0.31.0.
- **Benchmark de batch 1:** falta un número público de decode a batch 1 de Qwen3-8B en H100 con vLLM. Revisar SemiAnalysis InferenceX.
- **Disposición física:** no hay floorplan público detallado de GH100 (el de TechInsights es pago). Plan: topología del diagrama de bloques del whitepaper (8 GPCs, L2, controladores) + L2 en dos particiones (Chips and Cheese) + package con el die al centro y 6 sitios de HBM (5 activos en la versión de 80 GB; verificar) a partir de fotos públicas del módulo. Todo `simplified`.

## Fuentes de partida

- NVIDIA H100 Tensor Core GPU Architecture whitepaper (Hopper)
- CUDA C++ Programming Guide
- Luo et al., "Benchmarking and Dissecting the Nvidia Hopper GPU Architecture" (2024): latencias y anchos de banda medidos
- `config.json` oficiales: Qwen/Qwen3-8B y Qwen/Qwen3-30B-A3B en Hugging Face
- Código de vLLM v0.31.0: `vllm/model_executor/models/qwen3.py`, `vllm/config/vllm.py` (niveles de optimización), `vllm/platforms/cuda.py` (prioridad de backends), `vllm/v1/attention/backends/fa_utils.py` (versión de FA), `csrc/libtorch_stable/quantization/w8a8/cutlass/c3x/scaled_mm_sm90_fp8_dispatch.cuh` (tiles FP8)
- Calibración: Kempner Institute `nvidia-hpc-benchmarks` (STREAM en H100); NVIDIA, "New cuBLAS 12.0 Features and Matrix Multiplication Performance on NVIDIA Hopper GPUs"; issue vllm-project/vllm#25915
- Chips and Cheese, artículos sobre H100 (L2 en dos particiones)
- LLM-Viewer (roofline por capa), "Transformer Inference Arithmetic" (kipply)
- Referencias visuales: "How do Graphics Cards Work? Exploring GPU Architecture" (YouTube, h9Z4oGN89MU); LearnOpenCV, "Modern GPU Architecture Explained"
- Inspiración: LLM Visualization (Brendan Bycroft), LLM Inference Handbook (BentoML), Crusader Kings 3 (tooltips anidados)
