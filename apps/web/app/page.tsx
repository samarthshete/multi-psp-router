export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
          multi-psp-router
        </p>
        <h1 className="mt-3 text-4xl font-semibold text-slate-950">
          Next.js is running
        </h1>
      </div>
      <p className="max-w-xl text-base text-slate-600">
        Start building the App Router web experience in <code>apps/web</code>.
      </p>
    </main>
  );
}
