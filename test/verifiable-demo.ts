import express from "express";
import { Octokit } from "@octokit/rest";
import { parse } from "yaml";

// ─── TYPES ────────────────────────────────────────────────────────

interface HieroWorkflowConfig {
  version: number;
  pull_requests?: {
    title_check?: { enabled: boolean; pattern: string; error_message: string };
    assignee?: { required: boolean; error_message: string };
  };
  contributor_checks?: {
    assignment_restriction?: {
      enabled: boolean;
      labels: Record<string, { prerequisite_closed_issues: number; prerequisite_label: string }>;
      error_message: string;
    };
  };
}

// ─── ENGINE ───────────────────────────────────────────────────────

class Engine {
  private octokit: Octokit;
  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  async mockLoadConfig(): Promise<HieroWorkflowConfig> {
    // Return the same config we've been using for the demo
    return {
      version: 1,
      pull_requests: {
        title_check: { enabled: true, pattern: "^(feat|fix|docs): .*", error_message: "Bad title!" },
        assignee: { required: true, error_message: "Missing assignee!" }
      },
      contributor_checks: {
        assignment_restriction: {
          enabled: true,
          labels: { "skill:advanced": { prerequisite_closed_issues: 3, prerequisite_label: "skill:intermediate" } },
          error_message: "Hi @user, you need {count} {prereq} issues for {label}."
        }
      }
    };
  }

  async evaluatePR(owner: string, repo: string, pr: any) {
    console.log(`[Engine] Evaluating PR #${pr.number} in ${owner}/${repo}`);
    const config = await this.mockLoadConfig();
    
    // Title Check
    const regex = new RegExp(config.pull_requests!.title_check!.pattern);
    if (!regex.test(pr.title)) {
        console.log(`[Action] FAIL: PR title "${pr.title}" is invalid.`);
        console.log(`[GitHub API] Posting comment: "${config.pull_requests!.title_check!.error_message}"`);
    } else {
        console.log(`[Action] PASS: PR title is valid.`);
    }

    // Assignee Check
    if (config.pull_requests!.assignee!.required && (!pr.assignees || pr.assignees.length === 0)) {
        console.log(`[Action] FAIL: PR has no assignee.`);
        console.log(`[GitHub API] Posting comment: "${config.pull_requests!.assignee!.error_message}"`);
    }
  }

  async evaluateAssignment(owner: string, repo: string, issue: any, assignee: string) {
    console.log(`[Engine] Evaluating Assignment of @${assignee} to Issue #${issue.number}`);
    const config = await this.mockLoadConfig();
    
    for (const label of issue.labels) {
        const rule = config.contributor_checks?.assignment_restriction?.labels[label.name];
        if (rule) {
            console.log(`[Engine] Found restriction for ${label.name}. Required: ${rule.prerequisite_closed_issues} ${rule.prerequisite_label}`);
            // Mocking qualification check
            const count = 0; // Simulated
            if (count < rule.prerequisite_closed_issues) {
                console.log(`[Action] FAIL: User @${assignee} is NOT qualified.`);
                const msg = config.contributor_checks!.assignment_restriction!.error_message
                    .replace("{count}", rule.prerequisite_closed_issues.toString())
                    .replace("{prereq}", rule.prerequisite_label)
                    .replace("{label}", label.name)
                    .replace("@user", `@${assignee}`);
                console.log(`[GitHub API] Posting comment: "${msg}"`);
                console.log(`[GitHub API] Removing assignee @${assignee}`);
            }
        }
    }
  }
}

// ─── SERVER ───────────────────────────────────────────────────────

const app = express();
const engine = new Engine(new Octokit());

app.use(express.json());

app.post("/webhooks", async (req, res) => {
  const event = req.headers["x-github-event"];
  const payload = req.body;

  console.log(`\n>>> Incoming Webhook: ${event}`);

  if (event === "pull_request") {
    await engine.evaluatePR(payload.repository.owner.login, payload.repository.name, payload.pull_request);
  } else if (event === "issues" && payload.action === "assigned") {
    await engine.evaluateAssignment(payload.repository.owner.login, payload.repository.name, payload.issue, payload.assignee.login);
  }

  res.status(200).send("OK");
});

app.listen(3000, () => {
  console.log("[Hiero Demo] Listening on port 3000\n");
  
  // ─── SELF-TESTING / SIMULATION ──────────────────────────────────
  setTimeout(async () => {
    // Test Case 1: Bad PR Title
    await axios.post("http://localhost:3000/webhooks", {
        repository: { owner: { login: "Dev10-sys" }, name: "hiero-sdk-python" },
        pull_request: { number: 1, title: "wrong title", assignees: [] }
    }, { headers: { "X-GitHub-Event": "pull_request" } });

    // Test Case 2: Unqualified Issue Assignment
    await axios.post("http://localhost:3000/webhooks", {
        action: "assigned",
        repository: { owner: { login: "Dev10-sys" }, name: "hiero-sdk-cpp" },
        issue: { number: 42, labels: [{ name: "skill:advanced" }] },
        assignee: { login: "newbie" }
    }, { headers: { "X-GitHub-Event": "issues" } });

    process.exit(0);
  }, 1000);
});

import axios from "axios";
