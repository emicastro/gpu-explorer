---
id: substrate
does: "The board the whole package sits on: it brings power in and carries signals out to the rest of the server."
stores: "Nothing. It is wiring and power delivery."
---

The substrate is the layered board at the bottom of the package. The interposer sits on it, and on its underside are the pads that connect to the module.

## Why it exists

The chip's connections are tiny and packed close together, far too small to solder to a server board. The substrate's layers of copper fan them out to pads big enough to connect. They also carry in the large current the chip draws.

## In a decode step

It carries the power the step burns, and the traffic to the host: commands and token ids in, results out. The weights and the [[kv-cache]] never cross it. The [[hbm]] and the [[die]] talk through the interposer above it.
