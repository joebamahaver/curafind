"use client";

import { useState, type ReactNode } from "react";
import { BookOpen, ChevronLeft, ChevronRight, FlaskConical, Microscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MedicalReport, MedicalRequest, MedicalStudy } from "@/lib/medical-research-types";

function ResultPages({ studies, label }: { studies: MedicalStudy[]; label: string }) {
  const [page, setPage] = useState(0);
  const index = Math.min(page, Math.max(0, studies.length - 1));
  return <div className="space-y-4">
    {studies.length > 0 && (
      <nav aria-label={label + " result pages"} className="flex items-center justify-between gap-3 border-b border-border pb-4">
        <Button type="button" variant="outline" size="sm" disabled={index === 0}
          aria-label={"Previous " + label.toLowerCase() + " result"} onClick={() => setPage(index - 1)}>
          <ChevronLeft aria-hidden="true" /><span className="hidden sm:inline">Previous</span>
        </Button>
        <p role="status" aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
          {label} {index + 1} of {studies.length}
        </p>
        <Button type="button" variant="outline" size="sm" disabled={index >= studies.length - 1}
          aria-label={"Next " + label.toLowerCase() + " result"} onClick={() => setPage(index + 1)}>
          <span className="hidden sm:inline">Next</span><ChevronRight aria-hidden="true" />
        </Button>
      </nav>
    )}
    <div key={index} tabIndex={0} aria-label={label + " page content"}
      className="max-h-[60svh] min-h-64 overflow-y-auto overscroll-contain pr-2 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-96">
      {studies[index] ? <StudyCard study={studies[index]} trial={label === "Trial"} />
        : <p className="text-sm text-muted-foreground">No applicable {label === "Trial" ? "trials" : "studies"} were returned. See the search limitations below.</p>}
    </div>
  </div>;
}

export function StudyCard({ study, trial }: { study: MedicalStudy; trial: boolean }): ReactNode {
  return <Card className="rounded-xl border border-border bg-white shadow-none ring-0">
    <CardHeader>
      <p className="text-xs text-muted-foreground">{study.id}{trial && " · " + study.eligibility.replaceAll("-", " ")}</p>
      <CardTitle className="text-lg leading-7">
        <a href={study.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">{study.title}</a>
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      <p className="whitespace-pre-wrap text-sm leading-7">{study.abstract ?? "No abstract or summary was provided by the source."}</p>
      <p className="text-xs text-muted-foreground"><span className="font-medium">Treatment:</span> {study.treatment ?? "Not identified"}</p>
      <p className="whitespace-pre-line text-sm leading-6">{study.explanation}</p>
      {study.uncertainties.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
        {study.uncertainties.map((uncertainty, index) => <li key={index}>{uncertainty}</li>)}
      </ul>}
      {trial && <p className="text-xs text-muted-foreground">The study team must confirm eligibility and site availability.</p>}
    </CardContent>
  </Card>;
}

export function ResearchResultsReader({ result, request }: { result: MedicalReport; request: MedicalRequest }) {
  return <section className="space-y-5">
    <p className="whitespace-pre-line text-sm leading-6">{result.summary}</p>
    <Tabs defaultValue={request.clinicalTrials ? "trials" : "research"} data-results-reader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList aria-label="Research chapters">
          {request.clinicalTrials && <TabsTrigger value="trials"><Microscope className="size-4" aria-hidden="true" />Trials ({result.trials.length})</TabsTrigger>}
          {request.offLabelDrugsOrSupplements && <TabsTrigger value="research"><FlaskConical className="size-4" aria-hidden="true" />Research ({result.research.length})</TabsTrigger>}
        </TabsList>
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><BookOpen className="size-4" aria-hidden="true" />One result at a time</span>
      </div>
      <div className="rounded-r-2xl rounded-l-md border border-border border-l-4 border-l-primary/25 bg-[#fffdf8] p-4 shadow-[4px_4px_0_0_var(--muted),8px_8px_0_0_var(--border)] sm:p-6">
        {request.clinicalTrials && <TabsContent value="trials" keepMounted><ResultPages studies={result.trials} label="Trial" /></TabsContent>}
        {request.offLabelDrugsOrSupplements && <TabsContent value="research" keepMounted><ResultPages studies={result.research} label="Study" /></TabsContent>}
      </div>
    </Tabs>
    {result.limitations.length > 0 && <div className="space-y-2">
      <h3 className="text-sm font-medium">Search limitations</h3>
      <ul className="list-disc space-y-1 pl-5 text-xs leading-6 text-muted-foreground">
        {result.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}
      </ul>
    </div>}
  </section>;
}
