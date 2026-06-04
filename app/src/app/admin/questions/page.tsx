import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import QuestionsClient from "./QuestionsClient";

export const dynamic = "force-dynamic";

export default async function AdminQuestionsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");
  return <QuestionsClient username={user.username} />;
}
