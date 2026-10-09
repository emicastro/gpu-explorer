# Requisitos — GPU Inference Explorer v1

Status: accepted
Date: 2026-10-09

Fuente de verdad del **qué** y el **por qué** de v1. El detalle de las decisiones (D1–D15), las fórmulas y la investigación está en [`brief.md`](brief.md); este documento lo cita y no lo repite. El **cómo** está en [`design.md`](design.md). Vocabulario: [`GLOSSARY.md`](GLOSSARY.md).

## 1. Problema

Quien quiere entrar a inference engineering sabe cómo funciona un transformer, pero no qué pasa en el silicio cuando corre: qué kernels se lanzan, en qué SMs, cuántos bytes salen de HBM y por qué decode es memory-bound. Hay visualizaciones del modelo sin hardware, explicaciones de hardware de gaming y calculadoras 2D de roofline. Ninguna conecta token → capa → kernel → SM → bytes de HBM en una sola vista navegable (brief §1).

## 2. Objetivos

- **G1.** Que el usuario navegue una H100 SXM en 3D, del package a la sub-partición, y entienda qué hace y qué guarda cada componente.
- **G2.** Que vea un paso de inferencia de Qwen3-8B en vLLM v0.31.0 como animación: qué kernels corren, en qué SMs, y cuántos bytes y FLOPs mueve cada uno.
- **G3.** Que mueva perillas (batch, contexto, precisión de pesos y de KV, fase, modo de tiempo) y vea cómo cambian los cuellos de botella.
- **G4.** Que todo número visible sea verdadero o diga cuánto se le puede creer: nivel de confianza y fuente.

## 3. Usuarios y plataforma

- Ingenieros con base de ML que quieren entender inferencia sobre hardware.
- Escritorio con mouse y teclado; GPU integrada moderna como piso.
- Sitio estático en inglés, sin backend (brief D12).

## 4. No-objetivos de v1

Son límites que sostienen el plan: agregar cualquiera de ellos requiere un ADR nuevo, no una edición silenciosa.

- Qwen3-30B-A3B y todo MoE (v2). H200 y otros GPUs (v1.1+).
- Contextos mezclados dentro del batch: v1.1. El núcleo ya acepta una lista de largos por request, pero la UI expone uno solo.
- Zoom continuo / semantic zoom (post-v1, a evaluar).
- Simulación por ciclos, ocupación fina, solapamiento de kernels (brief D3).
- Entrenamiento, multi-GPU, cuantización por debajo de FP8, speculative decoding, simulación de scheduling entre requests (brief §11).
- Móvil y pantallas chicas: solo un aviso.
- Hardware definido por el usuario: los presets son fijos (ADR 0002).
- El nivel "placa" del brief §4.1 entra solo como contexto estático, sin datos del núcleo.

## 5. Requisitos y criterios de aceptación

Cada requisito tiene un criterio de aceptación verificable. La columna "Diseño" apunta a la sección de `design.md` que lo implementa.

### Núcleo (los números)

| Id | Requisito | Aceptación | Diseño |
|---|---|---|---|
| R1 | El núcleo calcula, para H100 SXM + Qwen3-8B + un escenario, la secuencia de kernels de un paso con FLOPs, bytes leídos y escritos, intensidad, si es memory- o compute-bound, y su tiempo (cota inferior y realista). | Pasan los tests de cordura del brief §8 que caen en el alcance de v1: parámetros, KV por token, bytes de pesos, techo de 221 tok/s, intensidades, cruce del ridge, contexto donde el KV iguala a los pesos, KV de 32k, pico BF16 derivado. | §3, §4 |
| R2 | La secuencia de kernels es la de vLLM v0.31.0 en H100 (brief D6, §6.5), para decode y prefill, con pesos BF16, FP8 por bloques (por defecto en FP8), FP8 por tensor y W8A16, y KV BF16/FP8. | Un test por combinación compara la lista de nombres de kernels por capa con la esperada, p. ej. decode BF16 = 11 kernels por capa y decode FP8 por bloques = 15. | §4.1 |
| R3 | El núcleo modela tiles y ondas: bloques por kernel, ondas, eficiencia de onda y splits, con las heurísticas documentadas de FA3, FlashInfer swapAB, DeepGEMM y CUTLASS (brief §7.2). | Los tests reproducen la tabla de splits de FA3 del brief §7.2 y los tiles FP8 por bloques a batch 1 (QKV 48, O 32, gate+up 192, down 32). | §4.3 |
| R4 | El modo realista queda calibrado contra el ancla pública de batch 1. | Decode 8B BF16, batch 1, ~350 tokens de contexto (el promedio del benchmark): tiempo realista del paso dentro de ±15 % de 7.28 ms; la cota inferior queda por debajo. | §4.4 |
| R5 | El núcleo calcula la ocupación de HBM: pesos, KV, libre y batch máximo. | Test: KV de un request de 32k en BF16 = 4.5 GiB; el batch máximo es consistente con 80 GB menos los pesos. | §4.5 |
| R6 | Cada número que sale del núcleo lleva confianza (`documented` / `simplified` / `estimated`) y fuentes. | El tipo `Quantity` exige `confidence`. Un test recorre un `StepPlan` y falla si algún valor `documented` no tiene fuente. | §3.1 |

