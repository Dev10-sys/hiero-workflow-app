import { Octokit } from "@octokit/rest";
import { Engine } from "./src/engine.js";
import * as dotenv from "dotenv";
dotenv.config();
// Use the token found in .env
const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (!AUTH_TOKEN) {
    throw new Error("AUTH_TOKEN is missing in .env");
}
async function runLiveTest() {
    const octokit = new Octokit({ auth: AUTH_TOKEN });
    const engine = new Engine(octokit);
    console.log("Starting Live Execution Test...");
    console.log("Target: hiero-ledger/hiero-sdk-python PR #2083");
    try {
        // Evaluate the PR check rules
        await engine.evaluatePR("hiero-ledger", "hiero-sdk-python", 2083);
        console.log("Evaluation completed. Check GitHub for comments and labels.");
    }
    catch (error) {
        console.error("Test failed:", error);
    }
}
runLiveTest();
//# sourceMappingURL=test-live.js.map