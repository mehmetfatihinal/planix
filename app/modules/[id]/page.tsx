import { ModulePage } from "@/components/pages/dashboard-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ModulePage moduleId={id} />;
}
