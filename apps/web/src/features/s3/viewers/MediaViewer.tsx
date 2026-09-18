/**
 * Objects the browser fetches for itself.
 *
 * Each element is handed a URL rather than bytes, so the fetch is the
 * browser's own: it ranges over the object as it plays or scrolls, and nothing
 * ever holds the whole thing.
 */
export function ImageViewer({ url, alt }: { url: string; alt: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-background/40 p-4">
      <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />
    </div>
  );
}

export function AudioViewer({ url }: { url: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <audio src={url} controls className="w-full max-w-xl" />
    </div>
  );
}

export function VideoViewer({ url }: { url: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background/40 p-4">
      <video src={url} controls className="max-h-full max-w-full" />
    </div>
  );
}

export function PdfViewer({ url, title }: { url: string; title: string }) {
  return (
    // The document is confined twice: the response carries a sandbox policy,
    // and the frame grants nothing back. A PDF still renders, because that is
    // the browser's own viewer rather than anything inside the file.
    <iframe src={url} title={title} sandbox="" className="min-h-0 flex-1 border-0 bg-white" />
  );
}
