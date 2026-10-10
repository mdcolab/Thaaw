---
trigger: always_on
description: Use VirtualRAGMD for incremental codebase indexing and minimal-context changes.
---
# VirtualRAGMD project workflow

This project has a local `VirtualRAGMD/` index. Do not read the whole repository for routine tasks.

1. Run `virtualragmd index .` before retrieving code; it updates only changed files.
2. Run `virtualragmd search . "keywords"` to locate likely files and symbols.
3. Run `virtualragmd context . --query "task description"` to retrieve a small, relevant code context.
4. Verify current source files and inspect only necessary dependencies/callers before making changes. Index summaries are not authoritative source code.
5. Make a minimal patch, verify with focused tests, and update `VirtualRAGMD/ARCHITECTURE.md` or `VirtualRAGMD/DECISIONS.md` only when appropriate.
6. Broad scans are allowed only when explicitly requested or demonstrably necessary. Never index secrets, build output, dependencies, or the `VirtualRAGMD/` folder.
