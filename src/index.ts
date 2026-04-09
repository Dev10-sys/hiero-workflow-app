import express from "express";
import { Webhooks } from "@octokit/webhooks";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { Engine } from "./engine.js";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
const webhooks = new Webhooks({
  secret: process.env.WEBHOOK_SECRET || "development",
});

/**
 * Hub Factory: Generates a scoped Octokit instance for each installation.
 */
async function getInstallationClient(installationId: number): Promise<Octokit> {
  const auth = createAppAuth({
    appId: Number(process.env.APP_ID),
    privateKey: process.env.PRIVATE_KEY?.replace(/\\n/g, "\n") || "",
    installationId,
  });

  const { token } = await auth({ type: "installation" });
  return new Octokit({ auth: token });
}

// ─── Listen for Events ───────────────────────────────────────────

webhooks.on("pull_request.opened", async ({ payload }: any) => {
  const { owner, name } = payload.repository;
  const installationId = payload.installation.id;
  
  console.log(`[Hiero] PR #${payload.number} in ${owner.login}/${name} installation: ${installationId}`);
  
  const octokit = await getInstallationClient(installationId);
  const engine = new Engine(octokit);
  await engine.evaluatePR(owner.login, name, payload.number);
});

webhooks.on("issues.assigned", async ({ payload }: any) => {
  const { owner, name } = payload.repository;
  const installationId = payload.installation.id;
  const assignee = payload.assignee.login;

  console.log(`[Hiero] Issue #${payload.issue.number} assigned to @${assignee} in ${owner.login}/${name}`);

  const octokit = await getInstallationClient(installationId);
  const engine = new Engine(octokit);
  await engine.evaluateAssignment(owner.login, name, payload.issue.number, assignee);
});

// ─── Webhook Receiver ────────────────────────────────────────────

app.use(express.json());

// ─── Health check ───────────────────────────────────────────────
app.get("/health", (req, res) => {
  const secretPart = process.env.WEBHOOK_SECRET ? process.env.WEBHOOK_SECRET.substring(0, 3) + "..." : "NOT SET";
  res.status(200).json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    secret_preview: secretPart
  });
});

app.post("/webhooks", async (req: express.Request, res: express.Response) => {
  try {
    const bridgeToken = req.headers["x-hiero-bridge-token"];
    const webhookSecret = process.env.WEBHOOK_SECRET || "development";

    if (bridgeToken === webhookSecret) {
      // Authenticated via Bridge token
      console.log(`[Hiero] Authenticated via Bridge Token`);
    } else {
      // Fallback to GitHub Signature verification
      await webhooks.verifyAndReceive({
        id: req.headers["x-github-delivery"] as string,
        name: req.headers["x-github-event"] as any,
        payload: JSON.stringify(req.body),
        signature: req.headers["x-hub-signature-256"] as string,
      });
    }
    
    // Process the event (webhooks.verifyAndReceive handles its own events, 
    // but for bridge token we need to manually trigger them if we skip verifyAndReceive)
    // Actually, it's better to just manually call the listeners if bridgeToken matches.
    
    if (bridgeToken === webhookSecret) {
      const eventName = req.headers["x-github-event"] as string;
      await webhooks.receive({
        id: req.headers["x-github-delivery"] as string,
        name: eventName as any,
        payload: req.body,
      });
    }

    res.status(200).send("Accepted");
  } catch (error) {
    console.error(`[Hiero] Webhook processing failed: ${error}`);
    res.status(401).send("Unauthorized");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Hiero Hub] Live on port ${PORT}`);
});
