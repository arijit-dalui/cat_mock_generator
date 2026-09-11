import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AnalysisClient from "./AnalysisClient";

export const dynamic = "force-dynamic";

export default async function AnalysisPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <AnalysisClient username={user.username} />;
}
