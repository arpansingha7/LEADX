import React from "react";

/** 5-star rating control (amber fill). Controlled via `value` / `onChange`. */
export function StarRating({ value = 0, onChange, max = 5, size = 28 }) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {Array.from({ length: max }, (_, i) => i + 1).map(n => (
        <button key={n} type="button" className="pd-star" aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => onChange && onChange(n)}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill={value >= n ? "var(--pd-star)" : "none"} stroke={value >= n ? "var(--pd-star)" : "var(--star-empty)"} strokeWidth="1.4">
            <path d="M12 2l2.9 6.26 6.6.86-4.9 4.6 1.27 6.78L12 17.9 6.13 20.5 7.4 13.72 2.5 9.12l6.6-.86L12 2z" />
          </svg>
        </button>
      ))}
    </div>
  );
}
