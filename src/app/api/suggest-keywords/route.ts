import { NextResponse } from "next/server";

// Sugestão de palavras de busca com IA (Claude). Dado o que a pessoa vende,
// a IA propõe NICHOS (termos do Google Maps cujos donos seriam clientes) e
// HASHTAGS do Instagram. Roda no servidor (a chave nunca vai ao navegador).

function extractJson(text: string): { nichos?: unknown; hashtags?: unknown } | null {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/); // tolera cercas de código / texto extra
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function cleanList(arr: unknown, max: number): string[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const s = String(x ?? "").trim().replace(/^#/, "");
    const k = s.toLowerCase();
    if (s && !seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
    if (out.length >= max) break;
  }
  return out;
}

export async function POST(request: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY não configurada no painel." },
      { status: 501 },
    );
  }

  let body: { description?: string; city?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const description = String(body.description || "").trim();
  const city = String(body.city || "").trim();
  if (!description) {
    return NextResponse.json({ error: "Descreva o que você vende." }, { status: 400 });
  }

  const prompt =
    `Você ajuda a montar buscas de LEADS para prospecção B2B no Google Maps e no Instagram.\n` +
    `Produto/serviço que a pessoa quer VENDER: "${description}".\n` +
    `Liste NICHOS DE NEGÓCIO (termos de busca do Google Maps) cujos DONOS seriam bons CLIENTES desse produto, ` +
    `e HASHTAGS do Instagram onde esses clientes aparecem. Foco no Brasil` +
    (city ? `, cidade base: ${city}` : "") +
    `. Termos curtos e comerciais, sem duplicar.\n` +
    `Responda SOMENTE com JSON válido, sem texto fora do JSON, no formato:\n` +
    `{"nichos":["...","..."],"hashtags":["...","..."]}\n` +
    `Máximo 18 nichos e 12 hashtags. Hashtags sem o "#".`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Falha na IA (${res.status})`, detail: detail.slice(0, 200) },
        { status: 502 },
      );
    }
    const data = await res.json();
    const text: string = data?.content?.[0]?.text || "";
    const parsed = extractJson(text);
    const nichos = cleanList(parsed?.nichos, 18);
    const hashtags = cleanList(parsed?.hashtags, 12);
    if (nichos.length === 0 && hashtags.length === 0) {
      return NextResponse.json({ error: "A IA não retornou sugestões utilizáveis." }, { status: 502 });
    }
    return NextResponse.json({ nichos, hashtags });
  } catch {
    return NextResponse.json({ error: "Não foi possível chamar a IA." }, { status: 502 });
  }
}
