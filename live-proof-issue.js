import { Octokit } from "@octokit/rest";
import { parse } from "yaml";
// ─── ENGINE ───────────────────────────────────────────────────────
class Engine {
    octokit;
    constructor(octokit) {
        this.octokit = octokit;
    }
    async evaluateIssue(owner, repo, issueNumber, assignee) {
        console.log(`\n>>> Hiero Automation: Evaluating Assignment of @${assignee} to Issue #${issueNumber} in ${owner}/${repo}`);
        // Get Issue Details
        const { data: issue } = await this.octokit.issues.get({ owner, repo, issue_number: issueNumber });
        // 2. Load Config from Hiero-Automation-Init branch (since it's not merged yet)
        const { data: content } = await this.octokit.repos.getContent({
            owner,
            repo,
            path: ".hiero-workflow.yml",
            ref: "hiero-automation-init"
        });
        const config = parse(Buffer.from(content.content, "base64").toString());
        const rules = config.contributor_checks?.assignment_restriction;
        if (!rules?.enabled)
            return;
        for (const label of issue.labels) {
            const labelName = typeof label === "string" ? label : label.name;
            const rule = rules.labels[labelName];
            if (rule) {
                console.log(`[Engine] Found qualification rule for "${labelName}". Required: ${rule.prerequisite_closed_issues} x "${rule.prerequisite_label}"`);
                // 3. Check Qualification (GraphQL)
                const searchQuery = `org:${owner} is:issue is:closed label:"${rule.prerequisite_label}" assignee:${assignee}`;
                const query = `
          query($searchQuery: String!) {
            search(type: ISSUE, query: $searchQuery, first: 100) {
              issueCount
            }
          }
        `;
                const result = await this.octokit.graphql(query, { searchQuery });
                const count = result.search.issueCount;
                console.log(`[Engine] User @${assignee} has ${count} closed "${rule.prerequisite_label}" issues.`);
                if (count < rule.prerequisite_closed_issues) {
                    console.log(`[Action] FAIL: User not qualified. Unassigning...`);
                    const body = `Qualification Warning\n\nHi @${assignee}, I cannot assign you to this issue yet. To qualify for ${labelName} issues, you need to have completed at least ${rule.prerequisite_closed_issues} ${rule.prerequisite_label} issues. Keep building your experience!`;
                    await this.octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
                    await this.octokit.issues.removeAssignees({ owner, repo, issue_number: issueNumber, assignees: [assignee] });
                    console.log("LIVE PROOF: Unassigned and Commented on GitHub.");
                }
            }
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
engine.evaluateIssue("Dev10-sys", "hiero-sdk-cpp", 1, "Dev10-sys")
    .then(() => console.log("\n>>> LIVE QUALIFICATION TEST FINISHED."))
    .catch(console.error);
//# sourceMappingURL=live-proof-issue.js.map