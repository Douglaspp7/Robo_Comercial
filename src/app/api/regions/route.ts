import { NextResponse } from "next/server";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = "places.displayName,places.types,nextPageToken";

const MAX_PAGES = 3; // auto-paginação: até ~60 candidatos a bairro

// Tipos do Google que representam bairros/sub-regiões de uma cidade
const NEIGHBORHOOD_TYPES = new Set([
  "sublocality",
  "sublocality_level_1",
  "sublocality_level_2",
  "neighborhood",
]);

async function fetchPage(
  apiKey: string,
  textQuery: string,
  pageToken?: string
): Promise<{ data: any; ok: boolean }> {
  const requestBody: any = {
    textQuery,
    languageCode: "pt-BR",
    regionCode: "BR",
    maxResultCount: 20,
  };
  if (pageToken) requestBody.pageToken = pageToken;

  const response = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error("Erro da API do Google (regions):", errorData);
    return { data: errorData, ok: false };
  }
  return { data: await response.json(), ok: true };
}

export async function POST(request: Request) {
  try {
    const { city } = await request.json();

    if (!city || !String(city).trim()) {
      return NextResponse.json({ error: "A cidade é obrigatória" }, { status: 400 });
    }
    const cityName = String(city).trim();

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "A chave da API do Google Places não está configurada no servidor (.env.local)" },
        { status: 500 }
      );
    }

    // Normaliza nomes para deduplicar (sem acento, minúsculo)
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim();

    const cityNorm = normalize(cityName.split(",")[0]);

    const strict = new Map<string, string>(); // bairros com tipo confirmado
    const loose = new Map<string, string>(); // fallback: qualquer resultado plausível

    let pageToken: string | undefined = undefined;
    let anyOk = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, ok } = await fetchPage(apiKey, `bairros em ${cityName}`, pageToken);
      if (!ok) break;
      anyOk = true;

      for (const place of data.places || []) {
        const name: string = place.displayName?.text?.trim() || "";
        if (!name) continue;

        const norm = normalize(name);
        // Ignora se for a própria cidade
        if (norm === cityNorm) continue;

        const types: string[] = place.types || [];
        const isNeighborhood = types.some((t) => NEIGHBORHOOD_TYPES.has(t));

        if (isNeighborhood) {
          if (!strict.has(norm)) strict.set(norm, name);
        } else {
          if (!loose.has(norm)) loose.set(norm, name);
        }
      }

      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }

    if (!anyOk) {
      return NextResponse.json(
        { error: "Erro ao consultar a API do Google Places" },
        { status: 500 }
      );
    }

    // Prefere os bairros com tipo confirmado; se não houver nenhum, usa o fallback.
    const source = strict.size > 0 ? strict : loose;
    const regions = Array.from(source.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));

    return NextResponse.json({
      regions,
      count: regions.length,
      strict: strict.size > 0,
    });
  } catch (error) {
    console.error("Erro interno no /api/regions:", error);
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 });
  }
}
