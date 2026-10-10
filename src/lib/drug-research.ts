// Delay requests because PubMed can't handle the swag
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
import { XMLParser } from "fast-xml-parser"; // XML parser for PubMed article data


 // Search PubMed for experimental drugs and stuff
export async function searchDrugResearch(diagnosis: string) {
  const disease = `"${diagnosis}"[Title/Abstract]`;

  const searchQueries = [
    {
      category: "experimental",
      term: `${disease} AND (investigational[Title/Abstract] OR experimental[Title/Abstract] OR "novel drug"[Title/Abstract])`,
    },
    {
      category: "clinical_trials",
      term: `${disease} AND ("Clinical Trial"[Publication Type] OR "phase 2"[Title/Abstract] OR "phase 3"[Title/Abstract]) AND (drug[Title/Abstract] OR treatment[Title/Abstract])`,
    },
    {
      category: "repurposing",
      term: `${disease} AND ("drug repurposing"[Title/Abstract] OR "drug repositioning"[Title/Abstract] OR off-label[Title/Abstract])`,
    },
  ];

  const results: string[][] = [];

  for (const query of searchQueries) {
    await sleep(400); //the delay
    const url = new URL(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    );

    url.searchParams.set("db", "pubmed");
    url.searchParams.set("term", query.term);
    url.searchParams.set("retmode", "json");
    url.searchParams.set("retmax", "8");

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `PubMed search failed: ${query.category} (HTTP ${response.status})`
      );
    }

    const data = await response.json();
    results.push(data.esearchresult.idlist as string[]);
  }

  // Remove duplicate papers
  return [...new Set(results.flat())];
}

// Retrieve article titles and stuff
export async function getArticleDetails(articleIds: string[]) {
  if (articleIds.length === 0) {
    await sleep(400); //the delay
    return [];
  }

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
  });

  const data = parser.parse(xml);
  const record = data.PubmedArticleSet?.PubmedArticle;

  if (!record) {
    throw new Error("PubMed article not found");
  }

  const rawAbstract =
    record.MedlineCitation?.Article?.Abstract?.AbstractText;

  // Convert XML abstract sections into text
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
