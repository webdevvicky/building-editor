# BOQ — Building Editor

A browser app (Vite + React 19 + Zustand, plain JavaScript) for drawing Indian residential buildings (walls, rooms,
structure, MEP). It produces a live editor-side BOQ and an IS 2502 bar-bending schedule. Launched from the JRM ERP,
it is the upstream Building Editor: it writes the canonical Building Document and a live geometry projection to the
ERP. Deployed to Cloudflare Workers; no backend of its own.

Start here:

- [`CLAUDE.md`](CLAUDE.md): rules, workflow, commands and the verification harnesses.
- [`docs/CODEBASE_MAP.md`](docs/CODEBASE_MAP.md): architecture, data flows, the editor↔ERP contract and the Known
  Defects register (KD-n).
- [`docs/DOMAIN-RULES.md`](docs/DOMAIN-RULES.md): domain and engineering rules, each with its status and authority.
- The ERP repo (`erp-saas`): `erp-saas:CLAUDE.md` and `erp-saas:docs/README.md`. The integration architecture is
  `erp-saas:packages/backend/src/modules/building-structure/docs/editor-erp-integration.md`.

```bash
npm install
npm run dev
```
