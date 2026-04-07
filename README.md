# Hiero Workflow Automation Hub

The Hiero Workflow Automation Hub is the central orchestration layer for all GitHub interactions across the Hiero ecosystem. It reduces maintainer fatigue by automating repetitive tasks like contributor qualification, PR validation, and issue assignment.

## Getting Started

### 1. Configuration (`.hiero-workflow.yml`)
Each repository must include a `.hiero-workflow.yml` at its root. This file defines which rules are active and their thresholds.

### 2. The Hub Proxy (`hiero-workflow-app`)
A Node.js backend that receives webhooks, evaluates rules, and executes actions via the GitHub API.

## Core Modules

1. **Qualification Service**: Cross-repo contributor history evaluation.
2. **Labeling Engine**: Automated categorical and sizing labels.
3. **Validation Suite**: PR standards and quality checks.
4. **Stale Automator**: Scheduled cleanup of inactive issues/PRs.

## Permissions & Security
The Hub uses a dedicated GitHub App Token with minimal scope required for issue/PR management. No code-writing permissions are granted by default.

## Architecture
The system uses a Hub-and-Spoke model:
- **Hub**: `hiero-workflow-app` (Logic & Orchestration)
- **Spoke**: SDKs, CLI, Analytics (Events & Configuration)
- **Bridge**: A lightweight GitHub Action (`.github/workflows/hiero-automation-bridge.yml`) that proxies events to the Hub.