### Experiencia 3D

| Id | Requisito | Aceptación | Diseño |
|---|---|---|---|
| R7 | Navegación por niveles discretos package → die → GPC → SM → sub-partición, con transiciones animadas, migas de pan y retroceso con teclado (brief §4.2). | Un e2e entra hasta la sub-partición por click, vuelve con Escape y verifica las migas en cada paso. | §6.2 |
| R8 | La disposición sigue la física aproximada (`simplified`): package con 6 sitios de HBM (5 activos); die con 8 GPCs, L2 en dos mitades y 10 controladores en los bordes; SMs deshabilitados visibles (brief D13). | Tests del generador de layout: cantidades de cada pieza iguales a las del árbol de hardware. | §6.3 |
| R9 | Cada componente muestra qué hace, qué guarda y qué está haciendo el LLM ahí. | Test de contenido: todo nodo del árbol de hardware tiene su entrada de prosa. Un e2e abre el panel de un SM. | §6.4, §7 |
| R10 | Reproducción de un paso: play, pausa, scrub y velocidad; modo didáctico (duración mínima legible) y modo tiempo real (proporcional); una capa en detalle y el resto comprimido. | Tests del constructor de línea de tiempo: en modo didáctico ningún kernel dura menos que el mínimo; en tiempo real las duraciones son proporcionales; el scrub marca las capas. | §6.5 |
| R11 | En cada kernel, el 3D muestra qué SMs tienen bloques en la onda actual, incluida la lección de split-KV, y el flujo de bytes HBM → L2 → SM → tensor core con escala logarítmica y número exacto visible. | Test de la función de mapeo: SMs ocupados = bloques de la onda (acotado por SMs). Un e2e verifica que la animación de un kernel de atención a batch 1 muestra la cantidad de SMs ocupados que da el núcleo. | §6.6 |
| R12 | Rendimiento: 60 fps en GPU integrada moderna. | Chequeo automático de presupuesto: draw calls por frame ≤ 200 en todos los niveles (instancing). Medición manual de fps registrada en `docs/perf.md`. | §6.7 |

### Vistas 2D, perillas y glosario

| Id | Requisito | Aceptación | Diseño |
|---|---|---|---|
| R13 | Perillas: batch, contexto (escala logarítmica de 1 a 131072, con marca de YaRN desde 32k), pesos (BF16 / FP8 por bloques / FP8 por tensor / W8A16), KV (BF16 / FP8), fase (decode / prefill) y modo de tiempo. Cambiar una re-evalúa y actualiza todas las vistas. | Test del store: cambiar cada perilla produce un plan nuevo. Un e2e mueve el contexto y verifica que cambia la barra de HBM. | §5, §6.8 |
| R14 | Vistas vinculadas: línea de tiempo de kernels, roofline (un punto por kernel) y barra de HBM; seleccionar en una resalta en las otras y en el 3D. | Test del store de selección; e2e: click en un kernel de la línea de tiempo → resaltado en el roofline. | §6.8 |
| R15 | Glosario con tooltips anidados estilo CK3: hover de ~0.5–1 s, fijado con click o por tiempo, marcado explícito `[[término]]`, el mismo sistema en el 3D y accesible con teclado. | Un test falla con un `[[término]]` inexistente. Un e2e abre un tooltip, dentro de él uno anidado, y lo hace también con el teclado. | §7 |
| R16 | Cada número en la UI muestra su confianza y, al pedirlo, sus fuentes. | El componente que muestra cantidades exige `Quantity` (no `number`); test de render del indicador de confianza. | §6.9 |

### Producto

| Id | Requisito | Aceptación | Diseño |
|---|---|---|---|
| R17 | Sitio estático en inglés; pantallas de menos de 1024 px de ancho muestran un aviso. | `pnpm build` produce `web/dist` sin servidor. Un e2e a 800 px ve el aviso. | §8 |
| R18 | Licencias: código MIT OR Apache-2.0; contenido (textos, glosario, geometría) CC BY 4.0. | Existen `LICENSE-MIT`, `LICENSE-APACHE` y `LICENSE-CONTENT`; los `Cargo.toml` y `package.json` declaran `MIT OR Apache-2.0`. | §8 |
| R19 | Propiedad intelectual: geometría propia, sin imágenes de NVIDIA ni de las referencias, sin sugerir aval de NVIDIA (brief D12). | Ítem de la checklist de review. La geometría es procedural: el repo no tiene modelos 3D ni imágenes de terceros. | §6.3 |
| R20 | Publicado en un host estático (ADR 0007). | El workflow de deploy corre el verify completo y publica `web/dist`. | §8 |
