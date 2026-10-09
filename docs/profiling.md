# Guía: perfilar los kernels de vLLM en una GPU local

Paso a paso para reproducir la traza de `data/traces/vllm-0.31.0_qwen3-8b-3layers_rtx3070/` (decisión D14 de `docs/brief.md`). El resultado es la secuencia de kernels que vLLM lanza en cada paso de inferencia y qué ops fusiona cada uno.

**Qué se obtiene y qué no.** La traza dice qué kernels corren y cómo se agrupan las ops. No da tiempos ni kernels de GEMM o de atención válidos para H100, porque dependen de la GPU donde se corre.

---

## 0. Requisitos

| | Mínimo | Cómo verificarlo |
|---|---|---|
| GPU NVIDIA | 8 GB de VRAM | `nvidia-smi` |
| Driver | compatible con CUDA 13.0 (las wheels de vLLM 0.31.0 traen PyTorch `cu130`) | `nvidia-smi`, campo "CUDA Version" arriba a la derecha: tiene que ser ≥ 13.0 |
| Disco | ~20 GB libres **en disco real** (no en `/tmp` si es tmpfs) | `df -h ~` y `findmnt -no FSTYPE /tmp` |
| RAM | 16 GB | `free -g` |
| `uv` | cualquier versión reciente | `uv --version` |
| Internet | sí: se descargan paquetes (~16 GB instalados) y el `config.json` y el tokenizer de Qwen3-8B (no los pesos) | |

Antes de empezar, cerrar lo que use mucha VRAM (juegos, otras apps con GPU). El escritorio puede ir lento durante la corrida.

## 1. Directorio de trabajo aislado

Todo (entorno de Python, cachés de pip/uv, Hugging Face, torch.compile, Triton) va a un solo directorio, para poder borrarlo entero al final.

```sh
export W=$HOME/.cache/gpu-viz-profiling
mkdir -p $W
cat > $W/env.sh <<EOF
export W=$W
export UV_CACHE_DIR=\$W/uv-cache
export UV_PYTHON_INSTALL_DIR=\$W/uv-python
export HF_HOME=\$W/hf
export VLLM_CACHE_ROOT=\$W/vllm-cache
export TORCHINDUCTOR_CACHE_DIR=\$W/inductor-cache
export TRITON_CACHE_DIR=\$W/triton-cache
export XDG_CACHE_HOME=\$W/xdg-cache
export FLASHINFER_WORKSPACE_BASE=\$W/flashinfer
EOF
```

En cada terminal nueva, cargar las variables antes de seguir:

```sh
source $HOME/.cache/gpu-viz-profiling/env.sh
```

> **No usar `/tmp` si es tmpfs.** En muchas distros (Arch incluida) `/tmp` vive en RAM; varios GB de instalación ahí compiten con la memoria que necesita vLLM.
>
> **FlashInfer y su caché.** En la corrida original, FlashInfer ignoró `XDG_CACHE_HOME` y creó `~/.cache/flashinfer`. `FLASHINFER_WORKSPACE_BASE` debería redirigirla, pero no está verificado: revisar en el paso 8 de todas formas.

## 2. Instalar vLLM

```sh
cd $W
uv venv --python 3.12 venv
VIRTUAL_ENV=$W/venv uv pip install vllm==0.31.0
```

`uv` descarga Python 3.12 si no está. La instalación ocupa ~16 GB y tarda varios minutos según la conexión.

Verificar:

```sh
$W/venv/bin/python -c "import vllm, torch; print(vllm.__version__, torch.__version__, torch.version.cuda, torch.cuda.is_available())"
```

Esperado: `0.31.0 2.13.0+cu130 13.0 True`. Si el último valor es `False`, el driver no es compatible (ver paso 0).

## 3. Correr el perfilado

Desde la raíz del repo:

```sh
mkdir -p $W/trace
$W/venv/bin/python tools/profiling/profile_vllm.py $W/trace 2>&1 | tee $W/run.log
```

Qué hace `tools/profiling/profile_vllm.py`:

- **Modelo:** Qwen3-8B con sus dimensiones reales pero solo 3 capas (`hf_overrides={"num_hidden_layers": 3}`) y pesos aleatorios (`load_format="dummy"`). Ocupa ~3.6 GB en vez de 16. Los pesos no cambian qué kernels corren. Hacen falta al menos 2 capas porque la capa 0 es distinta (no fusiona la suma residual); la tercera es una capa típica.
- **Compilación:** torch.compile activo (nivel `-O2` por defecto, con sus fusiones), pero sin CUDA graphs (`cudagraph_mode: NONE`). Los CUDA graphs no cambian qué kernels corren, pero los ocultan en la traza.
- **Carga:** 4 prompts aleatorios de 256 tokens, 4 tokens generados.
- **Calentamiento** con otros prompts distintos antes de perfilar. Si fueran los mismos, vLLM reutilizaría su caché de prefijos y el prefill medido quedaría mucho más corto (en la primera corrida pasó: procesó 64 tokens en vez de 1024).
- **Profiler:** el de PyTorch integrado en vLLM (`profiler_config`), sin stack traces para que la traza quede chica.

Duración: ~2–3 minutos. La primera vez compila (torch.compile ~20 s) y FlashInfer compila su módulo de sampling (~1 min).

**Si se queda sin memoria (OOM):** bajar `gpu_memory_utilization` en el script (por ejemplo a `0.6`), o bajar `max_model_len`.

