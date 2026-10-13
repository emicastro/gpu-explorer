/** Shown instead of the app when the core cannot start (the page would otherwise stay black). */
export function FatalError({ error }: { error: unknown }) {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    <div className="fatal-error" role="alert" data-testid="fatal-error">
      <h1>The explorer could not start</h1>
      <p>
        The calculation core failed to load. Reload the page; if it keeps failing, your browser may not
        support WebAssembly.
      </p>
      <pre>{detail}</pre>
    </div>
  );
}
