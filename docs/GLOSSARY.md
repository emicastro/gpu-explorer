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

**Fusión de kernels**:
Juntar varias ops lógicas (p. ej. suma residual + RMSNorm) en un solo kernel para no ir y volver a HBM entre ellas.

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
