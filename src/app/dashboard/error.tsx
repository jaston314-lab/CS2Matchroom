"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-md mx-auto mt-16 text-center space-y-4">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-red-300 rounded-lg border border-red-900 bg-red-950/60 px-3 py-2">
        {error.message || "Unexpected error"}
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-white font-medium transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
