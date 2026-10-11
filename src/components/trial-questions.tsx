"use client";

import { useId, useState, type FormEvent } from "react";
import type { PreparedTrialSearchResult } from "@/lib/trial-workflow";
import type { TrialAnswer } from "@/lib/trial-evaluation-types"
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";


type TrialQuestionsProps = {
  questions: PreparedTrialSearchResult["questions"];
  onSubmit?: (answers: TrialAnswer[]) => Promise<void> | void;
};

export function TrialQuestions({ questions, onSubmit }: TrialQuestionsProps) {
  const formId = useId();
  const [answers, setAnswers] = useState<Record<string, TrialAnswer["answer"]>>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function updateAnswer(id: string, answer: TrialAnswer["answer"]) {
    setAnswers((current) => ({ ...current, [id]: answer }));
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(
        questions.map(({ id, question }) => ({
          id,
          question,
          answer: answers[id] ?? null,
        })),
      );
    } catch {
      setError(
        "Could not submit your answers. Please try again. Your answers have been kept.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const answeredCount = questions.filter(
    ({ id }) => answers[id] != null,
  ).length;

  return (
    <section
      aria-labelledby={`${formId}-heading`}
      className="rounded-xl border border-border p-4 sm:p-5"
    >
      <h2 id={`${formId}-heading`} className="text-lg font-medium">
        Questions about trial eligibility
      </h2>
      {questions.length === 0 ? (
        <form onSubmit={handleSubmit} className="mt-2 space-y-3">
        <p className="text-sm text-muted-foreground">
          No questions were generated for these trials. This does not confirm
          eligibility.
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {onSubmit && <Button type="submit" disabled={submitting}>{submitting ? "Checking trials…" : "Continue without answers"}</Button>}
        </form>
      ) : (
        <>
          <p
            id={`${formId}-hint`}
            className="mt-2 text-sm leading-6 text-muted-foreground"
          >
            Answer what you know. Leave a field blank or choose “Not sure” if
            you don’t know.
          </p>
          <form
            onSubmit={handleSubmit}
            aria-describedby={`${formId}-hint`}
            className="mt-5 space-y-6"
          >
            <fieldset disabled={submitting} className="space-y-6">
              <legend className="sr-only">Trial eligibility questions</legend>
              {questions.map((question, index) => {
                const inputId = `${formId}-${question.id}`;
                const answer = answers[question.id] ?? null;
                const label = `${index + 1}. ${question.question}`;

                if (question.type === "yes-no") {
                  return (
                    <fieldset key={question.id} className="space-y-2">
                      <legend className="text-sm font-medium">{label}</legend>
                      <div className="flex flex-wrap gap-4">
                        {[
                          { label: "Yes", value: true },
                          { label: "No", value: false },
                          { label: "Not sure", value: null },
                        ].map((option) => (
                          <label
                            key={option.label}
                            className="flex cursor-pointer items-center gap-2 text-sm"
                          >
                            <input
                              type="radio"
                              name={inputId}
                              value={option.label}
                              checked={answer === option.value}
                              onChange={() =>
                                updateAnswer(question.id, option.value)
                              }
                              className="size-4 accent-primary"
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                }

                return (
                  <div key={question.id} className="space-y-2">
                    <label
                      htmlFor={inputId}
                      className="block text-sm font-medium"
                    >
                      {label}
                    </label>
                    {question.type === "number" ? (
                      <Input
                        id={inputId}
                        type="number"
                        step="any"
                        value={typeof answer === "number" ? answer : ""}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber;
                          updateAnswer(
                            question.id,
                            Number.isFinite(value) ? value : null,
                          );
                        }}
                        className="max-w-xs rounded-lg border-border"
                      />
                    ) : (
                      <textarea
                        id={inputId}
                        rows={3}
                        value={typeof answer === "string" ? answer : ""}
                        onChange={(event) =>
                          updateAnswer(
                            question.id,
                            event.target.value.trim()
                              ? event.target.value
                              : null,
                          )
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      />
                    )}
                  </div>
                );
              })}
            </fieldset>
            <p role="status" className="text-xs text-muted-foreground">
              {answeredCount} of {questions.length} answered
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {onSubmit && (
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? "Checking answers…"
                  : "Continue with these answers"}
              </Button>
            )}
          </form>
        </>
      )}
    </section>
  );
}
