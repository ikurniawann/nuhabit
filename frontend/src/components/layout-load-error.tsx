export function LayoutLoadError({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-lg border border-gray-200/70 bg-white p-8 text-center shadow-xs">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        <p className="mt-3 break-words text-sm text-gray-600">{message}</p>
      </div>
    </div>
  );
}
