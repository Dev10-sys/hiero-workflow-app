import { Octokit } from "@octokit/rest";
import type { HieroWorkflowConfig } from "./types.js";
import { parse } from "yaml";

/**
 * Hiero Workflow Engine
 * Core logic for evaluating repository events against .hiero-workflow.yml rules.
 * Initialized with an authenticated Octokit instance (App or Installation token).
 */
export class Engine {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  /**
   * Loads the configuration from the target repository.
   * Fetches .hiero-workflow.yml from the PR's head ref or default branch.
   */
  async loadConfig(owner: string, repo: string, ref?: string): Promise<HieroWorkflowConfig | null> {
    try {
      const params: any = {
        owner,
        repo,
        path: ".hiero-workflow.yml",
      };
      if (ref) params.ref = ref;

      const { data } = await this.octokit.repos.getContent(params);

      if (data && !Array.isArray(data) && "content" in data) {
        const content = Buffer.from(data.content, "base64").toString();
        return parse(content) as HieroWorkflowConfig;
      }
      return null;
    } catch (error) {
      console.warn(`[Engine] Configuration not found for ${owner}/${repo} at ${ref || 'default branch'}`);
      return null;
    }
  }

  /**
   * Main entry point for Pull Request evaluations.
   */
  async evaluatePR(owner: string, repo: string, prNumber: number) {
    // 1. Get PR details to find the head ref for config fetching
    const { data: pr } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const headOwner = pr.head.repo?.owner.login || owner;
    const headRepo = pr.head.repo?.name || repo;
    const headRef = pr.head.sha; // Use SHA for Check Runs

    // 2. Initialize Check Run
    const checkRun = await this.octokit.checks.create({
      owner,
      repo,
      name: "Hiero Workflow Validation",
      head_sha: headRef,
      status: "in_progress",
      started_at: new Date().toISOString(),
    });

    try {
      // 3. Load repo-specific rules
      const config = await this.loadConfig(headOwner, headRepo, headRef);
      if (!config || !config.pull_requests) {
        const message = !config ? "No .hiero-workflow.yml found." : "No pull_requests rules defined.";
        console.log(`[PR #${prNumber}] Skipping: ${message}`);
        
        await this.octokit.checks.update({
          owner,
          repo,
          check_run_id: checkRun.data.id,
          status: "completed",
          conclusion: "neutral",
          output: {
            title: "Hiero Workflow Skipped",
            summary: message,
          },
        });
        return;
      }

      const failures: string[] = [];
      const successes: string[] = [];

      // Title Check (Conventional Commits)
      const titleCheck = config.pull_requests.title_check;
      if (titleCheck?.enabled) {
        const regex = new RegExp(titleCheck.pattern);
        if (!regex.test(pr.title)) {
          failures.push(`❌ **PR Title**: ${titleCheck.error_message} (Found: "${pr.title}")`);
        } else {
          successes.push(`✅ **PR Title**: Valid format`);
        }
      }

      // Assignee Check
      const assigneeCheck = config.pull_requests.assignee;
      if (assigneeCheck?.required && pr.assignees?.length === 0) {
        failures.push(`❌ **Assignee**: ${assigneeCheck.error_message}`);
      } else {
        successes.push(`✅ **Assignee**: Present`);
      }

      const allChecks = [...failures, ...successes];
      const isSuccess = failures.length === 0;

      // 4. Update Check Run result
      await this.octokit.checks.update({
        owner,
        repo,
        check_run_id: checkRun.data.id,
        status: "completed",
        conclusion: isSuccess ? "success" : "failure",
        completed_at: new Date().toISOString(),
        output: {
          title: isSuccess ? "All checks passed" : "Validation failed",
          summary: isSuccess 
            ? "Your PR meets all Hiero workflow requirements." 
            : "Please address the following requirements to merge.",
          text: allChecks.join("\n\n"),
        },
      });

      // 5. Post comment only if there are failures (existing logic)
      if (!isSuccess) {
        const body = `### 🤖 Hiero Workflow Check\n\n${failures.join("\n")}\n\n*Please address the failing checks to proceed.*`;
        await this.octokit.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body,
        });
        console.log(`[PR #${prNumber}] Validation result: ${failures.length} failures found.`);
      } else {
        console.log(`[PR #${prNumber}] Validation result: Success.`);
      }

    } catch (error) {
      console.error(`[PR #${prNumber}] Engine evaluation failed: ${error}`);
      await this.octokit.checks.update({
        owner,
        repo,
        check_run_id: checkRun.data.id,
        status: "completed",
        conclusion: "failure",
        output: {
          title: "Hiero Workflow Error",
          summary: "An internal error occurred during validation.",
          text: `Error details: ${error}`,
        },
      });
    }
  }

  /**
   * Validates issue assignment based on cross-repo contributor qualification.
   */
  async evaluateAssignment(owner: string, repo: string, issueNumber: number, assignee: string) {
    const config = await this.loadConfig(owner, repo);
    const rules = config?.contributor_checks?.assignment_restriction;
    if (!rules?.enabled) return;

    try {
      const { data: issue } = await this.octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });

      if (!issue.labels || issue.labels.length === 0) {
        console.log(`[Issue #${issueNumber}] No labels found. Skipping assignment evaluation.`);
        return;
      }

    for (const label of issue.labels) {
      const labelName = typeof label === "string" ? label : (label as any).name;
      const rule = rules.labels[labelName];

      if (rule) {
        const count = await this.checkQualification(owner, assignee, rule.prerequisite_label);
        
        if (count < rule.prerequisite_closed_issues) {
          const body = rules.error_message
            .replace("{label}", labelName)
            .replace("{count}", rule.prerequisite_closed_issues.toString())
            .replace("{prereq}", rule.prerequisite_label)
            .replace("@user", `@${assignee}`);
          
          await this.octokit.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body: `⚠️ **Qualification Warning**\n\n${body}`,
          });

          await this.octokit.issues.removeAssignees({
            owner,
            repo,
            issue_number: issueNumber,
            assignees: [assignee],
          });

          console.log(`[Issue #${issueNumber}] Unassigned @${assignee}: Needs ${rule.prerequisite_closed_issues} ${rule.prerequisite_label} issues.`);
        }
        }
      }
    } catch (error) {
      console.error(`[Issue #${issueNumber}] Assignment evaluation failed: ${error}`);
    }
  }

  private async checkQualification(org: string, user: string, label: string): Promise<number> {
    const searchQuery = `org:${org} is:issue is:closed label:"${label}" assignee:${user}`;
    const query = `
      query($searchQuery: String!) {
        search(type: ISSUE, query: $searchQuery, first: 100) {
          issueCount
        }
      }
    `;

    try {
      const result: any = await this.octokit.graphql(query, { searchQuery });
      return result.search.issueCount || 0;
    } catch (e) {
      console.error("[Engine] Cross-repo qualification query failed", e);
      return 0;
    }
  }
}