Al terminar, en `$W/trace/` quedan:

- `rank0.<id>.pt.trace.json.gz`: la traza.
- `profiler_out_0.txt`: tabla resumen de tiempos por op.

## 4. Revisar qué eligió vLLM

```sh
grep -E "attention backend|FlashAttention version|Initializing a V1 LLM engine|torch.compile took|Free memory on device" $W/run.log
```

En la RTX 3070 (Ampere) se vio:

- `Using FLASH_ATTN attention backend`
- `Using FlashAttention version 2` (en H100 sería 3)

## 5. Extraer la secuencia de kernels

```sh
python3 tools/profiling/summarize_trace.py $W/trace/*.pt.trace.json.gz $W/kernels.json
```

Imprime cada paso del motor con sus kernels en orden de lanzamiento, la op de CPU que los lanzó y el grid. `kernels.json` tiene además block, registros por thread y shared memory.

**Cómo leer los nombres de los pasos:** `execute_context_N(T)_generation_M(G)` significa N requests en prefill con T tokens en total, y M requests en decode. vLLM puede mezclar prefill y decode en un mismo paso (batching continuo). Para el análisis interesan los pasos puros:

- prefill puro: `execute_context_1(256)_generation_0(0)`
- decode puro: `execute_context_0(0)_generation_4(4)`

Los kernels del LM head y del sampling quedan **fuera** del rango anotado del paso: aparecen en la traza justo después de cada paso.

## 6. Ver la traza en Perfetto (opcional)

1. Abrir <https://ui.perfetto.dev>.
2. "Open trace file" y elegir el `.pt.trace.json.gz` (no hace falta descomprimirlo). Se procesa en el navegador; no se sube a ningún servidor.
3. En la fila de la GPU (stream 7), las barras de `gpu_user_annotation` marcan cada paso; debajo están los kernels.
4. Click en un kernel muestra grid, block, registros, shared memory y ocupación estimada.

## 7. Confirmar qué fusionó torch.compile

Los kernels `triton_*` los genera Inductor y su nombre solo da pistas. El código generado dice exactamente qué ops de PyTorch fusionó cada uno:

```sh
grep -rh -A6 "Topologically Sorted Source Nodes" $W/vllm-cache | grep -E "Topologically|^#   [a-z_0-9]+ =>" | sort -u
```

Para un kernel cuyo encabezado no aparece así (pasó con `triton_red_fused_1`), abrir el archivo y leer el cuerpo:

```sh
f=$(grep -rl "def triton_red_fused_1(" $W/vllm-cache | head -1)
less "$f"
```

(En ese caso, el cuerpo mostró una RMSNorm sobre `head_dim` = 128 seguida de RoPE con la tabla de cos/sin de 40960 posiciones: QK-norm + RoPE.)

## 8. Guardar el resultado en el repo

Usar una carpeta nueva por corrida, con el nombre `vllm-<versión>_<modelo>-<capas>layers_<gpu>`:

```sh
D=data/traces/vllm-0.31.0_qwen3-8b-3layers_<gpu>
mkdir -p $D
cp $W/trace/*.pt.trace.json.gz $D/trace.json.gz
cp $W/kernels.json $D/kernels.json
```

Anotar las versiones en el README de esa carpeta:

```sh
nvidia-smi --query-gpu=name,memory.total,compute_cap,driver_version --format=csv
$W/venv/bin/python -c "import triton, torch, vllm, flashinfer; print(triton.__version__, torch.__version__, torch.version.cuda, vllm.__version__, flashinfer.__version__)"
```

Antes de commitear, revisar que la traza no tenga rutas locales ni el nombre de usuario:

```sh
zcat $D/trace.json.gz | grep -c "$HOME"
grep -c "$USER" $D/kernels.json
```

Ambos tienen que dar `0`.

## 9. Limpiar

```sh
rm -rf $HOME/.cache/gpu-viz-profiling
```

Revisar si quedó algo fuera del directorio de trabajo, y borrarlo solo si su fecha de creación coincide con la corrida:

```sh
for p in ~/.cache/flashinfer ~/.cache/vllm ~/.cache/huggingface ~/.triton ~/.cache/torch; do
  [ -e "$p" ] && stat -c '%n  creado: %w' "$p"
done
find /tmp -maxdepth 1 \( -name 'vllm*' -o -name 'torchinductor_*' \)
```

Verificar que la GPU volvió a su uso normal con `nvidia-smi`.

---

## Problemas conocidos

| Síntoma | Causa | Solución |
|---|---|---|
| El prefill perfilado procesa muchos menos tokens que los enviados | Caché de prefijos: los prompts perfilados ya se vieron en el calentamiento | Prompts distintos en calentamiento y perfilado (el script ya lo hace) |
| `torch.cuda.is_available()` da `False` | Driver anterior a CUDA 13.0 | Actualizar el driver |
| OOM al iniciar | Poca VRAM libre (escritorio u otras apps) | Bajar `gpu_memory_utilization` o `max_model_len` |
| Aparece `~/.cache/flashinfer` | FlashInfer usa su propia ruta de caché | Borrarla en el paso 9 |
| La traza no muestra kernels individuales, solo lanzamientos de graph | CUDA graphs activos | Mantener `cudagraph_mode: NONE` |
| `no matches found` en zsh con comodines como `/tmp/vllm*` | zsh aborta el comando si un patrón no matchea | Usar `find` como en el paso 9 |
