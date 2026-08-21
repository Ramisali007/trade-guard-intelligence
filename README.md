# DocuIntel AI — Enterprise Document Intelligence Platform

**DocuIntel AI** is a production-quality, AI-powered document intelligence and analysis web application built with **Angular (standalone components & signals)** on the frontend and **Node.js, Express, and TypeScript** on the backend.

It allows users to upload PDF or Word (`.doc`, `.docx`) documents of any size, automatically extracts and normalizes structural passages (headings, paragraphs, lists, tables, mathematical expressions), chunks large documents for parallel analysis, classifies each passage across multiple dimensions (Sentiment, Emotion, Content Type, Topic, Confidence), visualizes the results with interactive analytics dashboards, and generates structured `.txt` analysis reports.

---

## 🌟 Key Features

### 1. Document Extraction & Structural Chunking
- **Supported Formats**: PDF, Microsoft Word (`.doc` and `.docx`).
- **Context Preservation**: Retains document structure (Page #, Section headings, Paragraph #, Unit types).
- **Large Document Scalability**: Intelligently chunks hundreds or thousands of paragraphs into token-budgeted batches processed concurrently.

### 2. Multi-Dimensional AI Classification
- **Sentiment**: Positive, Negative, Neutral.
- **Emotion**: Happy, Sad, Angry, Excited, Fear, Surprise, Neutral.
- **Content Type**: Mathematical, Technical, Informational, Narrative, Question, Instruction, Opinion, Complaint, Feedback, Other.
- **Topic**: Finance, Technology, Healthcare, Education, Business, Legal, Marketing, Customer Support, Research, etc.
- **Confidence Scoring**: Exact probabilistic certainty score (0–100%) per paragraph.
- **Provider Agnostic**: Easily switch between **Anthropic Claude**, **OpenAI / OpenAI-Compatible** endpoints (e.g. GPT-4o-mini, Groq, Ollama, vLLM), or the built-in **Heuristic Lexicon Classifier** (zero-config, runs completely offline).

### 3. Modern SaaS Frontend Experience
- **Hero Dashboard**: Drag-and-drop document upload zone with file validations and real-time streaming upload progress.
- **Live Pipeline Tracker**: 7-stage animated backend progress bar with exact analyzed paragraph counters (`Analyzed: X / Y paragraphs`) and live ETAs.
- **Executive Summary**: Headline insight banner, narrative recap, key takeaways, and dominant tone badges.
- **Animated KPI Metric Cards**: Visual statistics counting up to the exact analyzed values.
- **Visual Analytics**:
  - **Sentiment Donut Chart** (interactive SVG arc segments with tooltips and percentages).
  - **Emotion Breakdown** (horizontal bar chart).
  - **Content Types & Topics Distribution** (bar charts).
  - **Document Progression Timeline** (page-by-page sentiment & classification flow).
- **Granular Document Explorer**:
  - Instant full-text search across paragraphs.
  - Multi-faceted filter system (Sentiment, Emotion, Content Type, Topic, Minimum Confidence).
  - Copy paragraph text and expand/collapse lengthy sections.
- **Report Downloader & Viewer**: Monospace in-browser report modal preview and one-click structured `.txt` report downloads.
- **Light / Dark Mode**: Full theme switching with automatic system detection.

---

## 🏗️ Architecture

```
/
├── backend/
│   ├── src/
│   │   ├── ai/                      # AI abstraction & providers (Anthropic, OpenAI, Heuristic)
│   │   ├── config/                  # Environment and system settings
│   │   ├── controllers/             # Express route controllers
│   │   ├── document-processing/     # Extractors (PDF, DOC, DOCX), Chunker, Segmenter, Normalizer
│   │   ├── middleware/              # Rate limit, Multer upload, Helmet security, Error handler
│   │   ├── models/                  # Document & Analysis data models
│   │   ├── routes/                  # REST API endpoints
│   │   ├── services/                # Analysis, Aggregation, Queue, Report, Repository services
│   │   ├── server.ts                # Server bootstrap
│   │   └── app.ts                   # Express application setup
│   ├── scripts/                     # Smoke tests and sample generators
│   ├── .env.example                 # Example configuration
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── models/              # TypeScript API contract interfaces
│   │   │   ├── pages/
│   │   │   │   ├── dashboard/       # Upload and documents overview
│   │   │   │   ├── processing/      # 7-stage real-time tracking page
│   │   │   │   └── analysis/        # Flagship analytics dashboard & paragraph explorer
│   │   │   ├── services/            # API, Documents, Theme, Toast, Taxonomy services
│   │   │   └── shared/
│   │   │       ├── components/      # DonutChart, BarChart, TimelineChart, KpiCard, Icon, ToastContainer, ReportModal
│   │   │       ├── format.ts        # Formatting helpers
│   │   │       └── palette.ts       # Accessible color-checked visual palette
│   │   ├── styles.scss              # Global design system & tokens
│   │   └── main.ts
│   ├── proxy.conf.json              # Dev server proxy configuration
│   └── package.json
```

---

## 🚀 Quick Start

### 1. Backend Setup

```bash
cd backend
npm install
```

Configure your environment:
```bash
cp .env.example .env
```
*(The backend runs out-of-the-box using the built-in offline Heuristic classifier if no external API key is provided).*

Run backend smoke tests:
```bash
npm run smoke
```

Start the backend server:
```bash
npm run dev
# Backend API will be available at http://localhost:4000
```

### 2. Frontend Setup

In a separate terminal:
```bash
cd frontend
npm install
npm start
# Frontend application will open at http://localhost:4200
```

---

## 📡 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check, storage driver status, active AI engine info |
| `GET` | `/api/config` | Client limits and taxonomy configuration |
| `GET` | `/api/taxonomy` | Dimension taxonomy and tone categories |
| `GET` | `/api/documents` | List uploaded documents and historical summaries |
| `POST` | `/api/documents/upload` | Multipart file upload (`.pdf`, `.doc`, `.docx`) |
| `GET` | `/api/documents/:id` | Get document metadata and processing state |
| `POST` | `/api/documents/:id/analyze` | Queue or re-run document AI analysis |
| `GET` | `/api/documents/:id/status` | Live status with 7 pipeline stages, percent & ETAs |
| `GET` | `/api/documents/:id/results` | Aggregated analytics, KPIs, and distributions |
| `GET` | `/api/documents/:id/units` | Paginated paragraph-level passages with search/filters |
| `GET` | `/api/documents/:id/report` | Download structured `.txt` analysis report |
| `DELETE`| `/api/documents/:id` | Delete document, uploaded files, and cached analysis |

---

## 📄 TXT Report Sample

The system outputs a structured, human-readable `.txt` report formatted as:

```text
================================================================================
AI DOCUMENT ANALYSIS REPORT
================================================================================

DOCUMENT INFORMATION
--------------------------------------------------------------------------------
Filename           : Annual_Report_2026.pdf
File Type          : PDF
Document Size      : 2.45 MB
Total Pages        : 48
Analyzed Passages  : 327
Analysis Duration  : 4.8 s
AI Provider / Model: Anthropic (claude-opus-5)

================================================================================
EXECUTIVE SUMMARY
================================================================================
Dominant Sentiment : Positive
Dominant Emotion   : Excited
Dominant Category  : Business Strategy

Summary:
The document presents an optimistic outlook highlighting strong quarterly revenue
growth, positive customer satisfaction metrics, and expansion in technical infrastructure.

================================================================================
SENTIMENT BREAKDOWN
================================================================================
Positive           : 142 (43%)
Negative           : 61  (19%)
Neutral            : 124 (38%)

================================================================================
DETAILED PASSAGE ANALYSIS
================================================================================

[Page 1 • Paragraph 1]
Text: "Welcome to our annual report on strategic performance and financial results."
Sentiment   : Neutral (97% confidence)
Emotion     : Neutral
Content Type: Informational
Topic       : Corporate Communications

[Page 1 • Paragraph 2]
Text: "Our company achieved exceptional growth with customer satisfaction reaching record highs."
Sentiment   : Positive (94% confidence)
Emotion     : Excited
Content Type: Customer Feedback
Topic       : Business Performance
...
```

---

## 🛡️ Production Security & Quality
- **MIME & Magic-Byte Validation**: File signatures are inspected on upload to block malicious files.
- **Zero API Key Leakage**: AI credentials exist strictly on the backend.
- **Sanitized Errors**: No raw internal stack traces are returned to client browsers.
- **Strict Zod Schema Validation**: AI model JSON responses are validated against runtime Zod schemas before persistence.
