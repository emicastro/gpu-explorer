# GPU Inference Explorer — Brief del proyecto

> **Estado: borrador. Todas las decisiones de este documento están abiertas a revisión.**
> Cada decisión incluye el motivo y una condición de "Revisar si…". Si durante el desarrollo aparece evidencia en contra, se cambia la decisión y se actualiza este archivo. Ningún número de hardware o de modelo se da por bueno sin un test o una fuente que lo respalde.

---

## 1. Qué es

Un sitio web con visualizaciones 3D interactivas que muestran cómo interactúan el hardware de una GPU y el software de inferencia de un LLM. El usuario puede:

- Navegar la GPU por niveles (placa → die → GPC → SM → sub-partición → tensor core), hacer zoom y clickear componentes.
- Ver en cada componente **qué hace**, **qué guarda** y **qué está haciendo el LLM ahí**.
- Seguir el flujo de datos y operaciones de un paso de inferencia: qué kernels corren, en qué unidades, cuántos bytes se mueven y cuántos FLOPs se hacen.
- Mover perillas (batch, contexto, precisión, prefill/decode) y ver cómo cambian los cuellos de botella.

**Audiencia:** ingenieros que quieren entrar a inference engineering y necesitan conectar "cómo funciona un transformer" con "qué pasa en el silicio".

**Hueco que cubre:** hoy existen visualizaciones del modelo sin hardware (p. ej. LLM Visualization de Bycroft), explicaciones del hardware orientadas a gráficos/gaming, y herramientas 2D sueltas de inferencia. Ninguna conecta token → capa → kernel → SM → bytes de HBM en una sola vista.

## 2. Principio central

**El modelo de datos es el producto; el 3D es una vista.**

El núcleo es un módulo de cálculo puro (sin UI) que, dado un hardware, un modelo y un escenario, produce la secuencia de kernels con sus FLOPs, bytes, intensidad aritmética y tiempo estimado. El 3D consume esa salida. Si el núcleo está bien, cualquier vista (3D, 2D, tablas) es reemplazable.

---

## 3. Decisiones (todas abiertas a revisión)

### D1 — Hardware: NVIDIA H100 SXM

- **Por qué:** es común en la industria, bien documentada (whitepaper de Hopper) y tiene features relevantes para inferencia moderna (FP8, TMA, shared memory grande).
- **Revisar si:** el público objetivo usa mayoritariamente otra GPU (H200, B200, MI300X), o si Blackwell se vuelve el estándar de referencia en inferencia.

Números de partida (**verificar todos contra el whitepaper antes de usarlos**):

| Parámetro | Valor |
|---|---|
| SMs | 132 (8 GPCs) |
| HBM3 | 80 GB, ~3.35 TB/s |
| L2 | 50 MB |
| Shared memory / L1 por SM | hasta 228 KB de shared memory |
| Register file por SM | 256 KB (64 KB por sub-partición) |
| Tensor cores | 4 por SM (1 por sub-partición) |
| BF16 denso | ~989 TFLOPS |
| FP8 denso | ~1979 TFLOPS |
| NVLink | 900 GB/s |
| Ridge point BF16 (FLOPs / BW) | ~295 FLOP/byte |

### D2 — Modelos: Qwen3-8B (denso) y Qwen3-30B-A3B (MoE)

- **Por qué:** misma familia y generación, así que comparten tokenizer y tipos de operación (RMSNorm, QK-norm, RoPE, GQA, SwiGLU). La comparación muestra qué cambia al pasar de denso a MoE. Ambos usan atención GQA estándar en todas las capas (sin ventana deslizante ni atención lineal), y ambos entran en una sola H100 en BF16.
- **Revisar si:** el MoE chico deja de ser representativo de lo que se sirve en producción, o si conviene una generación más nueva (verificar que mantenga atención estándar, porque arquitecturas híbridas con atención lineal cambian por completo el modelo del KV cache).

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

Nota: no solo cambia el MLP. El MoE es más angosto (2048), más profundo (48 capas) y tiene la mitad de cabezas KV. La comparación se hace por tipos de kernel y movimiento de bytes, no por formas de matrices.

