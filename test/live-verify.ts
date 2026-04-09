import axios from "axios";
import crypto from "crypto";
import * as dotenv from "dotenv";
dotenv.config();

const WEBHOOK_URL = "https://hiero-workflow-app.onrender.com/webhooks";
const SECRETS = [process.env.WEBHOOK_SECRET, "hiero_secret_2024", "mysecret123", "development"].filter(Boolean) as string[];

async function testLiveWebhook() {
  for (let i = 0; i < SECRETS.length; i++) {
    const SECRET = SECRETS[i];
    console.log(`[Test] Trying secret #${i} starting with: ${SECRET.substring(0, 3)}...`);
    
    function sign(payload: string): string {
      return "sha256=" + crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
    }

  console.log(`[Test] Sending simulated issue.assigned event to ${WEBHOOK_URL}...`);
  
  const payload = {
    action: "assigned",
    repository: { 
      owner: { login: "Dev10-sys" }, 
      name: "hiero-workflow-app" 
    },
    issue: { 
      number: 1, 
      labels: [{ name: "skill:advanced" }] 
    },
    assignee: { login: "tester" },
    installation: { id: 12345678 }
  };

  const body = JSON.stringify(payload);
  
  try {
    const response = await axios.post(WEBHOOK_URL, body, {
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "issues.assigned",
        "X-GitHub-Delivery": "test-" + Date.now(),
        "X-Hub-Signature-256": sign(body)
      }
    });

    if (response.status === 200) {
      console.log("[Test] SUCCESS: Found working secret!");
      return;
    }
  } catch (error: any) {
    if (error.response && error.response.status === 401) {
      console.log(`[Test] Secret failed (401).`);
    } else {
      console.error(`[Test] Unexpected error: ${error.message}`);
      break;
    }
  }
  }
}

testLiveWebhook();
