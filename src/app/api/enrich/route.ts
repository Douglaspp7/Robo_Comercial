import { NextResponse } from "next/server";
import { extractPhones, formatBrPhone } from "@/lib/contacts";
import { assertPublicHttpUrl } from "@/lib/public-url";
import { rateLimit } from "@/lib/rate-limit";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const IG_RE = /https?:\/\/(?:www\.)?instagram\.com\/[a-z0-9._-]+\/?/gi;
const MAX_LEADS = 25;
const MAX_BYTES = 512_000;

async function readLimited(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) throw new Error("Site excede o limite de leitura");
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

async function fetchPublicHtml(value: string) {
  let url = await assertPublicHttpUrl(value);
  for (let redirect = 0; redirect < 3; redirect++) {
    const response = await fetch(url, {
      cache: "no-store", redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "ZapienLeadEnrichment/1.0", Accept: "text/html" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirecionamento inválido");
      url = await assertPublicHttpUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) throw new Error("Site indisponível");
    return { html: await readLimited(response), finalUrl: url.toString() };
  }
  throw new Error("Redirecionamentos demais");
}

export function extractPublicContacts(html: string) {
  const visible = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const emails = [...new Set(visible.match(EMAIL_RE) || [])].filter((email) => !/example\.|sentry|wixpress/i.test(email));
  const phones = extractPhones(visible);
  const instagram = [...new Set(visible.match(IG_RE) || [])][0] || "";
  return { email: emails[0] || "", phone: phones[0] ? formatBrPhone(phones[0]) : "", instagram };
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "website-enrichment", 4, 60_000);
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  const leads = Array.isArray(body.leads) ? body.leads.slice(0, MAX_LEADS) : [];
  const enriched = [];
  for (const lead of leads) {
    const website = String(lead?.website || "").trim();
    if (!website) { enriched.push(lead); continue; }
    try {
      const { html, finalUrl } = await fetchPublicHtml(website);
      const found = extractPublicContacts(html);
      enriched.push({ ...lead, website: finalUrl, email: lead.email || found.email, phone: lead.phone || found.phone,
        instagram_url: found.instagram || lead.instagram_url || "", enrichment_status: "enriched" });
    } catch {
      enriched.push({ ...lead, enrichment_status: "unavailable" });
    }
  }
  return NextResponse.json({ leads: enriched, processed: enriched.length });
}
