/* hf-client.js — talks to Hugging Face Inference Providers.
   The router is OpenAI-compatible, so one chat-completions call covers
   every model available through a single HF token.

   Two routes:
     proxy  → POST /api/hf on the bundled local server, token read from the
              environment there so it never reaches the browser.
     direct → POST https://router.huggingface.co/v1/chat/completions with a
              token typed into the page. Fine for a local demo, not for a deploy. */

const PROXY_URL = '/api/hf';

export async function chat(hf, messages, { temperature, maxTokens = 700, signal } = {}) {
  const body = {
    model: hf.model,
    messages,
    temperature: temperature ?? hf.temperature ?? 0.8,
    max_tokens: maxTokens
  };

  const useProxy = hf.proxy !== false;
  const url = useProxy ? PROXY_URL : (hf.endpoint || 'https://router.huggingface.co/v1/chat/completions');
  const headers = { 'Content-Type': 'application/json' };
  if (!useProxy) {
    if (!hf.token) throw new Error('No Hugging Face token set. Add one in setup, or switch the proxy on.');
    headers.Authorization = `Bearer ${hf.token}`;
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Model call failed (${res.status}). ${text.slice(0, 220)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('The model returned an unexpected shape.');
  return content;
}

/* Models like to wrap JSON in prose or fences. Pull the first balanced object out. */
export function extractJson(text) {
  const cleaned = text.replace(/```json/gi, '```').split('```').join('\n');
  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error('No JSON object in the response.');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
    }
  }
  throw new Error('Unbalanced JSON in the response.');
}

export async function chatJson(hf, messages, opts = {}) {
  const raw = await chat(hf, [
    ...messages,
    { role: 'system', content: 'Reply with one JSON object and nothing else. No commentary, no code fences.' }
  ], opts);
  return extractJson(raw);
}

export async function testConnection(hf) {
  if (!hf.enabled) return { ok: false, message: 'Model is switched off — personas will run on the built-in engine.' };
  try {
    const reply = await chat(hf, [
      { role: 'user', content: 'Reply with the single word: ready' }
    ], { maxTokens: 12, temperature: 0 });
    return { ok: true, message: `${hf.model} answered: ${reply.trim().slice(0, 40)}` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
