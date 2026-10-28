# Sample documents for the pre-shipment flow

Sab kuch farzi (fictional) hai: companies, numbers aur bank details asli nahi hain.
Documents `backend/scripts/generate-sample-documents.ts` se bane hain; dobara banane ke liye `backend` folder mein:

```
npx tsx scripts/generate-sample-documents.ts            # yehi folder
npx tsx scripts/generate-sample-documents.ts --round=2  # naye numbers, test-pdfs/round_2/
```

## Folders

| Folder | Kya hai |
|---|---|
| `A_clean_set/` | 5 documents jo ek dusre se har figure aur date par agree karte hain. AI ko inme koi issue nahi milna chahiye. |
| `B_set_with_mistakes/` | 2 documents jin mein jaan-boojh kar galtiyan hain (mail wala loop try karne ke liye). |
| `C_corrected_for_B/` | Wohi 2 documents sahi kiye hue: customer mail ke jawab mein yehi corrected documents bhejta hai. |

### A_clean_set: ek hi deal

Importer **Kamran Textiles (Pvt) Ltd** (Karachi), supplier **Brasil Cotton Exports Ltda** (Sao Paulo, Brazil).
100,000 KG raw cotton (HS 5201.0010) x USD 2.50 = **USD 250,000.00**, CFR Karachi, Santos to Karachi,
irrevocable LC at sight, latest shipment 15.12.2026, expiry 31.01.2027.
Tarteeb: proforma invoice (05.10) -> purchase order (08.10) -> contract (10.10) -> LC application (22.10).

| File | AI isay pehchanta hai |
|---|---|
| `01_Proforma_Invoice_PI-2026-0715.pdf` | Proforma invoice |
| `02_Purchase_Contract_CTR-KTL-BCE-2026-031.pdf` | Purchase contract |
| `03_Purchase_Order_PO-KTL-2026-0458.pdf` | Purchase order |
| `04_Import_Permit_IP-2026-04418.pdf` | Import permit |
| `05_LC_Application_Form_LCA-2026-0092.pdf` | LC application form |

### B_set_with_mistakes aur C_corrected_for_B

B mein do galtiyan hain, C mein unka sahi version:

- `01_..._with_mistakes.pdf`: line total 205,000.00 hai jabke quantity x price = 250,000.00, aur country of origin likha hi nahi.
- `05_..._with_mistakes.pdf`: LC application mein expiry date aur latest shipment date nahi hain.

## Poora flow check karne ke steps

1. Backend start (`backend` folder mein `npm run dev`), frontend refresh, **pre-shipment** se login.
2. **Customer (Kamran Textiles)**: New LC application, `A_clean_set` ke saare 5 PDFs add karein. Har file ke saamne AI batata hai ke woh kaun sa document hai (galat ho to dropdown se badal sakte hain). Phir **Send to the bank**. Reference number (`TC-...`) milega.
3. Logout, **Trade Maker (Bilal Ahmed)** se login. "Documents to scrutinise" mein woh case khulega, **Pre-shipment scrutiny** kholein.
4. **Run the AI scrutiny** (lagbhag 1 minute): AI ek ek document padhta hai, phir saare documents ko aapas mein compare karta hai. Page par har document ka review (kya hai, kya missing hai, issues), sanctions/countries, saare rules, aur findings dikhte hain.
5. `A_clean_set` mein koi issue nahi aana chahiye: **Approve the request** dabayein.
6. Mail wala loop: naya case banayein (alag round, neeche dekhein), is baar `B_set_with_mistakes` ke 2 PDFs bhejein. Maker scrutiny chalaye, **Message to the customer** se AI ki likhi mail dekhe, edit kar ke bheje. Customer wohi case khol kar mail padhe, `C_corrected_for_B` ke dono PDFs **corrected documents** ke taur par attach karke reply kare. Purane documents ignore ho jate hain. Maker dobara **Run the AI scrutiny** chalaye (sirf naye documents padhe jate hain; koi finding nahi bachni chahiye), customer ke message ko **Resolve** kare (Queries tab), phir approve.

## Dhyan rakhein

- Wohi PDFs ya wohi proforma invoice number dobara kisi doosre case mein bhejne par system ise **reuse** samajhta hai (TBML ka sahi alert). Dobara test ke liye `--round=2` wala set banayein.
- `A_clean_set` aur `B_set_with_mistakes` ek hi proforma invoice number use karte hain, isliye dono ko alag alag cases mein mat chalayein (ya ek ke liye `--round=2`).
- AI model har baar bilkul ek jaisa nahi likhta; kabhi kabhi ek-do chhote notes aa sakte hain.
- Gemini ki free plan mein lagbhag 15 requests/minute ki hadd hoti hai. System har bari AI call ke beech `AI_MIN_GAP_MS` (default 4000 ms) ka faasla rakhta hai. Agar aapka plan zyada allow karta hai to `.env` mein isay chhota kar sakte hain.

