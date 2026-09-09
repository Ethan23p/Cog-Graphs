# demo

> Derived file — do not edit. The engine rewrites it whenever the graph changes,
> and never reads it back. Everything real lives in `demo.sqlite`.

This is a **Cog Graph**: a persistent store of entities and the attribute/value
pairs recorded about them. It is meant to be worked through the `cog-graphs` CLI —
`cog-graphs introduce --graph demo` is the way in, and
`cog-graphs introduce --interface-skill` is the full primer.

## Profile

- **namespace**: demo
- **use-pattern**: manual
- **description**: Demo.

## Convention

The expectations this graph keeps about its own shape. Amended as the data changes.

- Every entity carries a status.

## Contents

3 entities.

### Helm

- **review**: First line.\ncount: 999\nentity: Ghost

### Shield

- **rating**: 3
- **status**: lost

### Sword

- **rating**: 9
- **status**: owned
