# Pre-shipment (import LC opening) in Pakistan: what the process is and what this platform checks

Researched 2026-10-22. Everything marked **[verified]** was read in a source listed at the end; **[not verified]**
means it is common practice or a recollection that could not be confirmed from a primary source and must be
confirmed with the bank's compliance team before it is treated as a rule. SBP's own website refused automated
fetching (HTTP 403), so SBP texts below come from search excerpts and from the sources already recorded in
`backend/src/trade-cases/rule-registry.ts` (`REGULATORY_SOURCES`), not from a fresh read of the full circulars.

## 1. The process, step by step

| # | Step | Who | What happens |
|---|------|-----|--------------|
| 1 | Importer is eligible | Importer, bank | The importer holds an NTN (and STRN where applicable), is registered for import with Pakistan Customs (WeBOC / Pakistan Single Window) and has an account with an authorised dealer bank. Registration in WeBOC is carried out by Customs; the bank still does its own customer due diligence (CDD/KYC) **[verified: SBP FE circular 2016 excerpt]**. Banks usually also check active-taxpayer status **[not verified as a formal precondition]**. |
| 2 | Commercial basis | Importer | The importer holds a firm commitment: the supplier's proforma invoice, an indent / purchase order, or a contract. An LC is opened against a firm commitment **[verified: FE Manual Ch.13 para 7]**. |
| 3 | Goods are importable | Importer, bank | The goods are not banned and any conditions for restricted goods are met under the Import Policy Order 2022 (S.R.O. 545(I)/2022): Appendix-A banned, Appendix-B restricted with conditions, Appendix-C items barred even when used **[verified]**. Which authority gives the permission for each restricted entry is in the Appendix text itself **[not verified here]**. |
| 4 | Terms of import | Bank | Imports are permitted on C&F (CFR) or FOB terms; other incoterms need the State Bank's prior permission **[verified: FE Manual Ch.13 para 5; amended by FE Circular 06 of 2021]**. The reason is the insurance rule below. |
| 5 | Insurance | Importer | Imports must be insured in Pakistan with companies operating in Pakistan, in rupees; foreign-currency marine policies for imports are not permitted (narrow exceptions) **[verified: FE Manual Ch.15 excerpt, repeated in IAP Marine Insurance Guidelines 2025]**. |
| 6 | LC application | Importer | The application states the credit type, amount, beneficiary, shipment and expiry dates, ports, goods and the documents required. A cash margin may be taken under bank policy; SBP's 100 % margin lists were withdrawn from 31 March 2023 **[verified: press reports; current position not confirmed]**. |
| 7 | Bank scrutiny | Trade operations | Checks below (section 2). For larger LCs the bank itself must obtain a report on the exporter's standing: the archived text sets the threshold at Rs 1,500,000 and a report supplied by the importer is not acceptable **[verified: FE Manual Ch.13 para 7; the figure must be confirmed against the current manual]**. |
| 8 | Approval | Bank | Approved under the bank's own delegation and credit policy. |
| 9 | Opening and the Financial Instrument | Bank | The LC is established. Under Pakistan Single Window the bank issues a Financial Instrument (FI) once an LC is established (or an advance payment is made, or a contract registered). The FI's expiry must match the underlying LC; details are exchanged with PSW over EDI **[verified: PSW guidance and EPD Circular Letter 09 of 2026]**. The earlier Electronic Import Form (EIF) was approved by the bank on the day an LC was established **[verified, superseded by the FI]**. |

Steps after the credit is opened (presentation of shipping documents, examination under UCP 600, settlement) are the post-shipment stage and are outside this document.

## 2. What the bank must check at scrutiny, and where the platform does it

