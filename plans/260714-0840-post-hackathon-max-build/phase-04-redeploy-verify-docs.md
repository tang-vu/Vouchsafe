# Phase 4 — Redeploy Coston2 + verify + live demo + docs

## Overview
The quorum verifier is a new contract → fresh Coston2 deployment. Old v1 addresses remain live;
git history keeps the previous deployments JSON.

## Steps
1. `yarn deploy:coston2` (writes new coston2.json incl. `startBlock`).
2. `yarn workspace @vouchsafe/contracts verify:coston2` (explorer verification).
3. `yarn demo` — unattended happy + fraud path against the new deployment.
4. Update docs: codebase-summary, development-roadmap (tick delivered items), README, SUBMISSION addresses.
5. Conventional commits per concern.

## Risks
- FDC verifier/DA placeholder key rate-limited → retry; if demo blocked externally, report honestly.
- Redeploy overwrites coston2.json → recoverable via git.

## Todo
- [x] deploy + verify (verify: pending explorer backend, standard-json saved)
- [x] live demo pass (happy + fraud + endorse)
- [x] docs + commits
