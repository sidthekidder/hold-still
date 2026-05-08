export async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/png",
    );
  });
}

export async function downloadPNG(canvas: HTMLCanvasElement, filename = "hold-still.png"): Promise<void> {
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareCanvas(canvas: HTMLCanvasElement, url: string): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  const blob = await canvasToBlob(canvas);
  const file = new File([blob], "hold-still.png", { type: "image/png" });
  const data: ShareData = { files: [file], url, title: "Hold Still", text: "This is my tremor." };
  if (typeof nav.canShare === "function" && nav.canShare(data) && navigator.share) {
    try {
      await navigator.share(data);
      return true;
    } catch {
      return false;
    }
  }
  // Desktop fallback: copy URL.
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
  }
  return false;
}
