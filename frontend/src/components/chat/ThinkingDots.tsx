export function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1 px-0.5">
      {[0, 0.2, 0.4].map((delay) => (
        <span
          key={delay}
          className="w-1.5 h-1.5 rounded-full bg-[#484f58]"
          style={{ animation: `blink 1.4s ${delay}s step-start infinite` }}
        />
      ))}
    </div>
  );
}
