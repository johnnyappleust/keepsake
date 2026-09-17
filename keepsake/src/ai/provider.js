// Optional AI provider boundary. Disabled by default. Everything in the
// extension — saving, categorization, dashboard, Instagram import — works
// without this module ever being called.
//
// When the user enables it (and supplies their own API key), exactly two
// things can be sent to the provider they chose:
//   1. "Find products in Instagram saves": the selected post's thumbnail
//      (as an image) and its caption/creator text.
//   2. Categorization assist: the product's title, description and the list
//      of the user's collection names.
// Nothing else leaves the browser: no cookies, no account data, no history.

export const PROVIDERS = {
  openai: { label: 'OpenAI (chat completions)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic (Messages API)', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5' },
  custom: { label: 'Custom OpenAI-compatible endpoint', baseUrl: '', model: '' },
};

export function providerConfig(settings) {
  const ai = settings?.ai || {};
  const base = PROVIDERS[ai.provider] || PROVIDERS.openai;
  return {
    provider: ai.provider || 'openai',
    baseUrl: (ai.baseUrl || base.baseUrl || '').replace(/\/+$/, ''),
    model: ai.model || base.model,
  };
}

export function originFor(settings) {
  const cfg = providerConfig(settings);
  try {
    const u = new URL(cfg.baseUrl);
    if (u.protocol !== 'https:') return '';
    return `${u.origin}/*`;
  } catch {
    return '';
  }
}

// What exactly will be sent, so the UI can show it before the user confirms.
export function describePayload(post) {
  return {
    image: post.thumbnail ? (post.thumbnail.startsWith('data:') ? 'Locally stored thumbnail (JPEG, ≤320px)' : post.thumbnail) : 'No image',
    text: [post.caption ? `Caption: ${post.caption}` : '', post.creator ? `Creator: ${post.creator}` : '', post.instagram?.collectionName || post.collectionName ? `Collection: ${post.instagram?.collectionName || post.collectionName}` : ''].filter(Boolean).join('\n') || 'No text',
  };
}

async function callProvider(cfg, apiKey, { system, userText, imageDataUrl, maxTokens = 600 }) {
  if (!apiKey) throw new Error('Add your API key in Settings → Optional AI first.');
  if (!cfg.baseUrl) throw new Error('Set the provider base URL first.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    if (cfg.provider === 'anthropic') {
      const content = [];
      if (imageDataUrl) {
        const m = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
        if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
      }
      content.push({ type: 'text', text: userText });
      const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
      });
      const data = await readJson(res);
      return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    }
    // OpenAI-compatible chat completions
    const content = [{ type: 'text', text: userText }];
    if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } });
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
    });
    const data = await readJson(res);
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res) {
  const textBody = await res.text();
  let data = null;
  try {
    data = JSON.parse(textBody);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || textBody.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`Provider error (${res.status}): ${msg}`);
  }
  if (!data) throw new Error('Provider returned a non-JSON response.');
  return data;
}

function parseJsonBlock(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) return null;
  const candidates = [cleaned.slice(start), cleaned.slice(start, cleaned.lastIndexOf('}') + 1), cleaned.slice(start, cleaned.lastIndexOf(']') + 1)];
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  return null;
}

// Only data: URLs are sent as images. Remote thumbnail URLs are not forwarded,
// because the provider would then fetch from Instagram on the user's behalf.
function imageFor(post) {
  return post.thumbnail && post.thumbnail.startsWith('data:image/') ? post.thumbnail : '';
}

export async function analyzePost(post, settings, apiKey) {
  const cfg = providerConfig(settings);
  const payload = describePayload(post);
  const system = 'You help someone identify what product is shown in a social media post they saved. Respond ONLY with a JSON object: {"suggestions":[{"name":"short likely item name","category":"broad product category","brand":"brand or empty string","searchPhrases":["2-4 search phrases"],"note":"one short caveat"}]}. Give 1-3 suggestions. Do not invent purchase links. If unsure, say so in note and keep the name generic.';
  const raw = await callProvider(cfg, apiKey, { system, userText: payload.text, imageDataUrl: imageFor(post), maxTokens: 500 });
  const parsed = parseJsonBlock(raw);
  const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : Array.isArray(parsed) ? parsed : [];
  if (!suggestions.length) throw new Error('The provider did not return usable suggestions.');
  return {
    provider: cfg.provider, model: cfg.model, analyzedAt: new Date().toISOString(),
    suggestions: suggestions.slice(0, 3).map((s) => ({
      name: String(s.name || '').slice(0, 120),
      category: String(s.category || '').slice(0, 60),
      brand: String(s.brand || '').slice(0, 60),
      searchPhrases: (Array.isArray(s.searchPhrases) ? s.searchPhrases : []).map((p) => String(p).slice(0, 100)).slice(0, 4),
      note: String(s.note || '').slice(0, 200),
    })),
  };
}

// --- "Find online": identify + web-search for where to buy -------------------------------------
// Uses the provider's own web-search tool (Anthropic Messages API web_search,
// OpenAI Responses API web_search). Every URL in the result is checked
// against the URLs the search actually returned; anything else is dropped, so
// Keepsake never shows a link the model made up.

export function supportsWebLookup(settings) {
  const p = providerConfig(settings).provider;
  return p === 'openai' || p === 'anthropic';
}

const FIND_SYSTEM = 'You help someone find where to buy the product shown in a social media post they saved. First decide what the product most likely is, then use web search (at most 3 searches) to find real listings. Respond ONLY with a JSON object: {"candidates":[{"name":"product name","brand":"brand or empty","retailer":"store name","price":number or null,"currency":"ISO code or empty","url":"exact URL of a listing you found via search, or empty","confidence":0-1,"note":"one short caveat"}]}. Give 1-4 candidates, best first. Only use URLs that appeared in search results. If you cannot identify the product, return an empty candidates list.';

