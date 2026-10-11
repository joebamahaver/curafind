export async function resolveDisease(diagnosis: string) {
  const url = new URL(
    "https://www.ebi.ac.uk/ols4/api/search"
  );

  url.searchParams.set("q", diagnosis);
  url.searchParams.set("ontology", "mondo");
  url.searchParams.set("exact", "true");
  url.searchParams.set("rows", "10");

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error("Disease terminology lookup failed");
  }

  const data = await response.json();

  const documents = data.response?.docs ?? [];
  console.log("MONDO search results:", JSON.stringify(documents, null, 2));

  const match = documents.find(
    (doc: { label?: string }) =>
      doc.label?.toLowerCase() === diagnosis.toLowerCase()
  );

  if (!match) {
    return {
      name: diagnosis,
      synonyms: [],
    };
  }

  const isBareAcronym = (term: string) => {
    const t = term.trim();
    return !/\s/.test(t) && t.length <= 5;
  };

  const synonyms = [
    ...new Set(
      [...(match.exact_synonyms ?? []), ...(match.related_synonyms ?? [])]
        .filter((s: string) => !isBareAcronym(s))
        .filter((s: string) => s.toLowerCase() !== match.label.toLowerCase())
    ),
  ];

  return {
    name: match.label,
    id: match.obo_id,
    synonyms,
  };
}