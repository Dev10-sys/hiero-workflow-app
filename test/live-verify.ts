import axios from "axios";
import crypto from "crypto";
import * as dotenv from "dotenv";
dotenv.config();

const WEBHOOK_URL = "https://hiero-workflow-app.onrender.com/webhooks";
const SECRET = process.env.WEBHOOK_SECRET || "mysecret123";
console.log(`[Test] Using secret starting with: ${SECRET.substring(0, 3)}...`);

function sign(payload: string): string {
  return "sha256=" + crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

async function testLiveWebhook() {
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

    console.log(`[Test] Response: ${response.status} - ${response.data}`);
    console.log("[Test] SUCCESS: Live server received and verified the signed webhook.");
  } catch (error: any) {
    if (error.response) {
      console.error(`[Test] FAILED: Server responded with ${error.response.status}`);
      console.error(`[Test] Details: ${JSON.stringify(error.response.data)}`);
    } else {
      console.error(`[Test] FAILED: ${error.message}`);
    }
  }
}

testLiveWebhook();
