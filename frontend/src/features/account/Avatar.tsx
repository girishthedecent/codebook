import { useState } from 'react';

/** A round picture of the person, or the first letter of their name when there is none. */
export function Avatar({
  name,
  image,
  size = 48,
}: {
  name: string;
  image?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (image && !failed) {
    return (
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full bg-paper-3 object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-paper-3 font-serif text-lg font-semibold text-ink-2"
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
