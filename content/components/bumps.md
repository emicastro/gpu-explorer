---
id: bumps
does: "Tiny solder balls under each chip, joining it to the interposer."
stores: "Nothing. Each bump carries one signal or one power connection."
---

Under the [[die]] and under every [[hbm]] stack is a dense grid of microscopic solder balls. Each one joins a pad on the chip to a pad on the interposer below. In the scene they show as a gold fringe around each chip.

## Why it exists

A chip needs thousands of connections, and wires bonded only around its edges can't provide that many. Bumps spread the connections over the whole underside of the chip, each one very short, which is good both for speed and for delivering power.

## In a decode step

Every byte that travels between [[hbm]] and the die passes through two sets of bumps: down from the memory stack into the interposer, and up from it into the die.
