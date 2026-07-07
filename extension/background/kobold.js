const DEFAULT_ENDPOINT = "http://localhost:5001";

export async function getEndpoint() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ koboldEndpoint: DEFAULT_ENDPOINT }, r =>
      resolve(r.koboldEndpoint.replace(/\/$/, ""))
    );
  });
}

function stripThinkBlocks(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export async function callKobold(systemPrompt, userMessage) {
  const endpoint = await getEndpoint();

  try {
    const res = await fetch(`${endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        max_tokens: 600,
        temperature: 0.3,
        stop: ["\n\n\n"],
        reasoning_effort: "none"   // KoboldCPP v1.75+ — disables thinking budget entirely
      })
    });

    if (res.ok) {
      const data = await res.json();
      return stripThinkBlocks(data.choices[0].message.content.trim());
    }
  } catch (_) {}

  // Native API fallback
  const prompt = `### System:\n${systemPrompt}\n\n### User:\n${userMessage}\n\n### Response:\n`;
  const res = await fetch(`${endpoint}/api/v1/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      max_length: 600,
      temperature: 0.3,
      rep_pen: 1.1,
      stop_sequence: ["\n\n\n", "###"],
      reasoning_effort: "none"
    })
  });

  if (!res.ok) throw new Error(`KoboldCPP error: ${res.status}`);
  const data = await res.json();
  return stripThinkBlocks(data.results[0].text.trim());
}

export async function isKoboldReachable() {
  const endpoint = await getEndpoint();
  try {
    const res = await fetch(`${endpoint}/api/v1/model`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch (_) {
    return false;
  }
}
