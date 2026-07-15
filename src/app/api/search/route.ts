import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.rating,places.nationalPhoneNumber,places.websiteUri,nextPageToken";

// Limites de segurança para evitar custo descontrolado na API do Google
const MAX_PAGES_PER_QUERY = 3; // A Text Search do Google retorna no máximo ~60 resultados (3 páginas de 20)
const MAX_REGIONS = 40; // Teto de regiões/bairros processados em uma única busca profunda

interface PlaceResult {
  id: string;
  name: string;
  address: string;
  rating: number | null;
  phone: string;
  website: string;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  nationalPhoneNumber?: string;
  websiteUri?: string;
}

interface PlacesResponse {
  places?: GooglePlace[];
  nextPageToken?: string;
}

interface PlacesRequest {
  textQuery: string;
  languageCode: string;
  maxResultCount: number;
  pageToken?: string;
}

function mapPlaces(data: PlacesResponse): PlaceResult[] {
  return (data.places || []).map((place) => ({
    id: place.id || "",
    name: place.displayName?.text || "Nome Indisponível",
    address: place.formattedAddress || "Endereço Indisponível",
    rating: place.rating ?? null,
    phone: place.nationalPhoneNumber || "",
    website: place.websiteUri || "",
  }));
}

async function fetchPlacesPage(
  apiKey: string,
  textQuery: string,
  pageToken?: string
): Promise<{ data: PlacesResponse; ok: boolean }> {
  const requestBody: PlacesRequest = {
    textQuery,
    languageCode: "pt-BR",
    maxResultCount: 20,
  };
  if (pageToken) {
    requestBody.pageToken = pageToken;
  }

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
    const errorData = await response.json().catch(() => ({} as PlacesResponse));
    console.error("Erro da API do Google:", errorData);
    return { data: errorData, ok: false };
  }

  return { data: (await response.json()) as PlacesResponse, ok: true };
}

// Busca TODAS as páginas disponíveis de uma única consulta (auto-paginação)
async function fetchAllPages(apiKey: string, textQuery: string): Promise<PlaceResult[]> {
  const collected: PlaceResult[] = [];
  let pageToken: string | undefined = undefined;

  for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
    const { data, ok } = await fetchPlacesPage(apiKey, textQuery, pageToken);
    if (!ok) break;

    collected.push(...mapPlaces(data));

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return collected;
}

export async function POST(request: Request) {
  const blocked = rateLimit(request, "places-search", 10, 60 * 1000);
  if (blocked) return blocked;
  try {
    const { query, pageToken, deep, regions } = await request.json();

    if (!query || typeof query !== "string" || query.trim().length > 160) {
      return NextResponse.json({ error: "A query de busca é obrigatória" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "A chave da API do Google Places não está configurada no servidor (.env.local)" },
        { status: 500 }
      );
    }

    // ---------------------------------------------------------------
    // MODO BUSCA PROFUNDA (por bairros/regiões + auto-paginação)
    // ---------------------------------------------------------------
    if (deep) {
      // Monta a lista de consultas: a query base + uma para cada bairro/região informado.
      const cleanRegions: string[] = Array.isArray(regions)
        ? regions
            .map((r: unknown) => String(r).trim())
            .filter((r: string) => r.length > 0)
            .slice(0, MAX_REGIONS)
        : [];

      const queries = [query, ...cleanRegions.map((region) => `${query} ${region}`)];

      const dedup = new Map<string, PlaceResult>();
      for (const q of queries) {
        const pageResults = await fetchAllPages(apiKey, q);
        for (const r of pageResults) {
          if (r.id && !dedup.has(r.id)) {
            dedup.set(r.id, r);
          }
        }
      }

      return NextResponse.json({
        results: Array.from(dedup.values()),
        nextPageToken: null,
        deep: true,
        queriesRun: queries.length,
      });
    }

    // ---------------------------------------------------------------
    // MODO PADRÃO (página única — compatível com "Carregar Mais")
    // ---------------------------------------------------------------
    const { data, ok } = await fetchPlacesPage(apiKey, query, pageToken);
    if (!ok) {
      return NextResponse.json({ error: "Erro ao consultar a API do Google Places" }, { status: 500 });
    }

    return NextResponse.json({
      results: mapPlaces(data),
      nextPageToken: data.nextPageToken || null,
    });
  } catch (error) {
    console.error("Erro interno no /api/search:", error);
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 });
  }
}
