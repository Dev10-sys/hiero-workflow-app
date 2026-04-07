import { Octokit } from "@octokit/rest";
import { parse } from "yaml";

// ─── TYPES ────────────────────────────────────────────────────────

interface HieroWorkflowConfig {
  version: number;
  pull_requests?: {
    title_check?: { enabled: boolean; pattern: string; error_message: string };
    assignee?: { required: boolean; error_message: string };
  };
  labeling?: { path_map?: Record<string, string[]> };
}

// ─── ENGINE ───────────────────────────────────────────────────────

class Engine {
  private octokit: Octokit;
  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  async run(targetOwner: string, targetRepo: string, prNumber: number) {
    console.log(`\n>>> Hiero Automation: Evaluating PR #${prNumber} in ${targetOwner}/${targetRepo}`);
    
    // 1. Get PR details to find where it's coming from
    const { data: pr } = await this.octokit.pulls.get({ owner: targetOwner, repo: targetRepo, pull_number: prNumber });
    
    const headOwner = pr.head.repo?.owner.login || targetOwner;
    const headRepo = pr.head.repo?.name || targetRepo;
    const headRef = pr.head.ref;

    console.log(`[Engine] Fetching config from ${headOwner}/${headRepo} @ ${headRef}`);

    // 2. Load config from the HEAD repo (where .hiero-workflow.yml was added)
    const { data: content } = await this.octokit.repos.getContent({ 
        owner: headOwner, 
        repo: headRepo, 
        path: ".hiero-workflow.yml",
        ref: headRef
    });
    
    const config = parse(Buffer.from((content as any).content, "base64").toString()) as HieroWorkflowConfig;

    const failures: string[] = [];

    // Title check
    const tc = config.pull_requests?.title_check;
    if (tc?.enabled && !new RegExp(tc.pattern).test(pr.title)) {
        failures.push(`[Failed] PR Title: ${tc.error_message} (Found: "${pr.title}")`);
    }

    // Assignee check
    const ac = config.pull_requests?.assignee;
    if (ac?.required && pr.assignees?.length === 0) {
        failures.push(`[Failed] Assignee: ${ac.error_message}`);
    }

    // Post Results
    if (failures.length > 0) {
        const body = `### Hiero Workflow Check\n\n${failures.join("\n")}\n\nPlease fix these to proceed.`;
        await this.octokit.issues.createComment({ owner: targetOwner, repo: targetRepo, issue_number: prNumber, body });
        console.log("LIVE PROOF: Comment posted on GitHub successfully.");
    } else {
        console.log("All checks passed.");
    }
  }
}

// ─── EXECUTION ────────────────────────────────────────────────────

import * as dotenv from "dotenv";
dotenv.config();

const AUTH = process.env.AUTH_TOKEN;
if (!AUTH) {
    throw new Error("AUTH_TOKEN is missing in .env");
}
const engine = new Engine(new Octokit({ auth: AUTH }));

engine.run("hiero-ledger", "hiero-sdk-python", 2083)
  .then(() => console.log("\n>>> LIVE TEST FINISHED SUCCESFULLY."))
  .catch(console.error);
