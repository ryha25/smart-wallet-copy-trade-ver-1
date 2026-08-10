---
name: Artifact recovery
description: How to recover when platform removes artifact registration but files still exist
---

## Symptom
Platform emits "Removed artifact" automatic update. Workflows disappear. `artifacts/<slug>/` directory still exists with `artifact.toml` intact.

## Fast recovery (files intact)
If `.replit-artifact/artifact.toml` still exists:
1. `cp artifacts/<slug>/.replit-artifact/artifact.toml artifacts/<slug>/.replit-artifact/artifact.edit.toml`
2. Call `verifyAndReplaceArtifactToml({ tempFilePath: "...artifact.edit.toml", artifactTomlPath: "...artifact.toml" })`
3. Platform emits "Added artifact" — then restart workflows with `WorkflowsRestart`.

**Why:** This re-registers the artifact without deleting or recreating the directory, preserving all source files.

## If toml is also gone
Restore from git: `git checkout <commit> -- artifacts/<slug>/.replit-artifact/`  
Then run the fast recovery above.

## Workspace restoration (pnpm-workspace.yaml missing)
`git show 30f7dfc:pnpm-workspace.yaml > pnpm-workspace.yaml`  
`git show 30f7dfc:tsconfig.base.json > tsconfig.base.json`  
`git show 30f7dfc:.npmrc > .npmrc`  
`git checkout 30f7dfc -- lib/ scripts/ artifacts/api-server/ tsconfig.json`  
Then `pnpm install`.
