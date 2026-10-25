"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { PublicImage, Provider } from "@/lib/gallery";

interface ApiError {
  provider: Provider;
  error: string;
}

interface ImageResponse {
  images: PublicImage[];
  errors: ApiError[];
}

async function requestJson(url: string, body?: Record<string, unknown>): Promise<ImageResponse> {
  const response = await fetch(url, body
    ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
    : undefined);
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null) {
    throw new Error("The server returned an invalid response.");
  }
  const data = result as Partial<ImageResponse> & { error?: string };
  if (!response.ok && !data.images?.length && !data.errors?.length) {
    throw new Error(data.error || "The request failed.");
  }
  return { images: data.images ?? [], errors: data.errors ?? [] };
}

export default function Gallery() {
  const [images, setImages] = useState<PublicImage[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [theme, setTheme] = useState("");
  const [status, setStatus] = useState("");
  const [statusIsError, setStatusIsError] = useState(false);
  const [errors, setErrors] = useState<ApiError[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [varyingIds, setVaryingIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/images")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load saved gallery images.");
        return response.json() as Promise<{ images: PublicImage[] }>;
      })
      .then((result) => {
        if (!active) return;
        setImages(result.images);
        setSelectedGroupId(result.images[0]?.groupId ?? null);
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "Could not load gallery images.", true);
      });
    return () => {
      active = false;
    };
  }, []);

  function setMessage(message: string, isError = false) {
    setStatus(message);
    setStatusIsError(isError);
  }

  const currentGroupId = selectedGroupId ?? images[0]?.groupId;
  const winnerId = useMemo(() => {
    const candidates = currentGroupId
      ? images.filter((image) => image.groupId === currentGroupId)
      : images;
    return candidates.reduce<PublicImage | null>(
      (best, image) => image.qualityScore > (best?.qualityScore ?? -1) ? image : best,
      null,
    )?.id;
  }, [images, currentGroupId]);

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = theme.trim();
    if (!prompt) return;
    setIsGenerating(true);
    setMessage("Creating your image with OpenRouter…");
    setErrors([]);
    try {
      const result = await requestJson("/api/generate", { theme: prompt });
      setImages((current) => [...result.images, ...current]);
      setSelectedGroupId(result.images[0]?.groupId ?? null);
      setErrors(result.errors);
      setMessage(
        result.images.length
          ? `Added ${result.images.length} new ${result.images.length === 1 ? "study" : "studies"} to your gallery.`
          : "No images were generated.",
        !result.images.length,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Image generation failed.", true);
    } finally {
      setIsGenerating(false);
    }
  }

  async function createVariations(image: PublicImage) {
    setVaryingIds((current) => [...current, image.id]);
    setMessage(`Creating variations of the ${image.provider} selection…`);
    setErrors([]);
    try {
      const result = await requestJson("/api/variations", { imageId: image.id, count: 2 });
      setImages((current) => [...result.images, ...current]);
      setSelectedGroupId(image.groupId);
      setErrors(result.errors);
      setMessage(
        result.images.length
          ? `Added ${result.images.length} variation${result.images.length === 1 ? "" : "s"}.`
          : "No variations were generated.",
        !result.images.length,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Image variations failed.", true);
    } finally {
      setVaryingIds((current) => current.filter((id) => id !== image.id));
    }
  }

  return (
    <>
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Atelier home">
          <span className="mark">A</span> ATELIER<span className="wordmark-note"> / GENERATIVE STUDIO</span>
        </a>
        <span className="edition">IMAGE STUDIES · 001</span>
      </header>

      <main>
        <section className="hero">
          <p className="eyebrow"><span className="live-dot" /> ONE CREATIVE ENGINE. ENDLESS IDEAS.</p>
          <h1>Make something<br /><em>unexpected.</em></h1>
          <p className="intro">Give OpenRouter&apos;s image models a direction and see where the idea takes you.</p>
          <form className="prompt-form" onSubmit={handleGenerate}>
            <label className="sr-only" htmlFor="theme">Your creative direction</label>
            <input
              id="theme"
              name="theme"
              type="text"
              maxLength={180}
              placeholder="e.g. a greenhouse on the moon, 1920s botanical illustration"
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
              required
            />
            <button type="submit" disabled={isGenerating}>
              <span>{isGenerating ? "Creating…" : "Generate"}</span><span aria-hidden="true">↗</span>
            </button>
          </form>
          <div className={`status${statusIsError ? " error" : ""}`} role="status" aria-live="polite">{status}</div>
          <div className="providers" aria-label="Image generation service">
            <span><i className="provider-dot openrouter" /> OpenRouter</span>
          </div>
        </section>

        <section className="gallery-section" aria-labelledby="gallery-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE COLLECTION</p>
              <h2 id="gallery-title">Your gallery<span className="count">{images.length ? `(${images.length})` : ""}</span></h2>
            </div>
            <p className="section-note">Selected automatically by image detail, sharpness<br />and resolution. A useful signal, not a substitute for taste.</p>
          </div>
          {errors.length > 0 && (
            <div className="errors" role="alert">
              {errors.map((error, index) => <p key={`${error.provider}-${index}`}>{error.provider}: {error.error}</p>)}
            </div>
          )}
          {images.length > 0 ? (
            <div className="gallery">
              {images.map((image) => (
                <article className="card" key={image.id}>
                  <div className="image-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.url} alt={`${image.theme}, generated with ${image.provider}`} loading="lazy" />
                    {image.id === winnerId && <span className="winner">✳ BEST MATCH</span>}
                    {image.variationOf && <span className="variation-badge">VARIATION</span>}
                  </div>
                  <div className="card-info">
                    <div className="image-meta">
                      <span className="source">{image.provider}</span>
                      <span>{image.quality.resolution}</span>
                    </div>
                    <p className="theme-label" title={image.theme}>{image.theme}</p>
                    <div className="card-footer">
                      <span className="quality">QUALITY <strong>{image.qualityScore}/100</strong></span>
                      <button
                        type="button"
                        className="vary-button"
                        onClick={() => createVariations(image)}
                        disabled={varyingIds.includes(image.id)}
                      >
                        {varyingIds.includes(image.id) ? "Creating…" : "↗ Vary this"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-symbol">✳</span>
              <p>Your first study is waiting.</p>
              <span>Try “a quiet library at the edge of the universe”</span>
            </div>
          )}
        </section>
      </main>

      <footer>
        <span>ATELIER — A STUDY IN MACHINE IMAGINATION</span>
        <span>ONE MODEL, INFINITE DIRECTIONS.</span>
      </footer>
    </>
  );
}
