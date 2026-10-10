"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, CheckCheck, Lightbulb, PencilLine, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type RequestFormProps = {
  initialValue?: string;
  label?: string;
  placeholder?: string;
  suggestions?: string[];
  onSubmit?: (value: string, signal: AbortSignal) => Promise<void>;
};

// Replace this demo handler with an async onSubmit prop to connect real work.
function demoSubmit(_value: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 4000);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function RequestForm({
  initialValue = "",
  label = "What rare disease do you have?",
  placeholder = "Csytic Fibrosis",
  suggestions = ["HIV/AIDS", "Alcohol Addiction", "Bipolar disorder"],
  onSubmit = demoSubmit,
}: RequestFormProps) {
  const id = useId();
  const [value, setValue] = useState(initialValue.slice(0, 200));
  const [submittedValue, setSubmittedValue] = useState("");
  const [status, setStatus] = useState<"idle" | "waiting" | "complete">("idle");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLHeadingElement>(null);
  const previousStatus = useRef(status);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (status !== "idle") statusRef.current?.focus();
    else if (previousStatus.current !== "idle") inputRef.current?.focus();
    previousStatus.current = status;
  }, [status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedValue = value.trim();
    if (!trimmedValue || controller.current) return;

    const request = new AbortController();
    controller.current = request;
    setError("");
    setSubmittedValue(trimmedValue);
    setStatus("waiting");

    try {
      await onSubmit(trimmedValue, request.signal);
      if (!request.signal.aborted) setStatus("complete");
    } catch {
      if (!request.signal.aborted) {
        setError("Something went wrong. Your input is saved here—please try again.");
        setStatus("idle");
      }
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }

  function editInput() {
    controller.current?.abort();
    controller.current = null;
    setStatus("idle");
  }

  return (
    <Card className="gap-0 rounded-2xl border border-border bg-white py-0 shadow-[0_8px_40px_-16px_rgba(44,35,21,0.12)] ring-0">
      {status === "idle" ? (
        <form onSubmit={handleSubmit}>
          <CardHeader className="gap-2 px-6 pt-7 sm:px-8 sm:pt-8">
            <span className="mb-2 flex size-10 items-center justify-center rounded-xl border border-border bg-[#faf9f6] text-primary"><PencilLine className="size-5" aria-hidden="true" /></span>
          </CardHeader>

          <CardContent className="px-6 pt-7 pb-7 sm:px-8">
            <Field className="gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor={id} className="text-sm font-medium">{label}</FieldLabel>
                <span className="text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">{value.length}/200</span>
              </div>
              <Input ref={inputRef} id={id} name="request" value={value}
                onChange={(event) => { setValue(event.target.value); setError(""); }}
                placeholder={placeholder} required maxLength={200}
                aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
                className="h-13 rounded-lg border border-border bg-white px-4 text-base placeholder:text-muted-foreground/75 focus-visible:border-primary/60 focus-visible:ring-primary/10 sm:text-sm"
              />
              <FieldDescription id={`${id}-hint`} className="text-xs">Input your condition.</FieldDescription>
              {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
            </Field>

            {suggestions.length > 0 && (
              <div className="mt-6">
                <p className="mb-2.5 flex items-center gap-1.5 text-xs text-muted-foreground"><Lightbulb className="size-3.5" aria-hidden="true" />Some examples</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((suggestion) => (
                    <Button key={suggestion} type="button" variant="outline" size="sm" className="h-8 border-border bg-[#faf9f6] px-3 text-[11px] font-normal text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                      onClick={() => { setValue(suggestion.slice(0, 200)); setError(""); inputRef.current?.focus(); }}>
                      {suggestion}<span aria-hidden="true" className="text-muted-foreground/60">↗</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <Button type="submit" disabled={!value.trim()} className="mt-8 h-12 w-full rounded-lg text-sm shadow-sm">Find clinical trials & off-label meds<ArrowRight className="ml-1 size-4" aria-hidden="true" /></Button>
          </CardContent>
        </form>
      ) : (
        <>
          <CardContent className="flex min-h-[397px] flex-col items-center justify-center px-6 py-10 text-center sm:px-8" aria-busy={status === "waiting"}>
            <div className="relative mb-7 flex size-24 items-center justify-center" aria-hidden="true">
              {status === "waiting" ? (
                <>
                  <span className="absolute inset-0 rounded-full border border-primary/10" />
                  <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary/70 motion-safe:animate-spin motion-safe:[animation-duration:2s]" />
                  <span className="absolute inset-3 rounded-full border border-primary/15 motion-safe:animate-pulse" />
                  <span className="flex size-14 items-center justify-center rounded-full bg-primary/7 text-primary"><Sparkles className="size-6 motion-safe:animate-pulse" /></span>
                </>
              ) : (
                <span className="flex size-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCheck className="size-8" /></span>
              )}
            </div>
            <h2 ref={statusRef} tabIndex={-1} className="font-heading text-2xl font-medium tracking-tight outline-none">{status === "waiting" ? "Searching" : "All set. Nicely done."}</h2>
            <p role="status" aria-live="polite" className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{status === "waiting" ? "Working on your input. Hang tight, we’ll be ready in a moment." : "Your input has been submitted successfully."}</p>
            <div className="mt-6 w-full rounded-lg border border-border bg-[#faf9f6] px-4 py-3 text-left">
              <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Your input</span>
              <p className="mt-1 text-sm break-words">{submittedValue}</p>
            </div>
          </CardContent>
          <CardFooter className="justify-center rounded-b-2xl border-t border-border bg-[#faf9f6]/70 px-6 py-3">
            <Button type="button" variant="ghost" size="sm" onClick={editInput} className="text-xs text-muted-foreground">
              {status === "waiting" ? <PencilLine className="size-3.5" aria-hidden="true" /> : <RotateCcw className="size-3.5" aria-hidden="true" />}
              {status === "waiting" ? "Cancel and edit input" : "Another one"}
            </Button>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
