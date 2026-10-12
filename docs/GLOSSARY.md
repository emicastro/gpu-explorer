# Glossary

Lenguaje común del repo. Preferir estos términos en el chat y en los docs.
(El glosario que verá el usuario del sitio irá en inglés, como datos; este es de trabajo.)

## Proyecto

**Núcleo (core)**:
El módulo de cálculo puro, sin UI: recibe hardware + modelo + escenario y devuelve la lista de kernels con FLOPs, bytes, tiempo y mapeo a SMs. El 3D y las vistas 2D solo lo consumen.
_Avoid_: "backend", "engine" (engine es vLLM)

**Cota inferior (lower bound)**:
El tiempo mínimo físicamente posible de un kernel: `max(FLOPs / pico, bytes / ancho de banda)`, suponiendo 100 % de eficiencia y cero overhead. Lo real siempre es mayor.
_Avoid_: "tiempo real", "tiempo estimado" a secas

**Tiempo realista**:
Cota inferior ajustada con factores de eficiencia y overhead por kernel, calibrados contra benchmarks públicos. Siempre marcado `estimated`.

## Inferencia

**Prefill**:
Fase que procesa todo el prompt de una vez y llena el KV cache. Muchos tokens por paso, suele ser compute-bound.

**Decode**:
Fase que genera un token por request por paso. Lee todos los pesos para producir pocos tokens; suele ser memory-bound.

**KV cache**:
Keys y values de atención de los tokens previos, guardados en HBM para no recalcularlos. Crece con capas × cabezas KV × largo de contexto × batch.

**GQA (grouped-query attention)**:
Varias cabezas de query comparten una misma cabeza de key/value (Qwen3-8B: 32 Q / 8 KV). Achica el KV cache por el factor de agrupamiento.

**MoE (mixture of experts)**:
El MLP se reemplaza por E expertos y un router que elige top-k por token (Qwen3-30B-A3B: 128 expertos, 8 activos). Muchos parámetros totales, pocos activos.

**W8A8 / W8A16**:
W = bits de los pesos, A = bits de las activaciones. W8A16 guarda pesos en FP8 pero multiplica en BF16 (ahorra bytes, no FLOPs). W8A8 multiplica en FP8 (ahorra bytes y duplica el pico de cómputo).

**Split-KV / FlashDecoding**:
Partir el contexto de la atención de decode en trozos procesados por bloques distintos y combinar los resultados al final. Evita que pocos bloques largos dejen la mayoría de los SMs ociosos.

**PackGQA**:
Técnica de FA3: mete en un mismo tile las cabezas Q que comparten una cabeza KV, para leer ese KV una sola vez. En decode de Qwen3-8B, el kernel de atención trabaja por cabeza KV (8), no por cabeza Q (32).

**FP8 por bloques / por tensor**:
Dos formas de escalar FP8. Por tensor: una escala para todo el tensor. Por bloques: una escala por bloque (128×128 en los pesos, 1×128 en las activaciones); es lo que usa el checkpoint oficial `Qwen3-8B-FP8` y lo que muestra v1 por defecto.

**swapAB**:
Truco de GEMM para M chico (pocos tokens): intercambia los operandos para que las filas del peso llenen la dimensión grande del tile y los tokens la chica. Lo usa FlashInfer en FP8 por bloques con M < 32.

**Fusión de kernels**:
Juntar varias ops lógicas (p. ej. suma residual + RMSNorm) en un solo kernel para no ir y volver a HBM entre ellas. El kernel fusionado cuenta solo los bytes que cruzan su frontera; la diferencia con la suma de sus ops es el ahorro por fusión (fusion saving) que muestra la UI (ADR 0012).
_Avoid_: "merge", "kernel combinado"

**Stream residual**:
El vector por token que atraviesa todas las capas; atención y MLP le suman su salida. El kernel residual + RMSNorm escribe el residual nuevo a HBM aunque lo use adentro, porque la siguiente suma residual lo vuelve a leer.

**RMSNorm**:
Normalización que divide cada vector de activaciones por su raíz cuadrática media y lo escala por un peso aprendido. Qwen3 la aplica antes de atención, antes del MLP, al final del modelo y a Q y K (QK-norm).
_Avoid_: "LayerNorm" (resta la media; Qwen3 no la usa)

**Intermedio**:
Tensor que una op produce y otra consume dentro del mismo kernel fusionado, sin pasar por HBM. Solo lo es si ninguna op de otro kernel lo lee (ADR 0012).

**Tensor persistente**:
Tensor que se escribe a HBM siempre, se fusione como se fusione, porque tiene que sobrevivir al paso: KV cache y tokens muestreados (ADR 0012).

**torch.compile / Inductor**:
Compilador de PyTorch que vLLM usa por defecto. Inductor genera kernels Triton que fusionan ops elementwise (norms, residual, activaciones); por eso esos kernels no están escritos a mano en vLLM.

**CUDA graphs**:
Grabar una secuencia de lanzamientos de kernels una vez y reproducirla entera con una sola llamada. vLLM lo usa en pasos de hasta 512 tokens para recortar el overhead de lanzamiento: en decode, el graph es FULL e incluye la atención; en prefill es PIECEWISE y la atención queda afuera.
Cada graph se graba para un tamaño fijo, así que vLLM rellena el paso hasta el tamaño capturado más cercano (el **relleno**): las GEMMs de un batch de 25 trabajan con M = 32.

## Rendimiento

**Kernel**:
Una función que corre en la GPU, lanzada por el host. Una op lógica del modelo puede ser un kernel o parte de uno fusionado.
_Avoid_: "kernel" en el sentido de sistema operativo

**Roofline**:
Modelo que acota el rendimiento de un kernel por el pico de cómputo o por el ancho de banda de memoria, según su intensidad aritmética.

**Intensidad aritmética**:
FLOPs / bytes movidos desde memoria. Por debajo del ridge point el kernel es memory-bound; por encima, compute-bound.

**Ridge point**:
Pico de FLOPs / ancho de banda de la GPU (~295 FLOP/byte en H100 BF16). El punto donde cambia el cuello de botella.

## Hardware

**SM (streaming multiprocessor)**:
La unidad de cómputo replicada de la GPU (132 en H100 SXM). Ejecuta thread blocks; tiene 4 sub-particiones, shared memory/L1 y tensor cores.

**Die**:
La pieza de silicio en sí: el chip recortado de la oblea, donde están los SMs, la L2 y los controladores de memoria (GH100, ~814 mm²).
_Avoid_: "chip" cuando se habla del package completo

**Package**:
El die más los stacks de HBM montados juntos sobre un interposer de silicio. Es lo que se ve al sacar el disipador.

**GPC (graphics processing cluster)**:
Grupo de TPCs (de 2 SMs cada uno) que comparte recursos. H100 SXM tiene 8; el reparto de SMs habilitados entre GPCs no es parejo.

**HBM**:
La memoria principal de la GPU (80 GB, ~3.35 TB/s en H100 SXM). Pesos y KV cache viven acá.

**Tile / tiling**:
Partir una matriz de salida en bloques (tiles); cada thread block calcula uno. Define cuántos bloques hay y cuánta shared memory y registros usa cada uno.

**Onda (wave)**:
Una tanda de thread blocks que ocupa todos los SMs a la vez. Si los tiles no son múltiplo de los SMs disponibles, la última onda queda incompleta (cuantización por ondas).

**Kernel persistente**:
Kernel que lanza un bloque por SM (132) y reparte los tiles en rondas desde adentro, en lugar de lanzar un bloque por tile. FA3, DeepGEMM y FlashInfer en H100 lo son; las "ondas" pasan a ser esas rondas.
