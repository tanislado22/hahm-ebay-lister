"use client";

export function RotatePhotoButton({
  busy = false,
  overlay = false,
  onRotate,
}: {
  busy?: boolean;
  overlay?: boolean;
  onRotate: () => void;
}) {
  return (
    <button
      type="button"
      className={overlay ? "thumb-rotate" : "btn btn-ghost thumb-rotate-inline"}
      aria-label="Rotar foto"
      title="Rotar foto"
      disabled={busy}
      draggable={false}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onRotate();
      }}
    >
      ↻ Rotar foto
    </button>
  );
}
