import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import SolveClient from "./SolveClient";

export const dynamic = "force-dynamic";

export default async function PracticePage({
  params,
}: {
  params: { attemptId: string };
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <SolveClient attemptId={params.attemptId} />;
}
