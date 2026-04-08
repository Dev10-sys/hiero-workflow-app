import axios from "axios";
const HUB_URL = "http://localhost:3000/webhooks";
/**
 * 1. Simulate a PR Opened with a bad title.
 * Expectation: Engine will try to post a comment.
 */
async function simulatePRBadTitle() {
    console.log("Simulating PR opened with bad title...");
    const payload = {
        repository: { owner: { login: "Dev10-sys" }, name: "hiero-sdk-python" },
        number: 123,
        pull_request: {
            title: "bad-title",
            assignees: []
        }
    };
    await axios.post(HUB_URL, payload, {
        headers: {
            "X-GitHub-Event": "pull_request.opened",
            "X-GitHub-Delivery": "sim-pr-123"
        }
    });
}
/**
 * 2. Simulate an Issue Assigned to an unqualified user.
 * Expectation: Engine will check qualification and unassign + comment.
 */
async function simulateIssueUnqualified() {
    console.log("Simulating Issue assigned to unqualified user...");
    const payload = {
        repository: { owner: { login: "Dev10-sys" }, name: "hiero-sdk-cpp" },
        issue: { number: 456, labels: [{ name: "skill:advanced" }] },
        assignee: { login: "newbie-contributor" }
    };
    await axios.post(HUB_URL, payload, {
        headers: {
            "X-GitHub-Event": "issues.assigned",
            "X-GitHub-Delivery": "sim-issue-456"
        }
    });
}
async function run() {
    try {
        await simulatePRBadTitle();
        await simulateIssueUnqualified();
        console.log("Simulation finished successfully.");
    }
    catch (e) {
        console.error("Simulation failed:", e.message);
    }
}
run();
//# sourceMappingURL=simulate.js.map