### D3 — Modelo analítico, no simulación por ciclos

- **Por qué:** el objetivo es enseñar intuiciones correctas (memory-bound vs compute-bound, efecto del batch, peso del KV cache). Un modelo roofline por kernel alcanza para eso y es verificable. Simular ciclos es caro y frágil.
- **Revisar si:** algún fenómeno clave para el aprendizaje no se puede explicar sin modelar ocupación, latencia o solapamiento de kernels.

### D4 — Alcance del MVP

- Una H100, un modelo a la vez, un paso de inferencia.
- Escenarios: **decode** (foco principal) y **prefill** (toggle).
- Perillas: batch size, largo de contexto, precisión (BF16 / FP8 de pesos).
- Versión 1 con Qwen3-8B. Versión 2 agrega Qwen3-30B-A3B.
- **Revisar si:** el MVP queda chico para transmitir la idea (agregar algo) o demasiado grande para terminar (recortar perillas antes que niveles de hardware).

### D5 — Stack técnico

- **Propuesta:** TypeScript + React + React Three Fiber (Three.js). El módulo de cálculo en TypeScript puro, compartiendo tipos con la UI, con tests (Vitest).
- **Alternativa a considerar:** núcleo de cálculo en Rust compilado a WASM, con la UI en TS. Más trabajo de integración, a cambio de un núcleo reutilizable fuera del sitio (CLI, otros front-ends).
- **Revisar si:** el rendimiento del render o del cálculo se vuelve problema, o si el núcleo necesita usarse fuera del navegador.

### D6 — Estilo visual

- Geometría estilizada (bloques, capas, partículas de datos), no modelado fotorrealista.
- **Revisar si:** la abstracción confunde más de lo que aclara en pruebas con usuarios.

---

## 4. Modelo de datos (borrador)

### 4.1 Árbol de hardware

Cada nodo:

```ts
type HwNode = {
  id: string;
  name: string;
  level: "board" | "die" | "gpc" | "sm" | "subpartition" | "unit";
  count?: number;            // cuántas instancias hay en el padre
  specs: Record<string, number | string>;   // capacidad, ancho de banda, throughput
  does: string;              // qué hace
  stores: string;            // qué guarda
  llmRole: string;           // qué hace el LLM acá
  confidence: "documented" | "simplified" | "estimated";
  sources?: string[];
  children?: HwNode[];
};
```

Niveles iniciales: placa (HBM, die, NVLink, PCIe/host) → die (GPCs, L2, controladores de memoria, GigaThread engine) → SM (4 sub-particiones, shared memory/L1, TMA) → sub-partición (warp scheduler, register file, tensor core, CUDA cores).

Importante: los **warps son una abstracción de scheduling**, no unidades físicas. La UI debe dejar clara la diferencia entre lo físico (sub-partición, tensor core) y lo lógico (thread, warp, thread block, grid).

### 4.2 Config de modelo

Un archivo por modelo, derivado directamente de su `config.json` (mismos nombres de campo), más la precisión elegida.

### 4.3 Secuencia de kernels por capa (Qwen3)

Escenario: batch `B`, tokens nuevos por request `T` (decode: `T = 1`; prefill: `T = largo del prompt`), contexto `S`. `M = B·T`.

1. RMSNorm de entrada
2. Proyección QKV (GEMM): `h × (n_q + 2·n_kv)·d`
3. QK-norm (RMSNorm por cabeza sobre Q y K)
4. RoPE
5. Escritura al KV cache
6. Atención (FlashAttention en prefill, kernel de decode paginado en decode): lee K y V de `S` tokens
7. Proyección de salida O (GEMM): `n_q·d × h`
8. Suma residual
9. RMSNorm post-atención
10. Bloque MLP:
    - **Denso:** GEMM gate+up `h × 2I`, SiLU·mul, GEMM down `I × h`
    - **MoE:** router GEMM `h × E`, softmax + top-k (con renormalización), permutación de tokens por experto, GEMM agrupado gate+up, SiLU·mul, GEMM agrupado down, des-permutación y suma ponderada
11. Suma residual

