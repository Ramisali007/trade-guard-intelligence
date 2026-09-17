import { Injectable } from '@angular/core';

export interface BlogPost {
  id: string;
  category: string;
  date: string;
  readTime: string;
  title: string;
  excerpt: string;
  author: string;
  authorRole: string;
  tags: string[];
  content: string[];
  imageUrl: string;
  authorImage?: string;
  headlineHighlight?: string;
  executiveSummary?: string[];
}

@Injectable({
  providedIn: 'root',
})
export class BlogService {
  private readonly blogs: BlogPost[] = [
    {
      id: 'blog-1',
      category: 'Intelligent Process Automation',
      date: 'October 2025',
      readTime: '6 min read',
      title: 'Future-Proofing Trade Finance: Unlocking Value through Intelligent Process Automation & AI Document Examination',
      imageUrl: '/images/blogs/blog-automation-ai.jpg',
      authorImage: '/images/blogs/author-portrait.jpg',
      headlineHighlight: 'UNLOCKING VALUE THROUGH INTELLIGENT PROCESS AUTOMATION',
      excerpt: 'How cognitive document AI, ISO 20022 schemas, and automated UCP 600 rule checking eliminate manual review latency for tier-1 trade banks.',
      author: 'Christoffer Eriksson',
      authorRole: 'Head of AI & Trade Architecture, InfoTech Group',
      tags: ['TradeGuard Intelligence', 'Operational Efficiency', 'Process Automation', 'Regulatory Compliance', 'Trade Finance'],
      content: [
        'Global trade finance operations process over $5 trillion in commercial presentations annually, yet the vast majority of documentary checking remains trapped in manual, paper-heavy workflows susceptible to human error.',
        'With TradeGuard® by InfoTech Group, banks ingest Letters of Credit (LCs), Bills of Lading, and Commercial Invoices into normalized ISO 20022 data models within seconds, eliminating hours of repetitive transcription.',
        'By automating discrepancy detection under ICC UCP 600 and ISBP 745 rules, institutions reduce examination turnarounds from days to under four minutes while ensuring 100% auditable regulatory compliance.'
      ],
      executiveSummary: [
        'The global trade finance landscape is at a critical juncture. Institutions are grappling with rising compliance demands, declining margins, and outdated technology stacks. Meanwhile, clients expect faster, digital-first experiences. These pressures are compounded by a shrinking pool of skilled trade operations professionals. Yet within this challenge lies opportunity.',
        'This white paper explores how intelligent process automation (IPA), powered by Artificial Intelligence (AI) and Large Language Models (LLMs), is revolutionizing trade finance. It highlights how TradeGuard® Intelligence enables financial institutions to enhance regulatory compliance, reduce operational cost, and deliver measurable ROI.',
        'Drawing on InfoTech Group\'s client engagements, industry studies, and use cases, we examine how leading banks are adopting automation to unlock value, boost resilience, and maintain competitive advantage.'
      ]
    },
    {
      id: 'blog-2',
      category: 'TBML & Financial Crime',
      date: 'November 2025',
      readTime: '8 min read',
      title: 'The Regional Trade Corridors: What Banks Need to Know About Emerging TBML Risks & Phantom Shipments',
      imageUrl: '/images/blogs/blog-tbml-corridors.jpg',
      authorImage: '/images/blogs/author-portrait.jpg',
      headlineHighlight: 'EMERGING TBML RISKS & PHANTOM SHIPMENTS IN GLOBAL TRADE',
      excerpt: 'Detecting over/under invoicing, circular voyage topologies, and illicit trade flows using customs price corridor analysis and graph intelligence.',
      author: 'Zubair Ahmed',
      authorRole: 'Director of Trade Compliance, InfoTech Group',
      tags: ['TBML', 'FATF Red Flags', 'Price Corridors', 'Trade Finance', 'Phantom Shipments'],
      content: [
        'Trade-Based Money Laundering (TBML) represents one of the most sophisticated avenues for transnational financial crime. Criminal syndicates manipulate commercial transaction values to move illicit capital through licit trade corridors.',
        'TradeGuard® applies historical customs price corridor benchmarking and shipping route topology analysis to detect statistical anomalies in unit pricing before presentation funds are disbursed.',
        'Automated scoring aligned with FATF and Wolfsberg Principles ensures banks maintain an audit-proof compliance posture across volatile cross-border trade corridors.'
      ],
      executiveSummary: [
        'Trade-Based Money Laundering remains one of the hardest financial crime typologies to detect because it disguises illicit value transfers within genuine commercial logistics. Banks processing documentary presentations often see clean paperwork covering completely artificial valuations or non-existent "phantom" shipments.',
        'This analysis outlines how modern machine learning models combine international customs price corridors (such as UN Comtrade data) with vessel AIS movement graphs to reveal hidden anomalies in real time.',
        'Institutions adopting graph-based behavioral anomaly scoring reduce false-positive rates by over 60% while detecting multi-hop trade routing schemes that bypass traditional rule-based checks.'
      ]
    },
    {
      id: 'blog-3',
      category: 'Regulatory Compliance',
      date: 'December 2025',
      readTime: '5 min read',
      title: 'Trade Finance Compliance Teams: How AI-Powered UCP 600 & ISBP 745 Discrepancy Engines Reduce Operational Backlogs',
      imageUrl: '/images/blogs/blog-compliance-rules.jpg',
      authorImage: '/images/blogs/author-portrait.jpg',
      headlineHighlight: 'HOW AI-POWERED UCP 600 & ISBP 745 DISCREPANCY ENGINES REDUCE BACKLOGS',
      excerpt: 'Empowering compliance analysts with explainable Article 14/16 rule citations and cross-document reconciliation between Bills of Lading and Invoices.',
      author: 'Tariq Al-Mansoor',
      authorRole: 'Senior Trade Product Specialist, InfoTech Group',
      tags: ['Discrepancy Engine', 'ISBP 745', 'Article 16', 'ICC Rules', 'Operational Efficiency'],
      content: [
        'Document discrepancy disputes between issuing and confirming banks cost financial institutions millions in delayed settlement fees and legal friction.',
        'TradeGuard® evaluates all commercial presentations against ICC UCP 600 standard articles and ISBP 745 interpretations, generating instant Article 16 notice drafts for non-conforming presentations.',
        'The platform provides explainable citations with line-by-line evidence, enabling compliance examiners to approve or reject presentations with total certainty.'
      ],
      executiveSummary: [
        'Documentary credit operations have historically suffered from high operational friction due to strict compliance standards set by ICC UCP 600 and ISBP 745. Even minor typographical variances between an invoice, bill of lading, and certificate of origin can hold up multimillion-dollar cargo releases.',
        'Modern discrepancy engines employ dual-layer AI parsing: deterministic semantic alignment for mathematical line totals, combined with natural language understanding for qualitative terms of carriage and description of goods.',
        'By generating instant, auditable Article 16 refusal notices with exact legal citations, financial institutions dramatically cut processing cycles and mitigate litigation risk between issuing and advising banks.'
      ]
    },
    {
      id: 'blog-4',
      category: 'Sanctions & Dual-Use Goods',
      date: 'January 2026',
      readTime: '7 min read',
      title: 'Navigating Dual-Use Goods & Export Controls: ECCN Matching in Modern Transaction Monitoring',
      imageUrl: '/images/blogs/blog-dualuse-goods.jpg',
      authorImage: '/images/blogs/author-portrait.jpg',
      headlineHighlight: 'ECCN MATCHING & DUAL-USE MONITORING IN MODERN TRADE',
      excerpt: 'Screening complex cargo manifests for proliferation financing and military end-use risks across OFAC, EU CFSP, and UK HMT regimes.',
      author: 'Dr. Sarah Mitchell',
      authorRole: 'Chief Regulatory Strategist, TradeGuard Lab',
      tags: ['Export Controls', 'ECCN Lookup', 'OFAC Screening', 'Military End-Use', 'Regulatory Compliance'],
      content: [
        'Modern trade compliance requires screening beyond entity lists to evaluate goods themselves for potential dual civilian and military applications.',
        'TradeGuard® cross-checks Harmonized System (HS) codes and goods descriptions against global military dual-use control lists (ECCN and EU Dual-Use Annex).',
        'By integrating fuzzy semantic keyword search with official regulatory gazettes, the system prevents illicit technology transfer and sanctions breaches.'
      ],
      executiveSummary: [
        'Regulatory enforcement in export controls has shifted from static party screening to deep technical scrutiny of underlying commercial goods. Commercial products such as high-frequency amplifiers, advanced carbon fibers, or specialized lasers may appear benign on basic commercial invoices while meeting restricted dual-use specifications.',
        'This white paper breaks down the technical intersection between 6-digit Harmonized Tariff Schedule (HTS) classifications and 5-character Export Control Classification Numbers (ECCNs).',
        'Banks leveraging automated dual-use detection algorithms protect themselves from severe extraterritorial penalties under US EAR, EU Regulation 2021/821, and multilateral export regimes.'
      ]
    },
    {
      id: 'blog-5',
      category: 'Maritime AIS Intelligence',
      date: 'February 2026',
      readTime: '6 min read',
      title: 'Maritime AIS Vessel Tracking & Sanctions Screening: Mitigating Dark Fleet Transshipment Evasion',
      imageUrl: '/images/blogs/blog-maritime-ais.jpg',
      authorImage: '/images/blogs/author-portrait.jpg',
      headlineHighlight: 'MITIGATING DARK FLEET TRANSSHIPMENT EVASION VIA AIS TELEMETRY',
      excerpt: 'Uncovering AIS spoofing, STS (ship-to-ship) cargo transfers, and high-risk port visits before Letter of Credit settlement release.',
      author: 'Captain Lars Lindqvist',
      authorRole: 'Maritime Intelligence Lead, InfoTech Group',
      tags: ['AIS Tracking', 'Dark Fleet', 'Sanctions Evasion', 'Vessel Tracking', 'Maritime Intelligence'],
      content: [
        'Shadow fleets and sanctioned commodity carriers frequently disable automatic identification system (AIS) transponders or conduct covert ship-to-ship (STS) transfers in open international waters.',
        'TradeGuard® connects directly with global AIS satellite networks to track vessel histories, identifying gap events, draft changes, and proximity to sanctioned territorial waters.',
        'Compliance officers receive real-time alerts before releasing payment on ocean Bills of Lading linked to compromised vessels.'
      ],
      executiveSummary: [
        'The proliferation of the maritime "dark fleet"—vessels operating under flags of convenience with obscured ownership and manipulated transponders—poses acute compliance threats to trade financing institutions.',
        'Traditional maritime screening checks static vessel IMO lists, completely missing transshipments where oil or metals are transferred between vessels in open sea corridors prior to entering lawful territorial waters.',
        'Automated AIS reconstruction integrates vessel telemetry, historical port call logs, and dead reckoning algorithms to flag suspicious AIS gap intervals and draft variances before settlement execution.'
      ]
    },
    {
      id: 'blog-6',
      category: 'Core Banking Integration',
      date: 'March 2026',
      readTime: '9 min read',
      title: 'Transitioning to ISO 20022 & SWIFT MT700/710: Overcoming Real-Time Interoperability Hurdles for Global Banks',
      imageUrl: '/images/blogs/blog-iso-banking.jpg',
      authorImage: '/images/blogs/author-portrait.jpg',
      headlineHighlight: 'OVERCOMING REAL-TIME INTEROPERABILITY HURDLES FOR GLOBAL BANKS',
      excerpt: 'Integrating AI compliance gateways with Finastra FusionFabric, Oracle FLEXCUBE, and modern open banking trade APIs.',
      author: 'Michael Sgarlata',
      authorRole: 'Global Banking Architecture Advisor',
      tags: ['ISO 20022', 'Finastra Integration', 'Open Banking', 'SWIFT MX', 'Core Banking Integration'],
      content: [
        'As SWIFT and central banks mandate the migration to ISO 20022 MX messaging, legacy core banking infrastructures face significant interoperability friction.',
        'TradeGuard® acts as an intelligent intermediary layer, translating legacy MT700/710 messages into rich XML schemas while performing automated compliance screening.',
        'Pre-built connectors for Finastra Fusion Trade Innovation and leading enterprise cores enable rapid deployment with zero disruption to active trade settlement pipelines.'
      ],
      executiveSummary: [
        'The international banking community is deep in the transition from unstructured MT messages to data-rich, XML-based ISO 20022 schemas. For trade finance, the coexistence of MT700 series documentary credits with emerging tsmt and pacs standards creates severe operational friction.',
        'Without automated translation and screening middleware, banks are forced into manual re-keying and dual-system validation, doubling operational expenses and settlement delays.',
        'Modern trade intelligence architectures provide bi-directional schema translation, ensuring sub-10ms processing latency and seamless integration across Finastra, Oracle FLEXCUBE, and proprietary banking cores.'
      ]
    }
  ];

  getBlogs(): BlogPost[] {
    return this.blogs;
  }

  getBlogById(id: string): BlogPost | undefined {
    return this.blogs.find((b) => b.id === id);
  }
}
