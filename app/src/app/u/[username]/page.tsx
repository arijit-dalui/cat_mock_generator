import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import PublicProfileClient from "./PublicProfileClient";

export const dynamic = "force-dynamic";

export default async function PublicProfilePage({ params }: { params: { username: string } }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <PublicProfileClient username={params.username} viewerUsername={user.username} />;
}