Fuera del loop de capas: lookup de embeddings, RMSNorm final, LM head (GEMM `h × V`), sampling.

### 4.4 Fórmulas (roofline)

- GEMM: `FLOPs = 2·M·N·K`; bytes ≈ pesos `N·K·bytes_w` + activaciones de entrada y salida.
- Atención por capa: `FLOPs ≈ 4·M·n_q·d·S`; bytes ≈ lectura del KV `B·S·2·n_kv·d·bytes_kv` + Q y salida.
- Elementwise (norms, RoPE, activaciones): FLOPs bajos, bytes = leer + escribir el tensor.
- Intensidad aritmética = `FLOPs / bytes`. Comparar con el ridge point de la GPU.
- Tiempo estimado por kernel (cota inferior) = `max(FLOPs / pico, bytes / ancho_de_banda)`.
- KV cache por token = `2 · capas · n_kv · d · bytes_kv`.
- **MoE, expertos únicos tocados por capa** con ruteo uniforme: `E · (1 − (1 − k/E)^M)`. Con `E = 128`, `k = 8`: 8 expertos a M = 1, ~82 a M = 16, ~126 a M = 64. Esto muestra cómo la ventaja de ancho de banda del MoE se diluye al crecer el batch. El ruteo real no es uniforme; marcarlo como `simplified`.

---

## 5. Validación

Tests de cordura obligatorios en el módulo de cálculo:

| Chequeo | Valor esperado |
|---|---|
| Parámetros Qwen3-8B (desde el config) | ~8.2 B |
| Parámetros totales Qwen3-30B-A3B | ~30.5 B |
| Parámetros activos Qwen3-30B-A3B | ~3.3 B |
| KV cache por token, Qwen3-8B, BF16 | 147 456 bytes (144 KiB) |
| KV cache por token, Qwen3-30B-A3B, BF16 | 98 304 bytes (96 KiB) |
| Techo de decode Qwen3-8B, batch 1, BF16 en H100 | ~200 tokens/s (≈16.4 GB / 3.35 TB/s) |

Además:

- Cruzar los techos estimados con benchmarks públicos (vLLM, SGLang). Se espera que los reales estén por debajo del techo, en el mismo orden de magnitud.
- Si es posible, contrastar con un perfil real (Nsight Systems / Nsight Compute) de una H100 alquilada.
- Cada dato de la UI muestra su nivel de confianza (`documented` / `simplified` / `estimated`) y, si existe, la fuente.

---

## 6. Roadmap (abierto a revisión)

- **v1:** H100 + Qwen3-8B. Árbol de hardware navegable, secuencia de kernels de un paso de decode, perillas de batch / contexto / precisión, roofline por kernel.
- **v2:** Qwen3-30B-A3B. Ruteo de expertos, GEMMs agrupados, efecto del batch sobre expertos tocados, comparación lado a lado con el denso.
- **v3:** multi-GPU (tensor parallelism sobre NVLink) y un MoE grande.
- **v4:** otros tipos de modelo (difusión, encoders, etc.) y comparación con inferencia en CPU.

## 7. Fuera de alcance del MVP

Entrenamiento, simulación por ciclos, múltiples GPUs, cuantización por debajo de FP8, speculative decoding, scheduling entre requests (continuous batching se explica, no se simula).

## 8. Preguntas abiertas

- ¿Stack en TS puro o núcleo en Rust/WASM?
- ¿Cuánto detalle del KV cache paginado mostrar en v1?
- ¿La vista principal es el árbol de hardware o la línea de tiempo de kernels?
- ¿Qué fuentes públicas alcanzan para justificar cada número del árbol de hardware?
- ¿Prefill entra en v1 o se deja para v1.1?

## Fuentes de partida

- NVIDIA H100 Tensor Core GPU Architecture whitepaper (Hopper)
- CUDA C++ Programming Guide
- `config.json` oficiales: Qwen/Qwen3-8B y Qwen/Qwen3-30B-A3B en Hugging Face
- Inspiración: "Inside the GPU" (LearnOpenCV), LLM Visualization (Brendan Bycroft), LLM Inference Handbook (BentoML)
