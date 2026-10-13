---
id: gpc
does: "A Graphics Processing Cluster: one of the large groups the die's SMs are organized in, made of several TPCs."
stores: "No data of its own; it groups the SMs below it."
---

The die is divided into a few [[gpc|GPCs]], each a block of [[tpc|TPCs]], and each TPC holds a pair of [[sm|SMs]]. Not every GPC has the same number of working SMs, because some are switched off at the factory.

## Why it exists

A big chip is easier to design and lay out as copies of one block. The GPC is that block. Hopper also lets a kernel ask for a *cluster* of blocks that must run together inside one GPC and can read each other's [[shared-memory]].

## In a decode step

The GPC does no work of its own in a decode step. The [[thread-block|blocks]] of each kernel land on its SMs. Because GPCs have unequal numbers of working [[tpc|TPCs]], a kernel's blocks end up spread over uneven groups.
