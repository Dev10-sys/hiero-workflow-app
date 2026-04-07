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
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: ".hiero-workflow.yml",
        ref,
      });

      if ("content" in data) {
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
    const headRef = pr.head.ref;

    // 2. Load repo-specific rules
    const config = await this.loadConfig(headOwner, headRepo, headRef);
    if (!config || !config.pull_requests) return;

    const checklist: string[] = [];

    // Title Check (Conventional Commits)
    const titleCheck = config.pull_requests.title_check;
    if (titleCheck?.enabled) {
      const regex = new RegExp(titleCheck.pattern);
      if (!regex.test(pr.title)) {
        checklist.push(`❌ **PR Title**: ${titleCheck.error_message} (Found: "${pr.title}")`);
      } else {
        checklist.push(`✅ **PR Title**: Valid format`);
      }
    }

    // Assignee Check
    const assigneeCheck = config.pull_requests.assignee;
    if (assigneeCheck?.required && pr.assignees?.length === 0) {
      checklist.push(`❌ **Assignee**: ${assigneeCheck.error_message}`);
    } else {
      checklist.push(`✅ **Assignee**: Present`);
    }

    // Apply outcome to GitHub
    if (checklist.length > 0) {
      const body = `### 🤖 Hiero Workflow Check\n\n${checklist.join("\n")}\n\n*Please address the failing checks to proceed.*`;
      
      // Update check status and comment
      await this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });

      console.log(`[PR #${prNumber}] Validation result: ${checklist.length} failures found.`);
    }
  }

  /**
   * Validates issue assignment based on cross-repo contributor qualification.
   */
  async evaluateAssignment(owner: string, repo: string, issueNumber: number, assignee: string) {
    const config = await this.loadConfig(owner, repo);
    const rules = config?.contributor_checks?.assignment_restriction;
    if (!rules?.enabled) return;

    const { data: issue } = await this.octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

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
