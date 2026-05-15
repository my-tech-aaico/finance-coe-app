import { requireUser } from "@/lib/session";
import { Sidebar } from "./_components/Sidebar";
import { Header } from "./_components/Header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <Sidebar role={user.role} />
      <div
        id="main-wrapper"
        className="flex-1 transition-all duration-300"
        style={{ marginLeft: 256 }}
      >
        <Header userName={user.name} userRole={user.role} />
        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </div>
    </div>
  );
}
