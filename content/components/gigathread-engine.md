---
id: gigathread-engine
does: "The scheduler for the whole chip: it hands each launched thread block to an SM that has room for it."
stores: "Nothing; it keeps track of which blocks are placed where."
---

When a [[kernel]] is launched, its [[thread-block|blocks]] don't go to SMs on their own. The GigaThread engine holds the list of blocks still waiting and gives each one to an [[sm]] with enough free registers, [[shared-memory]] and warp slots.

## Why it exists

The program says how many blocks a kernel has, not where they run. Placing them in hardware means the same program fills a GPU of any size, and a new block starts as soon as an SM frees up.

## In a decode step

A decode step launches several kernels per layer, and every launch passes through here. With [[cuda-graphs]] the host sends the whole step in one call, but the engine still places each kernel's blocks. Its work is why blocks fill the [[sm|SMs]] in [[wave|waves]], and why an uneven last wave leaves some SMs idle. A [[persistent-kernel]] avoids the uneven last wave by launching one block per SM and handing out tiles from inside.

## Think of it as

The expediter in a kitchen: they hand each new order ticket to whichever station has room for it.
