export function StreamingCursor() {
  return (
    <span
      className="inline-block w-[0.5em] h-[1em] bg-[#3fb950] ml-[1px] align-text-bottom"
      style={{ animation: "blink 1s step-start infinite" }}
      aria-hidden="true"
    />
  );
}
