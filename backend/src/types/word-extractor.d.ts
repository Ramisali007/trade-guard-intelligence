/**
 * `word-extractor` ships no types. Rather than reaching for `any` at the call site, the surface
 * the legacy `.doc` extractor actually uses is declared here — so a change in how that extractor
 * calls the library is still a type error rather than a runtime surprise.
 */
declare module 'word-extractor' {
  /** A parsed `.doc` file. Each accessor returns the text of one part of the document. */
  class Document {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(): string;
    getFooters(): string;
    getAnnotations(): string;
    getTextboxes(): string;
  }

  class WordExtractor {
    extract(source: string | Buffer): Promise<Document>;
  }

  export = WordExtractor;
}