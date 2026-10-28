import type { AiIssue, DiscardedIssue } from './trade-case.types';

/**
 * A model's issue is only as good as the words it can point to. These checks keep an issue only when
 * what it quotes is really in the document text: a claim like "the permit states 1 KGS" is dropped
 * when the permit says nothing of the kind. Dropped issues are not lost; they are listed on the
 * review so the desk can see what the AI said and why it was not used.
 */

/** Letters and digits only, lower case: "100,000 KGS" and "100000 kgs" are the same words. */
export function matchForm(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Quotes shorter than this say nothing ("1" is in every document). */
const MIN_QUOTE = 4;

/** Whether the words are in the text (compared by letters and digits only). */
export function quoteIsInText(quote: string, textForm: string): boolean {
  const form = matchForm(quote);
  return form.length >= MIN_QUOTE && textForm.includes(form);
}

/** The separate pieces of an evidence string: what is inside quotation marks, else the lines or ; | parts. */
export function evidenceSegments(evidence: string): string[] {
  const quoted = [...evidence.matchAll(/["“”]([^"“”]{2,})["“”]/g)].map((m) => m[1]!.trim());
  const parts = quoted.length > 0 ? quoted : evidence.split(/[;|\n]+/).map((s) => s.trim());
  return parts.filter((s) => matchForm(s).length >= MIN_QUOTE);
}

/** Whether every piece that carries a figure is found; a piece of plain words may be a label the model added. */
function segmentsGrounded(segments: string[], textForm: string): boolean {
  if (segments.length === 0) return false;
  const found = segments.filter((s) => quoteIsInText(s, textForm));
  if (found.length === 0) return false;
  return segments.every((s) => found.includes(s) || !/\d/.test(s));
}

/** Categories whose issue states a fact about the words in the document, so the words must be there. */
const NEEDS_WORDS = new Set<AiIssue['category']>(['DATA_INCONSISTENCY', 'LC_TERM_ISSUE']);
const NEEDS_WORDS_IF_GIVEN = new Set<AiIssue['category']>(['DOCUMENT_QUALITY', 'REGULATORY_CONCERN']);

export interface Verified {
  kept: AiIssue[];
  discarded: DiscardedIssue[];
}

/** The issues of a one-document review, checked against that document's text. */
export function verifyDocumentIssues(issues: AiIssue[], documentText: string): Verified {
  const textForm = matchForm(documentText);
  const kept: AiIssue[] = [];
  const discarded: DiscardedIssue[] = [];
  for (const issue of issues) {
    const segments = evidenceSegments(issue.evidence);
    const required = NEEDS_WORDS.has(issue.category) || (NEEDS_WORDS_IF_GIVEN.has(issue.category) && issue.evidence.trim().length > 0);
    if (required && segments.length === 0) {
      discarded.push({ title: issue.title, description: issue.description, reason: 'The AI quoted no words from the document for this point.' });
    } else if (required && !segmentsGrounded(segments, textForm)) {
      discarded.push({ title: issue.title, description: issue.description, reason: 'The words the AI quoted are not in the document.' });
    } else {
      kept.push(issue);
    }
  }
  return { kept, discarded };
}

const fileForm = (name: string): string => matchForm(name.replace(/\.[a-z0-9]+$/i, ''));

/** The document a quote names: by file name, tolerating a missing extension or a shortened name. */
function documentFor(file: string, texts: Map<string, string>): string | null {
  const wanted = fileForm(file);
  if (!wanted) return null;
  for (const name of texts.keys()) {
    const have = fileForm(name);
    if (have === wanted || have.includes(wanted) || wanted.includes(have)) return name;
  }
  return null;
}

/**
 * The issues of the review of documents against each other. Each must quote the words from the
 * documents it is about; a difference between documents needs words from two different ones. Every
 * quote must be found in the document it names.
 */
export function verifyCaseIssues(issues: AiIssue[], documentTexts: Map<string, string>): Verified {
  const forms = new Map([...documentTexts].map(([name, text]) => [name, matchForm(text)]));
  const kept: AiIssue[] = [];
  const discarded: DiscardedIssue[] = [];
  for (const issue of issues) {
    const quotes = issue.quotes ?? [];
    const drop = (reason: string) => discarded.push({ title: issue.title, description: issue.description, reason });
    const unplaced = quotes.filter((q) => !documentFor(q.file, documentTexts));
    const missing = quotes.filter((q) => {
      const name = documentFor(q.file, documentTexts);
      return name !== null && !quoteIsInText(q.text, forms.get(name)!);
    });
    if (unplaced.length > 0) drop(`The AI named a file that is not in this request (${unplaced[0]!.file}).`);
    else if (missing.length > 0) drop(`The words the AI quoted from ${missing[0]!.file} are not in that document.`);
    else if (issue.category === 'DATA_INCONSISTENCY' && new Set(quotes.map((q) => documentFor(q.file, documentTexts))).size < 2) {
      drop('A difference between documents needs the words of both documents, and the AI quoted fewer than two.');
    } else {
      // The evidence shown is the verified quotes, file by file.
      const verified = quotes.map((q) => ({ file: documentFor(q.file, documentTexts)!, text: q.text }));
      kept.push({ ...issue, quotes: verified, evidence: verified.map((q) => `${q.file}: "${q.text}"`).join('\n') });
    }
  }
  return { kept, discarded };
}