---

## Post-shipment documents (D, E, F folders)

`--round=N` ab shipping documents bhi banata hai. **Unhi round ke `A_clean_set` ke saath use karein** (numbers aur
dates aapas mein mel khate hain). Round 17 (`round_17/`) sabse taaza hai (27.10.2026 ko bana); round 16 bhi maujood hai.

| Folder | Kya hai |
|---|---|
| `D_post_shipment_clean/` | 5 shipping documents: commercial invoice, bill of lading, packing list, certificate of origin, inspection certificate. Approved request ke saath har term par agree karte hain (parties, goods, HS, 100,000 KG, USD 250,000, Santos -> Karachi, dates, container number ISO 6346 ke mutabiq). **Zero blocking** aani chahiye. |
| `E_post_shipment_with_mistakes/` | Wohi shipment, jaan-boojh kar galtiyon ke saath: invoice par HS code 8408.1000 (approved 5201.0010), quantity 90,000 KG / USD 225,000, aur invoice + bill of lading par discharge port Port Qasim (credit mein Karachi). Baqi 3 documents D wale hain. |
| `F_post_shipment_corrected/` | E ke invoice aur bill of lading ka sahi version (naya invoice `...-R1`, jo purane ko replace karta hai). |

**Shipment date:** documents ki on-board date generate karne wale din ki hoti hai, kyunke maal approval ke baad hi
ship hota hai (approval se ek din se pehle ki shipment par "Shipped before the request was approved" warning aati hai).
Agar aap kisi aur din test karein to dobara banayein: `npx tsx scripts/generate-sample-documents.ts --round=18`
ya `--ship-date=DD.MM.YYYY` do. (Round 17 ke baad agla `--round=18`.) Presentation period 21 din hai: shipment ke 21 din ke andar submit karein.

### Round 17 ke numbers

| Cheez | Number |
|---|---|
| Proforma invoice | PI-2026-0731 |
| Contract / Purchase order / Import permit / LC application | CTR-KTL-BCE-2026-047 / PO-KTL-2026-0474 / IP-2026-04434 / LCA-2026-0108 |
| Commercial invoice (corrected version) | CI-2026-1196 (`CI-2026-1196-R1`) |
| Bill of lading / Packing list / Certificate of origin / Inspection | MSCU7712112 / PL-2026-1196 / CO-BR-2026-55036 / INS-SAN-2026-03356 |

**Galtiyan (B aur E mein):** B ke proforma par line total USD 205,000.00 (sahi: 100,000 x 2.50 = 250,000.00) aur country of origin gayab; B ke LC application par expiry date, place of expiry aur latest shipment date gayab. `C_corrected_for_B` in sab ko theek karta hai. E ki galtiyan upar table mein hain; `F_post_shipment_corrected` unhe theek karta hai.

### Poora flow (zero blocking)

1. **Pre-shipment** login, Customer: New LC application, `round_17/A_clean_set` ke 5 PDFs, **Send to the bank**.
   Request form mein: beneficiary Brasil Cotton Exports Ltda (Brazil), USD 250,000, 100,000 KG, HS 5201.0010, CFR Karachi,
   Santos -> Karachi, latest shipment 15.12.2026, expiry 31.01.2027, required documents: commercial invoice, bill of
   lading, packing list, certificate of origin, inspection certificate. (Asli AI ye sab LC application form se bhar deta hai.)
2. **Trade Maker**: Run the AI scrutiny, phir **Approve**. Case ko reference `PSR-2026-000NN` milta hai.
3. **Customer**: **Post-Shipment** menu, apna reference kholein, **Start**, `D_post_shipment_clean` ke 5 PDFs upload karein
   (har file ki type check karein), **Submit application**.
4. **Post-shipment officer** (Hamza Sheikh, post-shipment profile): ab case Trade Cases mein aayega. **Run the examination**
   (optional: **AI-assisted reading**). Sirf ek Information note ("Examined against the approved pre-shipment
   application") aani chahiye, koi blocking nahi. **Record decision** -> Accept.
5. Discrepancy loop: dusre naye case mein `E_post_shipment_with_mistakes` + D ke baqi 3 documents bhejein; officer 4 blocking
   discrepancies dekhega (HS, quantity, port vs credit, port vs packing list), **Ask the client** se maange; customer
   `F_post_shipment_corrected` ke 2 documents ke saath reply kare; officer **Examine again** -> koi blocking nahi -> Accept.

**Sach:** ye "zero blocking" meri test machine par local reader aur rules ke saath dikhaya gaya hai
(`backend/src/__tests__/sample-documents-flow.test.ts`). Asli AI model se documents parhne par chhoti farq aa sakte hain
(jaise kisi field ko AI alag parhe); jo aaye wo mujhe bhej dein.
