import type { Metadata } from "next";
import { ArrowRight, Gamepad2 } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Games | Curafind",
  description: "Take a break with the Monkey physics playground.",
};

export default function GamesPage() {
  return (
    <div className="flex min-h-svh flex-col bg-[#faf9f6]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12 sm:px-10">
        <h1 className="font-heading text-4xl font-medium tracking-tight">Games</h1>
        <p className="mt-3 text-muted-foreground">Take a little break.</p>
        <Card className="mt-8 max-w-lg">
          <CardHeader>
            <Gamepad2 className="mb-3 size-8 text-primary" aria-hidden="true" />
            <CardTitle className="text-2xl">Monkey</CardTitle>
            <CardDescription>Explore a monkey physics playground with adjustable forces and live motion.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/monkey" className={buttonVariants()}>
              Play Monkey <ArrowRight aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
