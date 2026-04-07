import { Octokit } from "@octokit/rest";
import type { HieroWorkflowConfig } from "./types.js";
import { parse } from "yaml";

/**
 * Hiero Workflow Engine
 * Core logic for evaluating repository events against .hiero-workflow.yml rules.
 */
export class Engine {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  /**
   * Loads the configuration from the target repository.
   * Looks for .hiero-workflow.yml at the root of the default branch.
   */
  async loadConfig(owner: string, repo: string): Promise<HieroWorkflowConfig | null> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: ".hiero-workflow.yml",
      });

      if ("content" in data) {
        const content = Buffer.from(data.content, "base64").toString();
        return parse(content) as HieroWorkflowConfig;
      }
      return null;
    } catch (error) {
      console.warn(`[Engine] Configuration not found for ${owner}/${repo}`);
      return null;
    }
  }

  /**
   * Main entry point for Pull Request evaluations.
   * Validates title, assignments, and applies path-based labels.
   */
  async evaluatePR(owner: string, repo: string, prNumber: number) {
    const config = await this.loadConfig(owner, repo);
    if (!config || !config.pull_requests) return;

    const { data: pr } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const checklist: string[] = [];

    // 1. Validate PR Title (Conventional Commits)
    const titleCheck = config.pull_requests.title_check;
    if (titleCheck?.enabled) {
      const regex = new RegExp(titleCheck.pattern);
      if (!regex.test(pr.title)) {
        checklist.push(`❌ **PR Title**: ${titleCheck.error_message}`);
      } else {
        checklist.push(`✅ **PR Title**: Valid format`);
      }
    }

    // 2. Ensure Assignee is present
    const assigneeCheck = config.pull_requests.assignee;
    if (assigneeCheck?.required && pr.assignees?.length === 0) {
      checklist.push(`❌ **Assignee**: ${assigneeCheck.error_message}`);
    } else {
      checklist.push(`✅ **Assignee**: Present`);
    }

    // 3. Automated Path-Based Labeling
    if (config.labeling?.path_map) {
      const { data: files } = await this.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      const labelsToAdd = new Set<string>();
      for (const file of files) {
        for (const [label, paths] of Object.entries(config.labeling.path_map)) {
          if (paths.some(p => file.filename.startsWith(p.replace("**", "")))) {
            labelsToAdd.add(label);
          }
        }
      }

      if (labelsToAdd.size > 0) {
        await this.octokit.issues.addLabels({
          owner,
          repo,
          issue_number: prNumber,
          labels: Array.from(labelsToAdd),
        });
        console.log(`[PR #${prNumber}] Applied path-based labels: ${Array.from(labelsToAdd).join(", ")}`);
      }
    }

    // 4. Update PR status/comment if there are failures
    if (checklist.length > 0) {
      const body = `### 🤖 Hiero Workflow Check\n\n${checklist.join("\n")}\n\n*Please address the failing checks to proceed.*`;
      await this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });
    }
  }

  /**
   * Validates if a user is qualified to be assigned to an issue based on their history.
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
      const labelName = typeof label === "string" ? label : label.name;
      if (!labelName) continue;

      const rule = rules.labels[labelName];
      if (rule) {
        // Perform cross-repo GraphQL search for closed issues with specified label
        const qualified = await this.checkQualification(owner, assignee, rule.prerequisite_label, rule.prerequisite_closed_issues);
        
        if (!qualified) {
          const message = rules.error_message
            .replace("{label}", labelName)
            .replace("{count}", rule.prerequisite_closed_issues.toString())
            .replace("{prereq}", rule.prerequisite_label)
            .replace("@user", `@${assignee}`);
          
          await this.octokit.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body: `⚠️ **Qualification Warning**\n\n${message}`,
          });

          await this.octokit.issues.removeAssignees({
            owner,
            repo,
            issue_number: issueNumber,
            assignees: [assignee],
          });

          console.log(`[Issue #${issueNumber}] Unassigned @${assignee} due to missing qualification: ${labelName}`);
        }
      }
    }
  }

  private async checkQualification(owner: string, user: string, label: string, threshold: number): Promise<boolean> {
    const query = `
      query($owner: String!, $user: String!, $label: String!) {
        search(type: ISSUE, query: "org:${owner} is:issue is:closed label:\\"$label\\" assignee:$user", first: 100) {
          issueCount
        }
      }
    `;

    try {
      const result: any = await this.octokit.graphql(query, { owner, user, label });
      return result.search.issueCount >= threshold;
    } catch (e) {
      console.error("[Engine] GraphQL Query Failed", e);
      return false;
    }
  }
}
