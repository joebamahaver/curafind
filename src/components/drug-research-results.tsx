import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DrugResearchResult } from "@/lib/drug-evaluation-types";

export function DrugResearchResults({ result, activeIndex }: { result: DrugResearchResult; activeIndex?: number }) {
  const articles = activeIndex === undefined ? result.topArticles : result.topArticles.slice(activeIndex, activeIndex + 1);
  return (
    <section aria-label="Top drug research results" className="space-y-4">
      <div>
        <h3 className="font-heading text-xl font-medium">Top drug research</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Evaluated {result.evaluatedCount} of {result.articlesSearched} retrieved articles.
          {" "}Showing {result.topArticles.length}, ranked by applicability, then efficacy.
        </p>
      </div>
      {result.failedCount > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {result.failedCount} {result.failedCount === 1 ? "study could" : "studies could"} not be evaluated.
        </p>
      )}
      {result.topArticles.length === 0 && (
        <p className="text-sm text-muted-foreground">No studies with usable abstracts were found for this condition.</p>
      )}
      {articles.map((article, index) => (
        <Card key={article.id} className="rounded-xl border border-border bg-white shadow-none ring-0">
          <CardHeader>
            <p className="text-xs text-muted-foreground">Result {(activeIndex ?? 0) + index + 1}</p>
            <CardTitle className="text-lg leading-7">
              <a href={article.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
                {article.title}<ArrowUpRight aria-hidden="true" className="ml-1 inline size-4" />
              </a>
            </CardTitle>
            <p className="text-xs text-muted-foreground">{[article.journal, article.publicationDate].filter(Boolean).join(" · ")}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/85">{article.abstract}</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Treatment:</span> {article.treatment ?? "Not identified in the abstract"}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">Applicability</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{article.applicableness}<span className="text-xs font-normal text-muted-foreground"> / 100</span></p>
              </div>
              <div className="rounded-lg bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">Estimated efficacy</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{article.efficacy}<span className="text-xs font-normal text-muted-foreground"> / 100</span></p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      {result.topArticles.length > 0 && (
        <p className="text-xs leading-5 text-muted-foreground">Scores are AI estimates from study abstracts. Efficacy is a rating, not a treatment success percentage.</p>
      )}
    </section>
  );
}
