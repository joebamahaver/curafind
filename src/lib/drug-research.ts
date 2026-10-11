
import { resolveDisease } from "./disease-resolver";
import { XMLParser } from "fast-xml-parser";

// Delay requests to respect PubMed rate limits
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Search PubMed for experimental drugs and treatments
export async function searchDrugResearch(diagnosis: string) {
  // Resolve disease terminology using MONDO
  const disease = await resolveDisease(diagnosis);

  // Combine the official disease name with its synonyms
  const searchTerms = [
    disease.name,
    ...disease.synonyms,
  ];

  // Remove duplicates and build a PubMed-compatible query
  const diseaseQuery = [
    ...new Set(
      searchTerms
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
    ),
  ]
    .map((term) => `"${term.replace(/"/g, "")}"[Title/Abstract]`)
    .join(" OR ");

  console.log("Resolved disease:", disease);
  console.log("Expanded disease query:", diseaseQuery);

  // Search three categories of medical research
  const searchQueries = [
    {
      category: "experimental",
      term: `(${diseaseQuery}) AND (investigational[Title/Abstract] OR experimental[Title/Abstract] OR "novel drug"[Title/Abstract])`,
    },
    {
      category: "clinical_trials",
      term: `(${diseaseQuery}) AND ("Clinical Trial"[Publication Type] OR "phase 2"[Title/Abstract] OR "phase 3"[Title/Abstract]) AND (drug[Title/Abstract] OR treatment[Title/Abstract])`,
    },
    {
      category: "repurposing",
      term: `(${diseaseQuery}) AND ("drug repurposing"[Title/Abstract] OR "drug repositioning"[Title/Abstract] OR off-label[Title/Abstract])`,
    },
  ];

  const results: string[][] = [];

  for (const query of searchQueries) {
    await sleep(400);

    const url = new URL(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    );

    url.searchParams.set("db", "pubmed");
    url.searchParams.set("term", query.term);
    url.searchParams.set("retmode", "json");
    url.searchParams.set("retmax", "25");
    url.searchParams.set("sort", "relevance");

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `PubMed search failed: ${query.category} (HTTP ${response.status})`
      );
    }

    const data = await response.json();

    results.push(data.esearchresult.idlist as string[]);
  }

  // Remove duplicate PubMed IDs
  return [...new Set(results.flat())];
}

// Retrieve article titles and metadata
export async function getArticleDetails(articleIds: string[]) {
  if (articleIds.length === 0) {
    return [];
  }

  await sleep(400);

  const url = new URL(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
  );

  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", articleIds.join(","));
  url.searchParams.set("retmode", "json");

  const response = await fetch(url);

  if (!response.ok) {
    const errorBody = await response.text();

    throw new Error(
      `PubMed ESummary failed: HTTP ${response.status} ${response.statusText} - ${errorBody.slice(0, 500)}`
    );
  }

  const data = await response.json();

  return articleIds.map((id) => {
    const article = data.result[id];

    return {
      id,
      title: article?.title ?? "Unknown title",
      publicationDate: article?.pubdate ?? "Unknown date",
      journal: article?.fulljournalname ?? "Unknown journal",
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
    };
  });
}

// Retrieve and parse an individual PubMed article abstract
export async function readPubMedArticle(pmid: string) {
  if (!/^\d+$/.test(pmid)) {
    throw new Error("Invalid PubMed ID");
  }

  await sleep(400);

  const url = new URL(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
  );

  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", pmid);
  url.searchParams.set("retmode", "xml");

  const response = await fetch(url);

  if (!response.ok) {
    const errorBody = await response.text();

    throw new Error(
      `PubMed EFetch failed: HTTP ${response.status} ${response.statusText} - ${errorBody.slice(0, 500)}`
    );
  }

  const xml = await response.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    htmlEntities: true,
  });

  const data = parser.parse(xml);
  const record = data.PubmedArticleSet?.PubmedArticle;

  if (!record) {
    throw new Error("PubMed article not found");
  }

  const rawAbstract =
    record.MedlineCitation?.Article?.Abstract?.AbstractText;

  function extractText(value: unknown): string {
    if (value == null) return "";

    if (Array.isArray(value)) {
      return value.map(extractText).filter(Boolean).join(" ");
    }

    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const label = obj["@_Label"];

      const content = Object.entries(obj)
        .filter(([key]) => !key.startsWith("@_"))
        .map(([, child]) => extractText(child))
        .filter(Boolean)
        .join(" ");

      return label ? `${label}: ${content}` : content;
    }

    return String(value);
  }

  return {
    pmid,
    abstract: rawAbstract ? extractText(rawAbstract) : null,
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  };
}

