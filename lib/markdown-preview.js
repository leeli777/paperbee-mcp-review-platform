const LATEX_SIGNAL = /\\[A-Za-z]+|[_^{}=]/;

/**
 * Normalize common AI-generated TeX delimiters before Markdown parsing.
 * The conversion is deliberately conservative so ordinary bracketed prose,
 * links, and code examples keep their original meaning.
 *
 * @param {string} markdown
 */
export function normalizeMarkdownForPreview(markdown) {
  return markdown
    .replace(/\r\n?/g, "\n")
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((segment, index) => (index % 2 === 1 ? segment : normalizeProse(segment)))
    .join("");
}

/** @param {string} prose */
function normalizeProse(prose) {
  return prose
    .split(/(`+[^`\n]*`+)/g)
    .map((segment, index) => (index % 2 === 1 ? segment : normalizeMath(segment)))
    .join("");
}

/** @param {string} text */
function normalizeMath(text) {
  return text
    // TeX display and inline delimiters commonly emitted by research AIs.
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, formula) => displayMath(formula))
    .replace(/\\\(([^\n]*?)\\\)/g, (_, formula) => `$${formula.trim()}$`)
    .replace(
      /\\begin\{(?:equation\*?|displaymath)\}\s*([\s\S]*?)\s*\\end\{(?:equation\*?|displaymath)\}/g,
      (_, formula) => displayMath(formula),
    )
    .replace(
      /\\begin\{align\*?\}\s*([\s\S]*?)\s*\\end\{align\*?\}/g,
      (_, formula) => displayMath(`\\begin{aligned}\n${formula.trim()}\n\\end{aligned}`),
    )
    // Some generators omit the backslashes around display brackets entirely.
    // Only treat the block as math when its contents carry a clear LaTeX signal.
    .replace(/^\s*\[\s*\n([\s\S]*?)\n\s*\]\s*$/gm, (match, formula) => (
      looksLikeLatex(formula) ? displayMath(formula) : match
    ))
    .replace(/^\s*\[\s*(.+?)\s*\]\s*$/gm, (match, formula) => (
      looksLikeLatex(formula) ? displayMath(formula) : match
    ));
}

/** @param {string} formula */
function looksLikeLatex(formula) {
  return LATEX_SIGNAL.test(formula) && /\\[A-Za-z]+/.test(formula);
}

/** @param {string} formula */
function displayMath(formula) {
  return `\n$$\n${formula.trim()}\n$$\n`;
}
