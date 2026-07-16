import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { extractPhones, formatBrPhone } from "@/lib/contacts";

// Fonte de leads via Instagram Graph API (oficial), focada em PERFIS
// COMERCIAIS com contato público — mesmo espírito do Google Maps.
//
// Dois modos:
//  - "hashtag": pega publicações recentes de uma hashtag e minera telefone/
//    WhatsApp direto das legendas.
//  - "profiles": recebe uma lista de @perfis e lê bio + site de cada um via
//    Business Discovery, extraindo o contato público.
//
// Requer um app na Meta + conta Instagram Comercial:
//   IG_ACCESS_TOKEN  = token de acesso (long-lived)
//   IG_BUSINESS_ID   = id da SUA conta IG comercial (quem faz as consultas)
const GRAPH = `https://graph.facebook.com/${process.env.IG_GRAPH_VERSION || "v21.0"}`;

const MAX_HASHTAG_PAGES = 3; // ~cada página traz até ~25 posts
const MAX_PROFILES = 50; // teto de @perfis por requisição
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

interface Lead {
  id: string;
  name: string;
  address: string;
  rating: number;
  phone: string;
  website: string;
  email?: string;
  source_url?: string;
}

// Acumula leads deduplicando pelo telefone normalizado (evita o mesmo número
// vindo de vários posts/perfis).
class LeadBag {
  private byPhone = new Map<string, Lead>();
  add(phone: string, base: Omit<Lead, "phone">) {
    if (this.byPhone.has(phone)) return;
    this.byPhone.set(phone, { ...base, phone: formatBrPhone(phone) });
  }
  values() {
    return [...this.byPhone.values()];
  }
}

async function graphGet(path: string, params: Record<string, string>) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", process.env.IG_ACCESS_TOKEN || "");
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ── Modo hashtag ─────────────────────────────────────────────────────────────
async function searchHashtag(userId: string, term: string): Promise<Lead[]> {
  const tag = term.replace(/^#/, "").trim();
  const search = await graphGet("ig_hashtag_search", { user_id: userId, q: tag });
  const hashtagId = search.data?.data?.[0]?.id;
  if (!hashtagId) return [];

  const bag = new LeadBag();
  let after: string | undefined;
  for (let page = 0; page < MAX_HASHTAG_PAGES; page++) {
    const params: Record<string, string> = {
      user_id: userId,
      fields: "caption,permalink,like_count",
    };
    if (after) params.after = after;
    const media = await graphGet(`${hashtagId}/recent_media`, params);
    if (!media.ok) break;
    for (const m of media.data?.data || []) {
      const caption: string = m.caption || "";
      const phones = extractPhones(caption);
      if (phones.length === 0) continue;
      const firstLine = caption.split("\n")[0].slice(0, 60);
      const email = caption.match(EMAIL_RE)?.[0];
      for (const p of phones) {
        bag.add(p, {
          id: `ig_${m.id}_${p}`,
          name: firstLine || `#${tag}`,
          address: `Instagram · #${tag}`,
          rating: 0,
          website: m.permalink || "",
          email,
          source_url: m.permalink || "",
        });
      }
    }
    after = media.data?.paging?.cursors?.after;
    if (!after) break;
  }
  return bag.values();
}

// ── Modo perfis ──────────────────────────────────────────────────────────────
async function searchProfiles(userId: string, list: string): Promise<Lead[]> {
  const usernames = list
    .split(/[\s,]+/)
    .map((u) => u.replace(/^@/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_PROFILES);

  const bag = new LeadBag();
  for (const username of usernames) {
    const fields = `business_discovery.username(${username}){username,name,biography,website,followers_count}`;
    const res = await graphGet(userId, { fields });
    const bd = res.data?.business_discovery;
    if (!bd) continue; // perfil inexistente, privado ou não-comercial
    const text = `${bd.biography || ""} ${bd.website || ""}`;
    const phones = extractPhones(text);
    const email = text.match(EMAIL_RE)?.[0];
    for (const p of phones) {
      bag.add(p, {
        id: `ig_${bd.username}_${p}`,
        name: bd.name || `@${bd.username}`,
        address: `Instagram · @${bd.username}` +
          (bd.followers_count ? ` · ${bd.followers_count} seg.` : ""),
        rating: 0,
        website: bd.website || `https://instagram.com/${bd.username}`,
        email,
        source_url: `https://instagram.com/${bd.username}`,
      });
    }
  }
  return bag.values();
}

export async function POST(request: Request) {
  const blocked = rateLimit(request, "instagram-search", 10, 60 * 1000);
  if (blocked) return blocked;
  try {
    const { mode, query } = await request.json();
    if (!query || !String(query).trim() || String(query).length > 1000) {
      return NextResponse.json({ error: "Informe a hashtag ou os perfis." }, { status: 400 });
    }

    const token = process.env.IG_ACCESS_TOKEN;
    const userId = process.env.IG_BUSINESS_ID;
    if (!token || !userId) {
      return NextResponse.json(
        {
          error:
            "Instagram não configurado no servidor. Defina IG_ACCESS_TOKEN e " +
            "IG_BUSINESS_ID (ver docs/INSTAGRAM.md).",
        },
        { status: 500 }
      );
    }

    const results =
      mode === "profiles"
        ? await searchProfiles(userId, String(query))
        : await searchHashtag(userId, String(query));

    return NextResponse.json({ results, nextPageToken: null, source: "instagram" });
  } catch (error) {
    console.error("Erro interno no /api/instagram:", error);
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 });
  }
}
