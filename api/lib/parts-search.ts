type PartRow = {
  article?: string | null;
  brand?: string | null;
  name: string;
};

function normArticle(raw: string | null | undefined): string {
  return (raw || "").toLowerCase().replace(/\s/g, "");
}

function articleDigits(raw: string | null | undefined): string {
  return (raw || "").replace(/\D/g, "");
}

function isMostlyDigits(q: string): boolean {
  const compact = q.replace(/[\s\-./]/g, "");
  if (!compact) return false;
  return /^[\d]+$/.test(compact);
}

export function filterPartsBySearch<T extends PartRow>(
  parts: T[],
  search: string,
  opts?: { articleFocus?: boolean; limit?: number },
): T[] {
  const q = search.trim().toLowerCase();
  if (!q) return parts;

  const qNorm = normArticle(q);
  const qDigits = q.replace(/\D/g, "");
  const articleFocus = opts?.articleFocus ?? isMostlyDigits(q);
  const limit = opts?.limit ?? 50;

  const scored = parts
    .map((p) => {
      const art = (p.article || "").toLowerCase();
      const artNorm = normArticle(p.article);
      const artDig = articleDigits(p.article);
      const brand = (p.brand || "").toLowerCase();
      const name = p.name.toLowerCase();

      let score = 0;
      if (articleFocus && qDigits.length >= 1) {
        if (artNorm === qNorm || artDig === qDigits) score = 100;
        else if (artNorm.startsWith(qNorm) || artDig.startsWith(qDigits)) score = 90;
        else if (artNorm.includes(qNorm) || artDig.includes(qDigits)) score = 70;
        else if (name.includes(q)) score = 15;
        else if (brand.includes(q)) score = 10;
      } else {
        if (artNorm === qNorm) score = 100;
        else if (art.startsWith(q) || artNorm.startsWith(qNorm)) score = 85;
        else if (art.includes(q) || artNorm.includes(qNorm)) score = 65;
        if (name.includes(q)) score = Math.max(score, 50);
        if (brand.includes(q)) score = Math.max(score, 40);
        if (qDigits.length >= 4 && artDig.includes(qDigits)) score = Math.max(score, 75);
      }

      return { p, score };
    })
    .filter((row) => row.score > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return normArticle(a.p.article).localeCompare(normArticle(b.p.article));
  });

  return scored.slice(0, limit).map((row) => row.p);
}
