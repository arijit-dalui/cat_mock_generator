import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import MockClient from "./MockClient";

export const dynamic = "force-dynamic";

export default async function MockPage({ params }: { params: { mockId: string } }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <MockClient mockId={params.mockId} />;
}
