import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { query } = await request.json();

    if (!query) {
      return NextResponse.json({ error: "A query de busca é obrigatória" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "A chave da API do Google Places não está configurada no servidor (.env.local)" },
        { status: 500 }
      );
    }

    // Usando a Text Search API (New) do Google Places
    // https://developers.google.com/maps/documentation/places/web-service/text-search
    const url = "https://places.googleapis.com/v1/places:searchText";
    
    const requestBody = {
      textQuery: query,
      languageCode: "pt-BR",
      maxResultCount: 20, // Limite de resultados por requisição (max 20)
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        // Especifique os campos que você deseja que a API retorne (isso impacta no custo)
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.nationalPhoneNumber,places.websiteUri",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Erro da API do Google:", errorData);
      return NextResponse.json({ error: "Erro ao consultar a API do Google Places" }, { status: 500 });
    }

    const data = await response.json();

    // Mapear os resultados para o formato esperado pelo frontend
    const results = (data.places || []).map((place: any) => ({
      id: place.id,
      name: place.displayName?.text || "Nome Indisponível",
      address: place.formattedAddress || "Endereço Indisponível",
      rating: place.rating || null,
      phone: place.nationalPhoneNumber || "",
      website: place.websiteUri || "",
    }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Erro interno no /api/search:", error);
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 });
  }
}
