chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    if (!details.url.includes('.vtt')) return;

    const res = await fetch(details.url);
    const text = await res.text();

    const translated = await translateVTT(text);

    const blob = new Blob([translated], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);

    return { redirectUrl: url };
  },
  { urls: ["*://*/*.vtt*"] },
  ["blocking"]
);