// Retrieve abstracts for multiple PubMed articles
export async function readPubMedArticles(pmids: string[]) {
  if (pmids.length === 0) return [];

  const validIds = [...new Set(pmids)].filter(
    (id) => /^\d+$/.test(id)
  );

  if (validIds.length === 0) return [];

  await sleep(400);

  const url = new URL(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
  );

  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", validIds.join(","));
  url.searchParams.set("retmode", "xml");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `PubMed batch fetch failed: HTTP ${response.status}`
    );
  }

  const xml = await response.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    htmlEntities: true,
  });

  const data = parser.parse(xml);
  const records = data.PubmedArticleSet?.PubmedArticle;

  if (!records) return [];

  const articles = Array.isArray(records)
    ? records
    : [records];

  function extractText(value: unknown): string {
    if (value == null) return "";

    if (Array.isArray(value)) {
      return value.map(extractText).filter(Boolean).join(" ");
    }

    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const label = obj["@_Label"];

      const content = Object.entries(obj)
        .filter(([key]) => !key.startsWith("@_"))
        .map(([, child]) => extractText(child))
        .filter(Boolean)
        .join(" ");

      return label ? `${label}: ${content}` : content;
    }

    return String(value);
  }

  return articles.map((record) => {
    const citation = record.MedlineCitation;

    const pmid = String(
      citation?.PMID?.["#text"] ?? citation?.PMID ?? ""
    );

    const rawAbstract =
      citation?.Article?.Abstract?.AbstractText;

    return {
      pmid,
      abstract: rawAbstract
        ? extractText(rawAbstract)
        : null,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    };
  });
}

export async function getDrugCandidates(pmids: string[]) {
  // Only accept valid, unique PubMed IDs
  const validIds = [...new Set(pmids)].filter(
    (id) => /^\d+$/.test(id)
  );

  if (validIds.length === 0) return [];

  await sleep(400);

  // Fetch PubMed's existing chemical metadata
  const url = new URL(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
  );

  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", validIds.join(","));
  url.searchParams.set("retmode", "xml");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Drug candidate extraction failed: HTTP ${response.status}`
    );
  }

  const xml = await response.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    htmlEntities: true,
  });

  const data = parser.parse(xml);
  const records = data.PubmedArticleSet?.PubmedArticle;

  if (!records) return [];

  const articles = Array.isArray(records)
    ? records
    : [records];

  // Store each substance and its supporting article IDs
  const candidates = new Map<string, {
    name: string;
    articleIds: Set<string>;
  }>();

  for (const article of articles) {
    const citation = article.MedlineCitation;

    const pmid = String(
      citation?.PMID?.["#text"] ?? citation?.PMID ?? ""
    );

    if (!/^\d+$/.test(pmid)) continue;

    const rawChemicals =
      citation?.ChemicalList?.Chemical;

    if (!rawChemicals) continue;

    const chemicals = Array.isArray(rawChemicals)
      ? rawChemicals
      : [rawChemicals];

    for (const chemical of chemicals) {
      const rawName = chemical.NameOfSubstance;

      const name =
        typeof rawName === "string"
          ? rawName
          : rawName?.["#text"];

      if (typeof name !== "string") continue;

      const cleanedName = name.trim();

      if (!cleanedName) continue;

      const key = cleanedName.toLowerCase();

      if (!candidates.has(key)) {
        candidates.set(key, {
          name: cleanedName,
          articleIds: new Set<string>(),
        });
      }

      candidates.get(key)!.articleIds.add(pmid);
    }
  }

  // Sort by the number of articles mentioning each substance
  return [...candidates.values()]
    .map((candidate) => ({
      name: candidate.name,
      articleCount: candidate.articleIds.size,
      articleIds: [...candidate.articleIds],
    }))
    .sort((a, b) => b.articleCount - a.articleCount);
}
