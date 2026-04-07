import express from "express";
import { Webhooks } from "@octokit/webhooks";
import { Octokit } from "@octokit/rest";
import { Engine } from "./engine";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const webhooks = new Webhooks({
  secret: process.env.WEBHOOK_SECRET || "development",
});

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN || "mock-token" });
const engine = new Engine(octokit);

// ─── Listen for Events ───────────────────────────────────────────

webhooks.on("pull_request.opened", async ({ payload }: any) => {
  const { owner, name } = payload.repository;
  console.log(`[Hiero] PR #${payload.number} opened in ${owner.login}/${name}`);
  await engine.evaluatePR(owner.login, name, payload.number);
});

webhooks.on("issues.assigned", async ({ payload }: any) => {
  const { owner, name } = payload.repository;
  const assignee = payload.assignee.login;
  console.log(`[Hiero] Issue #${payload.issue.number} assigned to @${assignee} in ${owner.login}/${name}`);
  await engine.evaluateAssignment(owner.login, name, payload.issue.number, assignee);
});

// ─── Webhook Receiver ────────────────────────────────────────────

app.use(express.json());
app.post("/webhooks", async (req, res) => {
  try {
    // In production, we'd use webhooks.verifyAndReceive for signature security.
    // For local simulation, we'll bypass verification if WEBHOOK_SECRET="local-bypass"
    if (process.env.WEBHOOK_SECRET === "local-bypass") {
      await webhooks.receive({
        id: req.headers["x-github-delivery"] as string,
        name: req.headers["x-github-event"] as any,
        payload: req.body,
      });
    } else {
      await webhooks.verifyAndReceive({
        id: req.headers["x-github-delivery"] as string,
        name: req.headers["x-github-event"] as any,
        payload: JSON.stringify(req.body),
        signature: req.headers["x-hub-signature-256"] as string,
      });
    }
    res.status(200).send("Accepted");
  } catch (error) {
    console.error("[Hiero] Webhook failure", error);
    res.status(401).send("Unauthorized");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Hiero] Automation Hub is listening on port ${PORT}`);
});
