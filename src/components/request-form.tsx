"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Lightbulb, PencilLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type SearchRequest = {
  condition: string;
  clinicalTrials: boolean;
  offLabelDrugsOrSupplements: boolean;
};

type RequestFormProps = {
  initialValue?: string;
  label?: string;
  placeholder?: string;
  suggestions?: string[];
  onSubmit?: (data: SearchRequest) => void;
};

export function RequestForm({
  initialValue = "",
  label = "What rare disease do you have?",
  placeholder = "Cystic fibrosis",
  suggestions = ["HIV/AIDS", "Alcohol Addiction", "Bipolar disorder"],
  onSubmit,
}: RequestFormProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState<SearchRequest>({
    condition: initialValue.slice(0, 200),
    clinicalTrials: true,
    offLabelDrugsOrSupplements: true,
  });
  const [submitted, setSubmitted] = useState<SearchRequest | null>(null);
  const canSubmit = Boolean(formData.condition.trim()) &&
    (formData.clinicalTrials || formData.offLabelDrugsOrSupplements);

  function setCondition(condition: string) {
    setFormData((current) => ({ ...current, condition }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    const data: SearchRequest = { ...formData, condition: formData.condition.trim() };
    setSubmitted(data);
    onSubmit?.(data);
  }

  return (
    <Card className="gap-0 rounded-2xl border border-border bg-white py-0 shadow-[0_8px_40px_-16px_rgba(44,35,21,0.12)] ring-0">
      {submitted === null ? (
        <form onSubmit={handleSubmit}>
          <CardHeader className="px-6 pt-7 sm:px-8 sm:pt-8">
            <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-[#faf9f6] text-primary"><PencilLine className="size-5" aria-hidden="true" /></span>
          </CardHeader>
          <CardContent className="px-6 pt-7 pb-7 sm:px-8">
            <Field className="gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor={id} className="text-sm font-medium">{label}</FieldLabel>
                <span className="text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">{formData.condition.length}/200</span>
              </div>
              <Input ref={inputRef} id={id} name="condition" value={formData.condition}
                onValueChange={setCondition}
                placeholder={placeholder} required maxLength={200}
                aria-describedby={`${id}-hint`}
                className="h-13 rounded-lg border border-border bg-white px-4 text-base placeholder:text-muted-foreground/75 focus-visible:border-primary/60 focus-visible:ring-primary/10 sm:text-sm"
              />
              <FieldDescription id={`${id}-hint`} className="text-xs">Input your condition.</FieldDescription>
            </Field>

            {suggestions.length > 0 && (
              <div className="mt-6">
                <p className="mb-2.5 flex items-center gap-1.5 text-xs text-muted-foreground"><Lightbulb className="size-3.5" aria-hidden="true" />Some examples</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((suggestion) => (
                    <Button key={suggestion} type="button" variant="outline" size="sm" className="h-8 border-border bg-[#faf9f6] px-3 text-[11px] font-normal text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                      onClick={() => { setCondition(suggestion.slice(0, 200)); inputRef.current?.focus(); }}>
                      {suggestion}<span aria-hidden="true" className="text-muted-foreground/60">↗</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <fieldset className="mt-7 space-y-3" aria-describedby={`${id}-options-hint`}>
              <legend className="mb-3 text-sm font-medium">What would you like to search?</legend>
              <FieldLabel htmlFor={`${id}-trials`} className="cursor-pointer text-sm font-normal">
                <Checkbox id={`${id}-trials`} name="clinicalTrials" checked={formData.clinicalTrials}
                  onCheckedChange={(clinicalTrials) => setFormData((current) => ({ ...current, clinicalTrials }))} />
                Clinical trials
              </FieldLabel>
              <FieldLabel htmlFor={`${id}-drugs`} className="cursor-pointer text-sm font-normal">
                <Checkbox id={`${id}-drugs`} name="offLabelDrugsOrSupplements" checked={formData.offLabelDrugsOrSupplements}
                  onCheckedChange={(offLabelDrugsOrSupplements) => setFormData((current) => ({ ...current, offLabelDrugsOrSupplements }))} />
                Off-label drugs or supplements
              </FieldLabel>
              <p id={`${id}-options-hint`} className="text-xs text-muted-foreground">Choose at least one option.</p>
            </fieldset>

            <Button type="submit" disabled={!canSubmit} className="mt-8 h-12 w-full rounded-lg text-sm shadow-sm">Search<ArrowRight className="ml-1 size-4" aria-hidden="true" /></Button>
          </CardContent>
        </form>
      ) : (
        <>
          <CardContent className="flex min-h-[397px] flex-col items-center justify-center px-6 py-10 text-center sm:px-8">
            <div className="relative mb-7 flex size-24 items-center justify-center" aria-hidden="true">
              <span className="absolute inset-0 rounded-full border border-primary/10" />
              <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary/70 motion-safe:animate-spin motion-safe:[animation-duration:2s]" />
              <span className="absolute inset-3 rounded-full border border-primary/15 motion-safe:animate-pulse" />
              <span className="flex size-14 items-center justify-center rounded-full bg-primary/7 text-primary"><Sparkles className="size-6 motion-safe:animate-pulse" /></span>
            </div>
            <h2 className="font-heading text-2xl font-medium tracking-tight">Answer saved</h2>
            <p role="status" className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">Your search request is ready for processing.</p>
            <div className="mt-6 w-full rounded-lg border border-border bg-[#faf9f6] px-4 py-3 text-left">
              <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Your input</span>
              <p className="mt-1 text-sm break-words">{submitted.condition}</p>
              <p className="mt-2 text-xs text-muted-foreground">{[
                submitted.clinicalTrials && "Clinical trials",
                submitted.offLabelDrugsOrSupplements && "Off-label drugs or supplements",
              ].filter(Boolean).join(" · ")}</p>
            </div>
          </CardContent>
          <CardFooter className="justify-center rounded-b-2xl border-t border-border bg-[#faf9f6]/70 px-6 py-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSubmitted(null)} className="text-xs text-muted-foreground"><PencilLine className="size-3.5" aria-hidden="true" />Edit input</Button>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