async function findViaAnthropic(cfg, apiKey, userText, imageDataUrl, controller) {
  const content = [];
  if (imageDataUrl) {
    const m = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
    if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({ type: 'text', text: userText });
  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: cfg.model, max_tokens: 1200, system: FIND_SYSTEM, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }], messages: [{ role: 'user', content }] }),
  });
  const data = await readJson(res);
  const seen = new Set();
  let text = '';
  for (const block of data.content || []) {
    if (block.type === 'text') {
      text += block.text || '';
      for (const c of block.citations || []) if (c.url) seen.add(c.url);
    } else if (block.type === 'web_search_tool_result') {
      for (const r of Array.isArray(block.content) ? block.content : []) if (r && r.url) seen.add(r.url);
    }
  }
  return { text, seen };
}

async function findViaOpenAI(cfg, apiKey, userText, imageDataUrl, controller) {
  const content = [{ type: 'input_text', text: userText }];
  if (imageDataUrl) content.push({ type: 'input_image', image_url: imageDataUrl, detail: 'low' });
  const res = await fetch(`${cfg.baseUrl}/responses`, {
    method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: cfg.model, instructions: FIND_SYSTEM, tools: [{ type: 'web_search_preview' }], input: [{ role: 'user', content }], max_output_tokens: 1200 }),
  });
  const data = await readJson(res);
  const seen = new Set();
  let text = '';
  for (const out of data.output || []) {
    if (out.type !== 'message') continue;
    for (const c of out.content || []) {
      if (c.type === 'output_text') {
        text += c.text || '';
        for (const a of c.annotations || []) if (a.url) seen.add(a.url);
      }
    }
  }
  if (!text && typeof data.output_text === 'string') text = data.output_text;
  return { text, seen };
}

function urlVerified(url, seen) {
  if (!url) return false;
  if (seen.has(url)) return true;
  try {
    const u = new URL(url);
    for (const s of seen) {
      try {
        const v = new URL(s);
        if (v.hostname === u.hostname && v.pathname.replace(/\/$/, '') === u.pathname.replace(/\/$/, '')) return true;
      } catch {
        /* skip */
      }
    }
  } catch {
    return false;
  }
  return false;
}

export async function findProductOnline(post, settings, apiKey) {
  const cfg = providerConfig(settings);
  if (!apiKey) throw new Error('Add your API key in Settings → Optional AI first.');
  if (!supportsWebLookup(settings)) throw new Error('Web lookup needs OpenAI or Anthropic (custom endpoints have no search tool).');
  const payload = describePayload(post);
  const userText = `${payload.text}\n\nIdentify the product in this post and find real listings for it.`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const { text, seen } = cfg.provider === 'anthropic'
      ? await findViaAnthropic(cfg, apiKey, userText, imageFor(post), controller)
      : await findViaOpenAI(cfg, apiKey, userText, imageFor(post), controller);
    const parsed = parseJsonBlock(text);
    const list = Array.isArray(parsed?.candidates) ? parsed.candidates : Array.isArray(parsed) ? parsed : [];
    const candidates = list.slice(0, 4).map((c) => {
      const url = typeof c.url === 'string' ? c.url.trim() : '';
      const verified = urlVerified(url, seen);
      return {
        name: String(c.name || '').slice(0, 160), brand: String(c.brand || '').slice(0, 60), retailer: String(c.retailer || '').slice(0, 80),
        price: Number.isFinite(Number(c.price)) && c.price !== null && c.price !== '' ? Number(c.price) : null,
        currency: String(c.currency || '').slice(0, 8), url: verified ? url : '', verified,
        confidence: Number.isFinite(Number(c.confidence)) ? Math.max(0, Math.min(1, Number(c.confidence))) : null,
        note: String(c.note || '').slice(0, 200) + (url && !verified ? ' (link not in search results — dropped)' : ''),
      };
    }).filter((c) => c.name);
    return { provider: cfg.provider, model: cfg.model, searchedAt: new Date().toISOString(), candidates, searchedUrls: [...seen].slice(0, 20) };
  } finally {
    clearTimeout(timer);
  }
}

export async function classifyWithAI(product, collections, settings, apiKey) {
  const cfg = providerConfig(settings);
  const names = collections.map((c) => c.name);
  const system = `You file shopping items into a user's existing collections. Collections: ${JSON.stringify(names)}. Respond ONLY with JSON {"collection":"exact collection name or null","confidence":0-1,"reason":"short"}. Use null when nothing fits well.`;
  const userText = `Title: ${product.title || ''}\nDescription: ${(product.description || '').slice(0, 400)}\nRetailer: ${product.retailer || product.host || ''}\nCategory: ${product.schemaCategory || ''}\nBreadcrumbs: ${(product.breadcrumbs || []).join(' > ')}`;
  const raw = await callProvider(cfg, apiKey, { system, userText, maxTokens: 120 });
  const parsed = parseJsonBlock(raw);
  if (!parsed) return null;
  const match = collections.find((c) => c.name.toLowerCase() === String(parsed.collection || '').toLowerCase());
  if (!match) return null;
  return { collectionId: match.id, collectionName: match.name, confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)), reason: String(parsed.reason || 'AI suggestion').slice(0, 200) };
}

export async function testConnection(settings, apiKey) {
  const cfg = providerConfig(settings);
  const raw = await callProvider(cfg, apiKey, { system: 'Reply with the single word OK.', userText: 'Connection test.', maxTokens: 5 });
  return String(raw || '').trim().slice(0, 40);
}
