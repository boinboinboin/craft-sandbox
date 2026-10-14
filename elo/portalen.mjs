// Client for badmintonportalen.no's (NBF) SportsResults web service.
//
// Every method is a JSON POST to WebService1.asmx/<Method>. Calls need a per-session
// context key (SR_CallbackContext, embedded in any NBF page) plus the session cookie.
const BASE = "https://badmintonportalen.no";
const PAGE = `${BASE}/NBF/Spiller/VisSpiller/`;
const SERVICE = `${BASE}/SportsResults/Components/WebService1.asmx`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 30_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let session = null;

async function openSession() {
  const res = await fetch(PAGE, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const key = (await res.text()).match(/SR_CallbackContext = '([^']+)'/)?.[1];
  if (!key) throw new Error("No SR_CallbackContext on NBF page");
  session = { cookie, key };
}

// Backoff between retries adds up to ~2.5 minutes, enough to ride out a network reconnect.
const MAX_ATTEMPTS = 6;

export async function call(method, args, attempt = 1) {
  await sleep(DELAY_MS);
  try {
    if (!session) await openSession();
    const res = await fetch(`${SERVICE}/${method}`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: PAGE,
        Cookie: session.cookie,
      },
      body: JSON.stringify({ callbackcontextkey: session.key, ...args }),
      // Without a timeout a dropped connection (e.g. a network reconnect) hangs forever.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).d;
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw new Error(`${method} ${JSON.stringify(args)}: ${err.message}`);
    await sleep(10_000 * attempt);
    session = null; // reopen on the next attempt; the context key may have expired
    return call(method, args, attempt + 1);
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const unescape = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m);

export const text = (html) => unescape(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
