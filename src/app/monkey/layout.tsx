import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MAX MONKEY | Curafind",
  description: "A living 3D jungle physics playground. Throw, experiment, and unleash MAX MONKEY.",
};

export default function MonkeyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
