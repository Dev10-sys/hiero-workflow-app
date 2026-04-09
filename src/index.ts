import express from "express";
import { Webhooks } from "@octokit/webhooks";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { Engine } from "./engine.js";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
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
  
  console.log(`[Hiero] Event: pull_request.opened | Repo: ${owner.login}/${name} | Installation: ${installationId}`);
  
  const octokit = await getInstallationClient(installationId);
  const engine = new Engine(octokit);
  await engine.evaluatePR(owner.login, name, payload.number);
});

webhooks.on("issues.assigned", async ({ payload }: any) => {
  const { owner, name } = payload.repository;
  const installationId = payload.installation.id;
  const assignee = payload.assignee.login;

  console.log(`[Hiero] Event: issues.assigned | Repo: ${owner.login}/${name} | Assignee: @${assignee}`);

  const octokit = await getInstallationClient(installationId);
  const engine = new Engine(octokit);
  await engine.evaluateAssignment(owner.login, name, payload.issue.number, assignee);
});

// ─── Routes ─────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.status(200).send("<h1>Hiero Automation Hub running</h1><p>Ready to process repository events.</p>");
});

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
  const eventName = req.headers["x-github-event"] as string;
  const deliveryId = req.headers["x-github-delivery"] as string;
  
  console.log(`>>> Incoming Webhook [${deliveryId}]: ${eventName}`);

  try {
    const bridgeToken = req.headers["x-hiero-bridge-token"];
    const webhookSecret = process.env.WEBHOOK_SECRET || "development";

    if (bridgeToken && bridgeToken === webhookSecret) {
      console.log(`[Hiero] Authenticated via Bridge Token`);
      await webhooks.receive({
        id: deliveryId,
        name: eventName as any,
        payload: req.body,
      });
    } else {
      // Signature verification for production safety
      if (!req.headers["x-hub-signature-256"]) {
        throw new Error("Missing X-Hub-Signature-256 header");
      }
      
      await webhooks.verifyAndReceive({
        id: deliveryId,
        name: eventName as any,
        payload: JSON.stringify(req.body),
        signature: req.headers["x-hub-signature-256"] as string,
      });
    }

    res.status(200).send("Accepted");
  } catch (error) {
    console.error(`[Hiero] Webhook unauthorized or failed: ${error}`);
    res.status(401).send("Unauthorized");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Hiero Hub] Live on port ${PORT}`);
});