| Check | Basis | In the platform |
|-------|-------|-----------------|
| Every document is what it says it is, is readable and signed/dated | Bank practice | AI identifies each uploaded document and reviews it (`preshipment-ai.service.ts`) |
| Firm commitment on file | FE Manual Ch.13 para 7 | Rule `PK-FEM13-07-FIRM` |
| Required LC details present (parties, amount, goods, HS code, quantity, price, incoterm and place, origin, ports, shipment and expiry dates, payment terms, documents required) | LC practice, UCP 600 | Rule `PT-REQ-001`; AI review lists what is present and what is missing per document |
| Documents agree with one another (parties, amount, quantity, price, goods, dates, references) | LC practice; TBML framework (documentary consistency) | AI cross-document review; rules `PT-CMP-*`, `PT-PI-ARITHMETIC` |
| Terms of import FOB or CFR | FE Manual Ch.13 para 5 | Rule `PK-FEM13-05-TERMS` |
| LC validity not above 12 months (24 for specially manufactured machinery) | FE Manual Ch.13 para 9 | Rule `PK-FEM13-09-VALIDITY` |
| Shipment date, presentation period and expiry are coherent | UCP 600 art. 14(c) | Rule `PT-DATE-ORDER` |
| Goods are importable (not banned; restricted goods carry the required permission) | Import Policy Order 2022 | AI review against the Order; the permit document is checked when one is attached |
| Sanctions: parties, banks, vessels and countries screened against UN Security Council lists (UN (Security Council) Act 1948 SROs) and proscribed persons (Anti-Terrorism Act 1997); matches are reported to the FMU | SBP AML/CFT/CPF Regulations (Regulation 4), SBP UNSC compliance guidelines **[verified]** | Sanctions engine; rules `CMP-SANCTIONS-PARTY`, `CMP-JURISDICTION`; AI review flags names and countries |
| High-risk and sanctioned jurisdictions (origin, ports, counterparties) | FATF lists, sanctions programmes | Jurisdiction screening; `CMP-JURISDICTION` |
| Dual-use / strategic goods: goods that may appear on the national control lists (S.R.O. 1977(I)/2025, Export Control Act 2004) or other regimes need end-use diligence | Export Control Act 2004 governs exports of nuclear/biological-related items; for imports this is a bank due-diligence flag, not a licence the importer obtains from SECDIV **[partly verified]** | Export-controls engine; rule `CMP-EXPORT-CONTROL`; AI review flags suspected dual-use goods |
| Trade-based money laundering: price reasonableness, over/under-invoicing, unusual routing, reuse of the same proforma invoice | SBP TBML/TF framework (EPD CL 08 of 2025, replacing FE Circular 4 of 2019) **[circular read; annexed framework not retrievable]** | TBML engine; rules `TBML-*`; AI review lists red flags |
| Insurance arrangement is Pakistani and in rupees | FE Manual Ch.15 | AI review notes when an insurance cover is required by the terms |
| Credit line and margin | Bank policy | Credit review (outside this pre-shipment scrutiny) |

## 3. What is not covered or not verified

* The full current text of FE Manual Chapter 13 (SBP's site blocked automated reading). Figures such as the Rs 1.5 million report threshold must be confirmed.
* The mapping of each Import Policy Order Appendix-B entry to the authority that issues its permission.
* The annexures (red-flag list) of the 2025 TBML framework; the platform's TBML indicators are not yet mapped clause by clause.
* Whether a pre-shipment inspection is required for particular goods.
* Any integration with PSW, WeBOC, FBR's active-taxpayer list or sanctions list feeds beyond what the platform already holds.

The platform reports these as limits of the check, never as a pass.

## 4. Sources

* SBP Foreign Exchange Manual, Chapter 13 (Imports): https://www.sbp.org.pk/fe_manual/pdf/2020/Chp-13.pdf and the archived chapter https://archive.sbp.org.pk/fe_manual/chapters/chapter13.htm
* SBP FE Circular No. 06 of 2021 (Chapter 13 amendments, paragraphs 5, 9, 13): https://www.sbp.org.pk/circulars/fe-circular-no-06-of-2021
* SBP EPD Circular Letter No. 09 of 2026, Imports under PSW, Financial Instrument details: https://www.sbp.org.pk/circulars/epd-circular-letter-no-09-of-2026
* Pakistan Single Window, elimination of EIF/EFE: https://psw.gov.pk/public/elimination-of-eif-efe
* SBP FE Manual Chapter 15 (insurance): https://www.sbp.org.pk/fe_manual/chapters/chapter15.htm ; Insurance Association of Pakistan, Marine Insurance Guidelines 2025: https://iap.net.pk/wp-content/uploads/2025/03/Marine-Insurance-Guidelines.pdf
* Import Policy Order 2022 (S.R.O. 545(I)/2022): https://icci.com.pk/wp-content/uploads/2025/04/Import-Policy-Order-2022.pdf
* Strategic Export Control Division, National Control Lists (S.R.O. 1977(I)/2025): https://mofa.gov.pk/pakistan-notifies-revised-control-lists-under-the-export-control-act-of-2004-9
* SBP guidelines on compliance with UN Security Council resolutions: https://www.sbp.org.pk/bprd/2019/CL15_Annex.pdf and https://www.sbp.org.pk/bprd/2019/C9-UNSC-Compliance-Guidelines.pdf
* SBP TBML/TF framework, 2019: https://www.sbp.org.pk/epd/2019/FEC4.htm and revision 2025: https://www.sbp.org.pk/Epd/2025/FECL8-Annex.pdf
* SBP FE Circular on importer registration and CDD (2016): https://www.sbp.org.pk/epd/2016/FEC5.pdf
* FBR WeBOC trader registration checklist (active taxpayer list extracts): https://www.fbr.gov.pk/categ/dirbs/51149/70849/131171
* Cash-margin history: https://www.brecorder.com/news/amp/40123833 and https://pk.vlex.com/vid/sbp-withdraws-all-cash-926829024
