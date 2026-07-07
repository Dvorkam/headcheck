const $ = id => document.getElementById(id);

// Load saved settings
chrome.storage.sync.get(
  { serverEndpoint: "http://localhost:5001", severityThreshold: 2, sites: { reddit: true, seznam: true, hn: true } },
  r => {
    $("endpoint").value = r.serverEndpoint;
    $("threshold").value = r.severityThreshold;
    $("site-reddit").checked = r.sites.reddit;
    $("site-seznam").checked = r.sites.seznam;
    $("site-hn").checked = r.sites.hn;
  }
);

// Test endpoint on blur
$("endpoint").addEventListener("blur", async () => {
  const url = $("endpoint").value.replace(/\/$/, "");
  const status = $("endpoint-status");
  status.textContent = "Checking…";
  status.className = "status";
  try {
    const res = await fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      status.textContent = `Connected — model: ${data.data?.[0]?.id || "unknown"}`;
      status.className = "status ok";
    } else {
      status.textContent = `Reachable but returned ${res.status}`;
      status.className = "status err";
    }
  } catch {
    status.textContent = "Could not reach the LLM server at this address";
    status.className = "status err";
  }
});

// Save
$("save").addEventListener("click", () => {
  chrome.storage.sync.set({
    serverEndpoint: $("endpoint").value.trim(),
    severityThreshold: parseInt($("threshold").value),
    sites: {
      reddit: $("site-reddit").checked,
      seznam: $("site-seznam").checked,
      hn: $("site-hn").checked
    }
  }, () => {
    const msg = $("saved-msg");
    msg.style.display = "inline";
    setTimeout(() => msg.style.display = "none", 2000);
  });
});
