# Gateway Envelope — Design Spec

> Status: Draft, agreed in principle (2026-04-27). Not yet implemented.
> Depends on: Kairn integration plan (B). Implementable as v1 with a
> Satori-side LRU before Kairn lands.

## Problem

When a downstream MCP server (e.g. Kado) returns a large response — a 50 KB
note, a tag-search hit list, an indexed PDF — the full payload lands in the
MCP client's context window. With many such calls, context bloat ruins
reasoning quality and burns tokens.

Naïve solutions break the MCP contract:

- **Silent truncation** ("here's a shorter version, pretend it's the full
  thing") corrupts downstream reasoning — the client makes wrong inferences
  on missing data.
- **Wrapper tools** ("call `xyza-kado_read` to get an excerpt") force the
  client to learn new tooling, contradicting the goal of keeping clients
  prompt-/skill-untouched.

## Design

**Size-threshold envelope, transparent for small responses.**

For every gateway tool call, after the downstream server responds:

1. Measure the response size in bytes.
2. If size **< threshold × multiplier**, pass the response through
   unchanged — byte-for-byte identical to what the downstream returned.
3. Otherwise, replace the response with a self-describing envelope and
   stash the full content under a typed `ref`.

The client sees normal MCP traffic in 99% of cases (small responses).
Large responses arrive as an envelope whose `hint` text instructs the
client (in plain English) how to fetch the full content. Modern
instruction-following LLMs handle this without skill or prompt changes.

### Envelope shape

```json
{
  "truncated": true,
  "preview": "first-h1 or first-N-chars excerpt",
  "size_bytes": 47821,
  "ref": "kairn://abc123",
  "hint": "Response was 47 KB, returned as an excerpt. Call satori_fetch({ref: \"kairn://abc123\"}) to retrieve the full content, or satori_kb_search({query, ref}) to query within it."
}
```

### Decisions

| # | Decision | Detail |
|---|---|---|
| 1 | **Threshold is configurable** | Global default in `[gateway]`, override per `[[servers]]`, override per tool name. Concrete defaults TBD; bash builtin uses 5000 bytes today. |
| 2 | **Opt-out is multi-granular** | Per server (`envelope = false`), per tool name (`envelope_disable_tools = [...]`), per request-type-within-tool (e.g. Kado's `kado-read` with `datatype = "file"` is binary — always pass through). Configuration shape for the per-request-type case is open (see below). |
| 3 | **Preview only fires when worth it** | Apply the envelope only if `size > threshold × multiplier`, where `multiplier` ≈ 2 to 2.5. A 201-byte response when threshold is 200 stays raw — a follow-up call costs more than the 1 byte saved. The multiplier is configurable. |
| 4 | **Preview content is structure-aware but dumb** | For markdown/HTML: take content up to the first H1, capped at a configurable char limit. For other text: first N chars. For binary: covered by opt-out (full passthrough or refusal). No async summarisation in v1 — that lands later via Kairn. |
| 5 | **Refs are typed and self-locating** | Format `<backend>://<id>`, e.g. `kairn://abc123` (post-Kairn) or `satori-cache://uuid` (pre-Kairn LRU). No translation table — the prefix tells you where to look. |

### Guiding principle

> **For small files, the envelope path adds zero overhead.** We're saving
> tokens, not creating ceremony. If our work makes the small-file case
> heavier, we got the design wrong.

## What the client sees

- All passthrough tools (`kado-read`, `kado-search`, …) — unchanged
  catalog, unchanged signatures, unchanged responses for small payloads.
- One new Satori-exposed tool: **`satori_fetch({ref})`** — returns the
  full content for a previously-issued ref.
- The existing `satori_kb_search` gains an optional `ref` parameter to
  scope search to a specific cached payload.

No skill changes. No prompt changes. The client learns "what to do with
the envelope" from the envelope's own `hint` field at runtime.

## Configuration sketch

```toml
[gateway.envelope]
enabled = true
threshold_bytes = 5000
multiplier = 2.0
preview_max_chars = 500

[[servers]]
name = "kado"
runtime = "external"
url = "http://127.0.0.1:23026/mcp"
# Per-server overrides:
# envelope = false                       # disable entirely for this server
# envelope_threshold_bytes = 10000       # raise threshold for note-heavy server
# envelope_disable_tools = ["kado-write", "kado-delete"]
```

The per-request-type opt-out (Kado's `datatype = "file"` case) still
needs a configuration shape. Two candidates:

- **Predicate list** — `envelope_passthrough_when = [{ tool = "kado-read", arg = "datatype", value = "file" }]`
- **Handler escape hatch** — let the per-server `handler` decide and
  return a marker on the response that Satori honours.

Decision deferred until we look at Kado's actual response shapes.

## Out of scope for v1

- Async/Kairn-generated summary previews (v1 = dumb cut).
- Cross-call dedup (two clients fetching the same note → two refs).
- Ref persistence across Satori restarts (depends on whether the cache
  is Kairn-backed or Satori-internal).
- Image/binary previews — opt-out + passthrough is the answer.
- Streaming responses — assume MCP responses are buffered for now.

## Open questions

1. **Pre-Kairn cache** — where do refs resolve before Kairn integration
   ships? In-memory LRU keyed by uuid? Disk-backed? With what TTL?
2. **Multiplier value** — 2.0 vs 2.5 vs something content-type-aware?
   Empirical, decide after first measurements.
3. **Per-request-type opt-out** — predicate list vs handler escape hatch
   (see above).
4. **Envelope detection by client** — do we trust the `hint` text, or
   also set a sentinel content-type / structured field that Satori-aware
   clients can pick up? Latter is cheap insurance.

## Implementation notes (when we get there)

- The envelope decision belongs in `gateway/router.ts` after step 9
  (`handler.afterCall`), before the `extractOutput`/`insertCapture`
  block. The full content always goes into ContentDB regardless (audit
  trail); the envelope is what gets returned to the caller.
- `satori_fetch` is a new tool registered alongside `satori_kb`,
  `satori_context` etc. Lookup via the same backend prefix that issued
  the ref.
- The bash builtin's intent-driven mode (`execution/builtin-server.ts`)
  is the working precedent — generalise it, do not duplicate.
