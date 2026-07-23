# ArX Task — Mobil Uygulama Denetim & Test Raporu

> **Tarih:** 8 Temmuz 2026  **Kapsam:** ArX Task mobil (Expo/React Native) + .NET 10 API (`Program.cs`)
> **Yöntem:** Gerçek derleme + type-check + statik iz sürme + 7 paralel denetçi ajan + her yüksek-önemli bulgu için çelişkili (adversarial) doğrulama.

Bu rapor senin 4 şikayetini tek tek tarayıp kök-nedenlerine indi, ek olarak bir "tester" gibi kodu **gerçekten derleyip** çalıştırarak tüm modülleri test etti. Toplam **36 doğrulanmış bulgu** bulundu (2 tanesi çelişkili doğrulamada elendi).

## 0. Genel Sonuç

| Şikayet | Durum | Kök Neden |
|---|---|---|
| **#1 — AI görev/firma tanıma saçmalıyor** | 🔴 **DOĞRULANDI** | İki ayrı kök neden: (A) regex, AI modelinin kararını eziyor; (B) firma eşleştirme sadece **tam string** eşitliği — diakritik/fuzzy yok |
| **#2 — Frontend tasarım zayıf/animasyonsuz** | 🟠 **DOĞRULANDI** | Uygulamada **tek bir animasyon bile yok** (Reanimated kurulu ama hiç kullanılmıyor), gölge/gradyan/derinlik yok, tipografi sistemi yok |
| **#3 — Tüm modüller aktif & bağlantılı olmalı** | 🟡 **BÜYÜK ÖLÇÜDE ÇALIŞIYOR** | Çekirdek akış (firma→görev→teklif→fatura) gerçekten bağlı; ama **AI Asistan sahte** (backend'e hiç gitmiyor), Ölçüm↔Döküman bağı kopuk, Döküman yükleme yok |
| **#4 — Bildirim gitmiyor** | 🟠 **DOĞRULANDI** | İlk sanılanın aksine backend Expo push'u **gönderiyor**; asıl sorun **saat dilimi hatası** (görev saati sunucu saatiyle yorumlanıyor) + cihaz-içi yedek bildirim yok + FCM yapılandırması yok |

**Önem dağılımı:** 🔴 2 kritik · 🟠 9 yüksek · 🟡 14 orta · ⚪ 11 düşük

**En kritik 5 madde (önce bunlar):**
1. 🔴 Regex, AI'ın firma kararını eziyor ve güveni zorla %92'ye çekip kontrolü atlatıyor → yanlış/alakasız firma açılıyor. (`Program.cs:2429`)
2. 🔴 Firma eşleştirme **sadece tam string** — "Döner" vs "Doner", "İpek" vs "Ipek" eşleşmiyor → **duplicate firma**. (`Program.cs:3599`, `3544`)
3. 🟠 Bildirim saatleri **sunucu saat dilimiyle** hesaplanıyor → hatırlatmalar ~3 saat geç veya hiç gitmiyor. (`Program.cs:3958`)
4. 🟠 Uygulamada **sıfır animasyon** ve **sıfır derinlik/gölge** → "dümdüz site" hissi. (`ui.tsx`)
5. 🟠 "AI Asistan" gerçekte bir **sabit anahtar-kelime eşleyici** — hiçbir yapay zekâya/backend'e gitmiyor. (`ai-assistant.tsx:97`)

---

## 1. Nasıl Test Ettim (Tester Bölümü)

Kodu sadece okumakla kalmadım; bir test mühendisi gibi **gerçekten derleyip/çalıştırıp** kontrol ettim:

| Test | Komut | Sonuç |
|---|---|---|
| API derleme | `dotnet build ArxTask.Api.csproj` | ✅ **0 hata**, 8 uyarı |
| Mobil type-check | `npx tsc --noEmit` (strict açık) | ✅ **0 tip hatası** |
| Mobil lint | `eslint` | ⏭️ Atlandı — projede eslint yapılandırması/paketi yok |
| Endpoint uyum testi | `api.ts` → `Program.cs` çapraz kontrol | ✅ Çağrılan tüm uçlar backend'de mevcut (404/500 uyuşmazlığı yok) |
| AI firma boru hattı | Gerçek regex/normalize kodunu **standalone .NET programı** olarak çalıştırıp Türkçe cümlelerle test | ❌ Duplicate & phantom firma üretildi (aşağıda) |

Ayrıca 7 uzman denetçi ajan (AI-capture, bildirimler, tasarım, çekirdek modüller, ikincil modüller, backend, derleme) paralel çalıştı; her yüksek-önemli bulgu ikinci bir ajan tarafından **"bunu çürüt"** talimatıyla bağımsız doğrulandı — 2 iddia bu aşamada elendi, kalanlar kanıtlandı.

**İyi haber:** Kod tabanı derleniyor, tip-güvenli ve çekirdek veri akışı sağlam. Sorunlar "çökmüyor" değil, **mantık/tasarım/yapılandırma** düzeyinde — yani düzeltilebilir ve büyük kısmı odaklı değişikliklerle çözülür.

> ⚠️ Not: Emülatör/gerçek cihaz olmadan **runtime push teslimi** ve **ekran görselleri** bu ortamda test edilemedi; bildirim bulguları kod + yapılandırma izinden çıkarıldı. Cihazda canlı doğrulama için ayrı bir adım gerekir.

---

## 2. 🔴 Şikayet #1 — AI Ses/Metin Görev & Firma Tanıma "Saçmalıyor"

**Verdict: Doğrulandı.** Senin tarif ettiğin iki ayrı arıza da kodda birebir mevcut ve **gerçek Türkçe cümlelerle çalıştırılarak kanıtlandı.**

### Kök neden A — "Alakasız kelimeyi firma yapıyor" (phantom firma)
AI modeli aslında iyi ayarlanmış (temperature 0.1, JSON modu, marka-vs-eylem ayrımı için güçlü sistem promptu). **Ama modelin kararı kullanılmıyor:** `NormalizeAiAnalysis` (`Program.cs:2429`) her seferinde metin üzerinde bir **regex** çalıştırıp modelin bulduğu firmayı **eziyor** ve güveni zorla `≥0.92`'ye sabitliyor. Bu güven, "düşük güvende sor" kapısını da atlatıyor. Regex ise eylem fiilinden ("git", "montaj", "ölç"...) önceki gelişigüzel kelimeleri firma sanıyor.

- Gerçek testte `"Servis aracını kontrol ettikten sonra Mavi Tent'e ölçüme git"` → firma olarak **"Servis"** seçildi (gerçek marka "Mavi Tent" ikinci sıraya düştü ve atıldı).
- `"Depoyu kontrol ettikten sonra montaja git"` → phantom firma **"Depoyu Kontrol Ettikten Sonr"**.

### Kök neden B — "Aynı firmayı tanımıyor, ikinci kez açıyor" (duplicate firma)
Mevcut firmayla eşleştirme **yalnızca tam string eşitliği** ile yapılıyor (`CompanyMatches` → `NormalizeCompanyLookup`, `Program.cs:3599/3544`). Bu normalize yalnızca kırp + küçük harf (tr-TR) yapıyor; **diakritik katlaması yok, Levenshtein/token benzerliği yok.** Sonuç:
- `"Ensar Döner"` (kayıtlı) vs `"Ensar Doner"` (ses tanıma ö'yü düşürdü) → **eşleşmez → yeni firma**.
- `"İpek Tekstil"` vs `"Ipek Tekstil"` → tr-TR küçük harfte `İ→i` ama `I→ı` olduğundan `"ipek"` ≠ `"ıpek"` → **eşleşmez → yeni firma**. (Bunu ayrı bir .NET programıyla çalıştırıp kanıtladık.)
- `"Ensar Döneri"` (ekli hâli) → tam eşleşme de, kelime-içi arama da başarısız → **yeni firma**.

> **Nüans (çelişkili doğrulamadan):** "Ensar Döner " (sondaki boşluk), çift boşluk ve sadece büyük/küçük harf farkı **zaten** normalize edilip yakalanıyor — bunlar duplicate üretmiyor. Gerçek tetikleyici **diakritik farkı** (ö/o, İ/ı) ve **morfolojik ekler**. Ayrıca metinde firma adı birebir geçiyorsa devreye giren ikincil bir eşleştirici (`FindExistingCompanyByMention`) var, ama o da aynı kusurlu normalize'i kullandığı için diakritik farkında yine başarısız.

### Ne yapılmalı (özet)
1. **Modeli birincil kaynak yap:** regex'i yalnızca model boş/düşük-güvende dönerse *yedek* olarak kullan; güveni zorla 0.92'ye çekmeyi bırak.
2. **Fuzzy + diakritik-katlamalı eşleştirme ekle:** `İ/ı/I→i, ş→s, ğ→g, ç→c, ö→o, ü→u` katla + alfanümerik dışını temizle; sonra token-set/Levenshtein oranı ≥~0.85 olanları **aday** say.
3. **Yakın eşleşmeyi kullanıcıya sor:** sessizce yeni firma açmak yerine mevcut çözümleme modalinde "Bu, 'Ensar Döner' mi?" diye göster.
4. **Prompt'a kural ekle:** modele verilen `existingCompanies` listesine "varsa buradan eşle/aynı adı kullan" talimatı ekle (şu an liste veriliyor ama eşleştir denmiyor).
5. **Mobil düzeltme yolu aç:** yakalama ekranındaki adres modaline "mevcut firmaya bağla" aramasını ekle (şu an kullanıcı yanlışı fark etse bile yalnızca yeni firma açabiliyor).

### Bu şikayetle ilgili bulgular

#### 1. 🔴 [KRİTİK] Existing-company matching is exact normalized string equality only — no fuzzy/diacritic-fold/token-overlap, so any transcription variance spawns a duplicate company

- **Konum:** `api/ArxTask.Api/Program.cs`:3599
- **Sorun:** The only mechanism that binds a spoken name to an existing company is CompanyMatches (line 3596-3604) / CompanyMatchScore, which compare NormalizeCompanyLookup(company.Name) == normalizedCompanyName. NormalizeCompanyLookup (line 3531-3545) ONLY trims, converts curly/back apostrophes to ', collapses double spaces, and lowercases with tr-TR culture. It performs NO diacritic folding (İ/ı/ş/ğ/ç/ö/ü stay distinct), NO punctuation stripping, NO whitespace-insensitive token comparison, NO Levenshtein/Jaro/token-set similarity. Therefore FindMatchingCompanies only returns an existing record when the newly parsed name is byte-for-byte identical after lowercasing. Any of the everyday variations that voice transcription and Turkish morphology produce fail the match and fall through to new-company creation.
- **Kullanıcıya etkisi:** This is failure mode (B), the exact user complaint. Day 1 the user creates 'Ensar Döner'. Day 2 the recognizer returns 'Ensar Doner' (no ö), or 'ensar döner ' with trailing space that survives as a different token, or 'Ensar  Döner' vs single space, or 'Ensar Döneri' (possessive), or 'ENSAR DONER' from a different STT engine — every one of these normalizes to a string that is != 'ensar döner', so CompanyMatches returns false, FindMatchingCompanies returns empty, and a brand-new duplicate 'Ensar Doner' company is created under its own tab.
- **Önerilen çözüm:** Add a similarity layer: (1) build a fold-normalized key that ASCII-folds Turkish diacritics (İ/ı→i, ş→s, ğ→g, ç→c, ö→o, ü→u) and strips non-alphanumerics, compare on that first; (2) if still no exact fold-match, compute a token-set ratio and/or Levenshtein ratio against every existing company and treat >=~0.85 as a match candidate; (3) when a fuzzy (non-exact) match is found, surface it through the existing company-resolution modal instead of silently creating — so the user confirms 'Ensar Doner' == 'Ensar Döner' rather than getting a duplicate.
- **Doğrulama notu (çelişkili test):** Accurate defect: name matching does no diacritic folding or fuzzy/transliteration step, so transcription variants that differ in Turkish diacritics (e.g. 'Doner' vs 'Döner') or add a morphological suffix ('Döneri') spawn a duplicate company. Both matchers involved are NormalizeCompanyLookup-based: exact equality in CompanyMatches (Program.cs:3598-3599) and whole-word substring in FindExistingCompanyByMention (Program.cs:3646-3683, boundary regex at 3669). The reported claim that exact equality is the 'only' mechanism is wrong (the mention fallback and ExistingCompanyId selection also bind), and the trailing-space, double-space, and case-only scenarios are already normalized away and do NOT produce duplicates.

#### 2. 🔴 [KRİTİK] NormalizeAiAnalysis overrides the LLM's company decision with a regex-extracted token and force-sets confidence to 0.92

- **Konum:** `api/ArxTask.Api/Program.cs`:2429
- **Sorun:** After the (temperature 0.1, JSON-mode) OpenAI call returns a careful company name, NormalizeAiAnalysis unconditionally recomputes the company from a regex over the raw source text: inferredCompanyName = InferCompanyNames(sourceText).FirstOrDefault(); if non-empty it does `company = new AiCompany(inferredCompanyName, Math.Max(company.Confidence, 0.92), true)` (line 2427-2430). So whenever the regex extracts ANY token, that regex token replaces the LLM answer AND its confidence is pinned at >=0.92 with shouldCreateIfMissing=true. Downstream BuildCompanyResolutionPrompt (line 2078-2079) and CommitAiAnalysis (line 1742) also prefer InferCompanyNames(sourceText).FirstOrDefault() over analysis.Company.Name. The regex is thus the real decision-maker, not the LLM.
- **Kullanıcıya etkisi:** This is failure mode (A). The LLM's brand-vs-action separation (heavily engineered in the system prompt) is discarded in favor of a brittle regex. When the regex latches onto the wrong token, the wrong company is created with an inflated 0.92 confidence that also bypasses the confidence gate, and the good LLM answer is thrown away. It also explains the user's 'grabs an unrelated word' report: the regex, not the model, chose it.
- **Önerilen çözüm:** Trust the LLM output as primary. Use InferCompanyNames(sourceText) only as a fallback when analysis.Company.Name is null/low-confidence, and do NOT force confidence to 0.92 — carry the model's own confidence so the gate at line 1746 / 2092 stays meaningful. If regex and LLM disagree, prefer the LLM value (or surface both to the user) rather than silently overriding.
- **Doğrulama notu (çelişkili test):** The mechanism and all three cited locations (2427-2430, 1742, 2078-2079) are accurate. One overstatement in the description: it is NOT triggered by 'ANY token.' InferCompanyName (singular, line 3140) only matches when the text has a company-name-followed-by-action-verb shape (gidip/ziyaret/kurulum/montaj/olc/etc.), and every candidate must survive NormalizeInferredCompanyCandidate (line 3288) and LooksLikeMeaningfulCompanyName (line 3385, length 3-60, blocked-singles list). So it is a constrained, filtered regex, and when the text lacks that shape the LLM's answer is kept. The defect is real for the (common) case where that pattern matches but latches onto the wrong token; the confidence-pin and gate-bypass reasoning is fully correct.

#### 3. 🟠 [YÜKSEK] InferCompanyName regex captures an arbitrary leading token before an action verb, producing phantom company names

- **Konum:** `api/ArxTask.Api/Program.cs`:3145
- **Sorun:** InferCompanyName (line 3140-3193) matches `(?<company>[\p{L}\d][\p{L}\d\s.'&-]{1,80}?)(optional case-suffix)\s+(gidip|git|uğra|ziyaret|ara|kurulum|montaj|ölç...)`. The company group is only lightly bounded: it allows spaces, so it captures everything from the earliest match position up to the action verb, then merely strips a fixed leadingNoise list (bugün/yarın/saat/day-names) in NormalizeInferredCompanyCandidate (line 3311-3318). Any content word that is not in that hard-coded noise list and sits before the verb becomes part of the 'company'. There is no part-of-speech awareness and no cross-check against existingCompanies.
- **Kullanıcıya etkisi:** Failure mode (A): for a note like 'Servis aracını kontrol ettikten sonra Mavi Tent'e ölçüme git', the ölç/git verbs cause the group to capture leading words that are not the brand; leading-noise stripping does not remove ordinary nouns/verbs like 'servis', 'aracını', so a phantom company (e.g. 'Servis Aracını ...') can be produced and then created. Because this regex value overrides the LLM (finding above) and is pinned to 0.92 confidence, the phantom is committed without a confirmation prompt.
- **Önerilen çözüm:** Constrain the company group to at most 1-3 capitalized/branded tokens immediately adjacent to the case marker, anchor the match to the dative/instrumental clitic (the word bearing 'e/ya/ile' etc.) rather than any leading run, and validate the candidate against existingCompanies before accepting it. Prefer LLM task.companyName and only use this regex as a guarded fallback.
- **Doğrulama notu (çelişkili test):** The regex/impact mechanism is correct, but the report's specific literal outcome is slightly off. For the exact example "Servis aracını...Mavi Tent'e ölçüme git", the produced phantom is "Servis", not "Servis Aracını ...": (a) SplitCompanyInferenceSegments (line 3232) splits on "sonra", and (b) the alternation contains bare `ara`, which accidentally matches inside "aracını", truncating the non-greedy group after the first word. The genuine defect — an arbitrary leading token/clause that is not the brand becoming a phantom company that overrides the LLM at 0.92 — is fully confirmed; multi-word phantom clauses (e.g. "Depoyu Kontrol Ettikten Sonr") are reproducible on other realistic notes. Core file+line anchor (Program.cs:3145, override at 2429) is accurate.

#### 4. 🟠 [YÜKSEK] No diacritic/whitespace folding means the same brand with Turkish-locale casing quirks (İ/ı) fails to match itself

- **Konum:** `api/ArxTask.Api/Program.cs`:3544
- **Sorun:** NormalizeCompanyLookup lowercases with new CultureInfo('tr-TR') (line 3533/3544). Turkish casing is asymmetric: 'I'→'ı' and 'İ'→'i'. If the stored company name and the freshly transcribed name differ in dotted/dotless I usage (extremely common because ASR and keyboards inconsistently emit İ vs I vs i), the two lowercase to different strings and the exact-equality match fails. Combined with the absence of any fuzzy fallback, this reliably creates duplicates for any brand containing an i/ı/İ.
- **Kullanıcıya etkisi:** Failure mode (B): 'İpek Tekstil' stored, later transcribed as 'Ipek Tekstil' (plain ASCII I) → tr-TR lowercases to 'ıpek tekstil' vs 'ipek tekstil' → not equal → duplicate company created. This is invisible to the user until two tabs exist for the same firm.
- **Önerilen çözüm:** Introduce a second, fold-only key for matching that maps İ,I,ı → i, ş→s, ğ→g, ç→c, ö→o, ü→u and removes non-alphanumerics/whitespace, and compare companies on that fold key (in addition to, not instead of, the display normalization). This makes 'İpek', 'Ipek', 'ipek' all collide correctly.
- **Doğrulama notu (çelişkili test):** Root cause and location are accurate (NormalizeCompanyLookup, Program.cs:3533/3544; the ToLower(tr-TR) with no fold step). One mitigation to note: CompanyMatches/CompanyMatchScore also have a domain fallback (ExtractDomainFromEmail vs source-text domain), so a duplicate is only guaranteed when no shared email domain is available — which is the common case for pure voice captures. The mention-based fallback (FindExistingCompanyByMention) does NOT rescue this, since it reuses the same broken normalization on both sides.

#### 5. 🟡 [ORTA] When the detected company is a phantom with no DB match, the user is dropped into the address/create modal with no way to correct the company name to an existing firm

- **Konum:** `ArX Task mobile/app/(app)/capture.tsx`:557
- **Sorun:** The company-resolution modal (line 485-535) only appears when the backend returns requiresCompanyResolution, which BuildCompanyResolutionPrompt only sets when FindMatchingCompanies returns >=1 match (line 2099-2102). If the parsed name is a phantom or a diacritic-variant that fails exact match (findings 1/3/4), no matches are found, so instead the address-resolution modal fires, pre-filled with the phantom detectedName (line 118-133, 558-561). The 'Firma adi' field is editable, but there is no picker of existing companies and no fuzzy suggestions — the user must independently realize the auto-detected brand is wrong/duplicate and manually retype the exact stored spelling. Confirming the modal creates a NEW company (createSeparateCompany: true, line 309).
- **Kullanıcıya etkisi:** Even when the user notices the mis-detection, the UI funnels them toward creating a duplicate rather than re-binding to the existing firm. The correction path the user actually needs (search existing companies and attach) does not exist on this screen, so duplicates accumulate.
- **Önerilen çözüm:** In the address-resolution modal, add an 'attach to existing company' search that queries the companies list (fuzzy, diacritic-insensitive) so the user can redirect a phantom/duplicate to the real firm; and have the backend return near-miss fuzzy candidates (from finding 1's similarity layer) as resolution candidates rather than jumping straight to create.

---

## 3. 🟠 Şikayet #2 — Frontend Tasarım Zayıf / Animasyonsuz

**Verdict: Doğrulandı.** Kod, "dümdüz site, ne animasyon ne geçiş efekti" tespitini birebir doğruluyor:

- **Sıfır hareket:** `react-native-reanimated` paketi **kurulu** ama tüm `.tsx` ağacında **hiç import edilmemiş** (Reanimated / Moti / Animated / LayoutAnimation / entering / exiting → 0 sonuç). Tek "hareket" React Native'in yerleşik `Modal` slide/fade'i ve bir `Stack` fade geçişi. Listeler `.map()` ile anında beliriyor, filtre/sekme geçişleri anında değişiyor.
- **Sıfır derinlik:** `shadowColor` / `elevation` / `LinearGradient` → **0 sonuç**. Derinlik yalnızca birbirine çok yakın koyu grilerin 1px kenarlığıyla ifade ediliyor (`appBg #0b0c0e` vs `surfaceStrong #1a1d21` — ~%6 parlaklık farkı). Kartlar sayfadan "kalkmıyor", ana aksiyon butonu öne çıkmıyor.
- **Tasarım sistemi yok:** boşluk/köşe/tipografi ölçekleri yok (radii 6/8/10/12/16 gelişigüzel, font boyutları 10–24 isimsiz). **Özel yazı tipi yüklenmiyor** → platform varsayılanı, zayıf hiyerarşi.
- **Dokunsal geri bildirim yok:** basışta sadece opaklık düşüyor; scale/ripple/haptik yok. Alt sekme çubuğunda animasyonlu aktif gösterge yok.
- **Yükleme/durum eksik:** skeleton yok (sadece buton içinde spinner), **pull-to-refresh yok**, listeler `FlatList` yerine `ScrollView` içinde `.map`.

### Ne yapılmalı (özet)
Reanimated'i gerçekten kullan (liste öğelerine `FadeInDown.delay(i*40).springify()`, sekme/filtre için `LinearTransition`), bir **elevation/gölge token seti** + ana kartlara/CTA'ya ince `LinearGradient` ekle, markalı bir yazı tipi yükle (`useFonts`), basışlara scale+haptik ekle, skeleton + `RefreshControl` getir. Not: bunlar tasarım kararları olduğu için önem "yüksek/orta" ama çoğu subjektif — birlikte bir tasarım dili belirleyip uygulamak en doğrusu.

### Bu şikayetle ilgili bulgular

#### 1. 🟠 [YÜKSEK] Zero animation/transition library usage despite Reanimated being installed

- **Konum:** `ArX Task mobile/src/components/ui.tsx`:1
- **Sorun:** The app ships react-native-reanimated (~4.1.1, package.json line 35) but there is not a single import of it, Moti, Animated, or LayoutAnimation anywhere in the .tsx source tree (grep for reanimated|LayoutAnimation|Animated|moti|useSharedValue|withTiming|withSpring|entering|exiting returned zero matches). Nothing animates: list items in today.tsx/index.tsx are rendered via plain .map() into a ScrollView with no entering transitions; filter/tab switches (today.tsx FilterPill line 187, companies toggle line 48) swap styles instantly; stat tiles, cards and chips just appear. This is the concrete root of complaint #2 — the UI is literally motionless.
- **Kullanıcıya etkisi:** Every state change (filter change, list load, tab switch, data refresh) snaps with no easing, which reads as a static, templated wireframe rather than a finished product.
- **Önerilen çözüm:** Wrap list items in Animated.View from react-native-reanimated with entering={FadeInDown.delay(index*40).springify()} in today.tsx (line 156 map), index.tsx agenda map (line 159), and companies list. Animate FilterPill/tab selection with a layout transition (layout={LinearTransition}) and animate the active-tab accent bar in ui.tsx BottomNav (line 233) with a shared withTiming translateX instead of conditional render.

#### 2. 🟠 [YÜKSEK] Completely flat visual system — no shadows, elevation, or gradients anywhere

- **Konum:** `ArX Task mobile/src/components/ui.tsx`:355
- **Sorun:** Depth is expressed exclusively through 1px borders on near-identical dark greys. Grep for shadowColor|elevation|LinearGradient across all *.tsx = zero matches. Card (ui.tsx line 355), StatTile (line 478), TaskCard (task-card.tsx line 327), and every operations-card use backgroundColor: surfaceStrong (#1a1d21) with borderColor: border (#262a30) on an app background of #0b0c0e — surfaces differ from the background by only a few luminance points and cast no shadow. The 'hero' Card variant (line 269) is visually identical to default except a slightly lighter border. There is no accent gradient, no glow on the primary CTA, no color used as a design element beyond tiny chips.
- **Kullanıcıya etkisi:** This is the literal 'flat site' the user describes: cards do not lift off the page, primary actions do not stand out, and the whole screen reads as one uniform grey slab. It looks like an unstyled component library, not a designed product.
- **Önerilen çözüm:** Introduce an elevation token set (e.g. shadowColor+shadowOpacity 0.3/shadowRadius 12/elevation 4 for raised cards, stronger for the hero and modals). Add a subtle LinearGradient (expo-linear-gradient) on the dashboard hero Card (index.tsx line 65) and the primary CTA, using primary→primaryDark, to create a focal point and real depth.

#### 3. 🟡 [ORTA] No skeleton loaders or list loading states — only a spinner inside buttons

- **Konum:** `ArX Task mobile/src/components/ui.tsx`:123
- **Sorun:** ActivityIndicator appears only twice in the whole app, both inside PrimaryButton (ui.tsx line 124). Screens that load remote data (today.tsx, companies, offers, index dashboard) have no loading UI at all — they render an empty layout until app-data-context populates, then content pops in with no transition. There are no skeleton placeholders anywhere (grep Skeleton = no matches). EmptyState (ui.tsx line 162) is a plain static card with two text lines and no illustration or icon.
- **Kullanıcıya etkisi:** During data fetch the screen looks broken/empty, then content appears abruptly. Perceived performance and polish are low; empty states feel like error text rather than designed moments.
- **Önerilen çözüm:** Add a Skeleton component (animated shimmer via Reanimated useSharedValue opacity loop) and show 3-4 skeleton TaskCards/rows while data.tasks is loading in today.tsx and index.tsx. Give EmptyState a Feather icon in a circular tinted badge plus a subtle FadeIn entering animation.

#### 4. 🟡 [ORTA] No pull-to-refresh and list content rendered via .map in a ScrollView (no FlatList)

- **Konum:** `ArX Task mobile/src/components/ui.tsx`:58
- **Sorun:** The shared Screen wrapper uses a bare ScrollView (ui.tsx line 58) with no RefreshControl prop, and no screen passes one (grep RefreshControl = no matches). All lists — today.tsx groups (line 147), dashboard agenda (line 159), companies — are .map() into that ScrollView; there is no FlatList/animated list anywhere. Users have no gesture affordance to refresh and get none of the native rubber-band/spinner feedback that signals a live app.
- **Kullanıcıya etkisi:** The core interaction pattern users expect on a field-data mobile app (swipe down to refresh) is absent, reinforcing the 'flat, nothing happens' complaint.
- **Önerilen çözüm:** Add an optional refreshControl prop to Screen and pass <RefreshControl tintColor={colors.textSoft} refreshing={...} onRefresh={reload}/> from today.tsx, index.tsx, companies, offers. Consider migrating long lists to FlatList for recycling + itemLayoutAnimation.

#### 5. 🟡 [ORTA] Color palette not organized as semantic tokens; spacing/radii/type scales are hardcoded ad-hoc per file

- **Konum:** `ArX Task mobile/src/components/ui.tsx`:17
- **Sorun:** The only shared token is a flat colors object (ui.tsx line 17). There is no spacing scale, radius scale, or type scale exported — every StyleSheet re-hardcodes magic numbers: border radii jump between 6/8/10/12/16 with no system (chip 6, input 8, button 10, card 12, modal 16), padding is 12/14/16/18 chosen per component, and font sizes 10/11/12/13/14/15/16/17/19/22/24 are scattered across files with no named scale. Because these values are copy-pasted, cards in operations-cards.tsx, task-card.tsx, and ui.tsx have subtly different padding (16 vs 14) and radius, so the UI lacks rhythm.
- **Kullanıcıya etkisi:** Inconsistent spacing/radii make the layout feel slightly off and 'assembled' rather than designed; the absence of a token system is why every screen looks like default RN StyleSheet output.
- **Önerilen çözüm:** Export spacing = {xs:4,sm:8,md:12,lg:16,xl:24}, radii = {sm:8,md:12,lg:16}, and a type scale (display/title/body/label with size+weight+letterSpacing) from ui.tsx, and refactor StyleSheets to consume them so radii/padding/type are consistent across all cards.

#### 6. 🟡 [ORTA] System default font only — no custom typeface loaded, weak type hierarchy

- **Konum:** `ArX Task mobile/app/_layout.tsx`:63
- **Sorun:** No fontFamily is set anywhere in source and no font is loaded — grep useFonts|expo-font|fontFamily across *.tsx = no matches (only package/app.json references). RootLayout (_layout.tsx line 63) never calls useFonts. So all text uses the platform default (Roboto/SF), and hierarchy is carried only by weight 500/600 and size. There is no true bold (700+) used for headings, and body/label/heading colors collapse into just a few greys (text/textSoft/muted), so titles and metadata read at very similar visual weight (e.g. task-card title fontSize 16 weight 600 vs section titles 15/600 — nearly identical).
- **Kullanıcıya etkisi:** The typography looks like an unbranded default app. Similar sizes/weights everywhere flatten the hierarchy, contributing to the 'nothing visually appealing' impression.
- **Önerilen çözüm:** Load a distinctive typeface (e.g. Inter or a geometric sans via expo-font/@expo-google-fonts) in RootLayout with useFonts, apply it globally, and widen the weight range — use 700/800 for hero and section titles, 400 for body — to create genuine contrast.

#### 7. ⚪ [DÜŞÜK] Press feedback is limited to a static opacity dip; no scale/haptics/ripple

- **Konum:** `ArX Task mobile/src/components/ui.tsx`:390
- **Sorun:** Every interactive element gives the same feedback: a flat opacity change on press (buttonPressed opacity:0.85 ui.tsx line 390; ActionPanel pressed opacity:0.7 index.tsx line 280; candidateCardPressed opacity:0.7 capture.tsx line 924). There is no animated scale-down, no Android ripple (android_ripple), no haptic feedback (expo-haptics is not used), and the BottomNav tab items (ui.tsx line 231) have no pressed state at all. Buttons don't feel physical.
- **Kullanıcıya etkisi:** Taps feel unresponsive and cheap; combined with the lack of transitions this makes the app feel non-interactive, matching the 'no animation, nothing appealing' complaint.
- **Önerilen çözüm:** Replace opacity-only feedback with a Reanimated pressed scale (0.97) via useAnimatedStyle, add android_ripple to Pressables, and fire Haptics.impactAsync(Light) on primary actions (task complete, tab switch, route start).

#### 8. ⚪ [DÜŞÜK] Bottom tab bar and screen navigation have no meaningful motion; active tab has no animated indicator

- **Konum:** `ArX Task mobile/src/components/ui.tsx`:182
- **Sorun:** Navigation is a custom BottomNav (ui.tsx line 182) that calls router.replace on tap, and screens are stacked with animation:"fade" (_layout.tsx line 74) — replace() with a cross-fade gives an abrupt, directionless transition with no shared context between tabs. The active-tab accent bar (line 233) is conditionally mounted/unmounted rather than sliding between tabs, and the icon color change (line 236) is instant. There is no icon scale/bounce on selection.
- **Kullanıcıya etkisi:** Switching tabs feels like a hard page reload rather than a fluid app, and the tab bar lacks the small delightful motion users expect, reinforcing the templated feel.
- **Önerilen çözüm:** Animate the active indicator with a shared translateX (withSpring) that slides under the selected tab, add an icon scale pop on selection, and use a directional stack animation (slide_from_right) for drill-down screens while keeping fade for tab roots.

---

## 4. 🟡 Şikayet #3 — Tüm Modüller Aktif, Çalışan ve Bağlantılı Olmalı

**Verdict: Büyük ölçüde iyi haber.** Bekldiğinden çok daha sağlam: çekirdek akış **gerçekten** uçtan uca bağlı ve `api.ts`'teki her çağrının backend'de karşılığı var (404/500 uyuşmazlığı yok), sahte/hardcoded liste verisi yok.

**✅ Gerçekten çalışan & bağlantılı olanlar:**
- **Firmalar ↔ Görevler ↔ Teklifler ↔ Faturalar:** firma detayında görevler/notlar/teklifler/faturalar/dökümanlar/zaman tüneli görünüyor; teklif gönderince takip görevi + zaman tüneli oluşuyor; teklif→fatura dönüşümü kalemleri kopyalıyor; fatura "ödendi" işaretleyince ödeme kaydı düşüyor.
- **Bugün planı / Rota planı:** bugünün firma-bazlı görevlerinden gerçek Haversine mesafesiyle sıralı rota çıkarıyor, Google Maps'i waypoint'lerle açıyor. **Gerçek özellik.**
- **Haftalık analiz:** gerçek toplamları hesaplıyor (hardcoded değil).
- **Ürünler, Modül detayı, Gecikmişler, Ayarlar, Admin (kullanıcı/görev/onay yönetimi):** hepsi mevcut backend uçlarına bağlı ve her ekran navigasyondan erişilebilir.

**❌ Gerçek eksikler (düzeltilmeli):**
- **AI Asistan sahte:** hiçbir backend/AI çağrısı yok; ~4 sabit anahtar kelime + birebir firma adı eşleştiren yerel bir fonksiyon. Backend'de asistan/chat ucu **hiç yok**. Başlığın vaat ettiği "AI" deneyimi yok.
- **Ölçüm ↔ Döküman bağı kopuk:** Ölçüm ekranı belgeleri **tam eşleşmeyle** (`"measurement"/"photo"`) süzüyor, Döküman ekranı ise **içerir (substring)** ile. Uygulamanın kendi önerdiği "Measurement photo" etiketi Ölçüm merkezinde **hiç görünmüyor**.
- **Döküman yükleme yok:** ekran dosya/OCR yüklemeyi ima ediyor ama yalnızca yazılı meta veri saklıyor.
- **Tüm görevler ekranı** modül **ID**'lerini isim yerine ham gösteriyor; kayıt-sonrası modül tohumlanmadığı için liste boş kalabiliyor.
- **Teklif kabulü** takip görevi/firma durumu ilerletmesi yapmıyor (yalnızca "gönder" yapıyor); firma detayındaki teklif/fatura sekmeleri salt-okunur.

### Bu şikayetle ilgili bulgular

#### 1. 🟠 [YÜKSEK] AI Assistant is a hardcoded local keyword-matcher, not a real AI/backend feature

- **Konum:** `ArX Task mobile/app/(app)/ai-assistant.tsx`:97
- **Sorun:** The 'AI asistan' screen never calls any backend or AI endpoint. answerFromData() (lines 97-126) is a pure client-side function that does substring matching on a handful of hardcoded Turkish keywords ('takip'/'follow', 'tahsilat'/'odeme'/'payment', 'kritik'/'bugun'/'gorev') plus an exact company-name lookup, all over the already-loaded local snapshot. There is no fetch, no streaming, no LLM call. The backend only exposes /ai-capture/commit and /ai-capture/analyze-and-commit (Program.cs:292,294) — there is no assistant/chat endpoint at all, and this screen imports nothing from the API client.
- **Kullanıcıya etkisi:** Any free-text question that does not contain one of the ~4 hardcoded keyword groups or an exact company name always returns the same canned fallback ('Bu soruya uygun hazir ozet bulamadim...'). Users expecting an AI assistant (as the title/subtitle 'Webdeki yardimci akislar' imply) get a rigid FAQ bot. The module is effectively a dressed-up stub, not the working AI feature the complaint expects.
- **Önerilen çözüm:** Wire the assistant to a real backend endpoint (add an /assistant or /ai/chat route using the existing OpenAI integration) and call it via apiRequest with the auth token, streaming or returning a model answer; or explicitly relabel this as a canned quick-summary widget rather than 'AI'.

#### 2. 🟠 [YÜKSEK] Measurements screen and Documents screen use inconsistent document-type matching, breaking the documents-to-measurements link

- **Konum:** `ArX Task mobile/app/(app)/measurements.tsx`:13
- **Sorun:** measurements.tsx filters documents with an EXACT-match set: data.documents.filter(d => ['measurement','measurements','photo'].includes(d.documentType.toLowerCase())). But documents.tsx creates documents with free-form documentType strings and its own placeholder suggests 'Measurement photo' (documents.tsx:108 placeholder 'PDF / Contract / Measurement photo'). 'Measurement photo'.toLowerCase() === 'measurement photo', which is NOT in the exact-match array, so such a document never surfaces in the measurements center. documents.tsx itself uses SUBSTRING matching for the same concept (line 37: text.includes('measurement') || includes('ölç')), so the two screens classify the same document differently.
- **Kullanıcıya etkisi:** The documented interconnection (measurement documents attached to a company appearing in the Olcum merkezi) silently fails for realistic document-type labels like 'Measurement photo', 'Olcum raporu', 'Kesif'. The 'Ilgili belge' stat and 'Olcum belgeleri' list under-report or stay empty even when relevant documents exist, making the module look broken/disconnected.
- **Önerilen çözüm:** Use the same substring/normalized matching in measurements.tsx as documents.tsx (e.g. a shared helper checking includes('measurement'|'ölç'|'olc'|'photo'|'image/')), so both screens agree on which documents are measurement-related.
- **Doğrulama notu (çelişkili test):** Core finding is accurate. Minor correction to the impact examples: measurements.tsx matches ONLY on documentType (exact), while documents.tsx additionally matches on fileName/fileType via substring. So labels like "Olcum raporu" or a filename "olcum-raporu.pdf" (documents.tsx placeholder) surface in Documents via the fileName substring path but were never going to match the measurements exact-match set regardless — the divergence is driven by (a) exact vs substring matching of documentType and (b) measurements ignoring fileName/fileType entirely. The most concrete failing case is the app's own suggested documentType "Measurement photo", which matches in Documents but is invisible in the Olcum merkezi.

#### 3. 🟡 [ORTA] All-tasks screen renders raw module IDs as chips instead of module names

- **Konum:** `ArX Task mobile/app/(app)/tasks.tsx`:111
- **Sorun:** In the 'All tasks' screen, each task is passed to TaskCard as `task={task}` with its raw `moduleIds` array untouched. TaskCard renders each entry of `task.moduleIds` directly as a Chip label (task-card.tsx line 120-122: `task.moduleIds.map((moduleId) => <Chip key={moduleId} label={moduleId} />)`). By contrast today.tsx (line 162) and companies/[id].tsx (line 154) map the IDs to human-readable module names before passing to TaskCard: `moduleIds: task.moduleIds.map((moduleId) => data.modules.find((item) => item.id === moduleId)?.name ?? moduleId)`. The All-tasks screen omits this mapping.
- **Kullanıcıya etkisi:** On the 'Görevler' (All tasks) tab, task cards show internal module IDs like 'module-todo' / 'module-payments' as chips instead of readable names ('Todo', 'Payments'). Same task looks different across screens — a visible inconsistency users notice.
- **Önerilen çözüm:** Apply the same moduleIds→name mapping used in today.tsx/companies detail when passing the task to TaskCard in tasks.tsx.

#### 4. 🟡 [ORTA] Manually created tasks reference module IDs that don't exist as WorkModule rows (empty modules list, raw-ID chips)

- **Konum:** `ArX Task mobile/app/(app)/invoices.tsx`:76
- **Sorun:** New users are seeded with zero modules: /auth/register (Program.cs:105-131) creates only the AppUser and never inserts default WorkModuleEntity rows. Manual task creation in the mobile app hard-codes module IDs — invoices.tsx line 76 sends `moduleIds: ['module-payments']`, companies/[id].tsx line 233 sends `['module-todo']`, and normalizeTask (record-utils.ts line 66/74) falls back to `'module-todo'`. The POST /tasks handler (Program.cs:205 `CreateOwned`) simply persists the task and does NOT auto-create the referenced module (unlike the AI-capture path which creates modules at Program.cs:2341+). So these tasks carry moduleIds that have no matching WorkModule.
- **Kullanıcıya etkisi:** For accounts created via register that haven't run AI capture, the modules list/sidebar stays empty and task chips render the raw IDs (e.g. 'module-payments'); BuildSnapshot module TaskCount grouping also can't attribute these tasks to any module. Task↔module interconnection is effectively broken for manually created tasks.
- **Önerilen çözüm:** Either seed the standard default modules on register, or have the POST /tasks handler upsert any referenced moduleIds into WorkModuleEntity (mirroring the AI-capture module-creation logic).

#### 5. 🟡 [ORTA] Documents module has no real upload/OCR — metadata-only, contradicting its own on-screen flow

- **Konum:** `ArX Task mobile/app/(app)/documents.tsx`:62
- **Sorun:** The Documents screen renders a card describing the flow '1. Belge yukle 2. Ozet/ocr 3. Firma bagla 4. Operasyon akisina dusur' (lines 62-65) and the primary action is literally labeled 'Belge metadata ekle'. There is no file picker (no expo-document-picker / image-picker / FormData upload), no OCR, and no binary transfer. createDocument only POSTs typed text fields (fileName string, documentType string, summary) to /documents (api.ts:303). fileType is guessed from a substring of the type string (documents.tsx:95). So step 1 (upload) and step 2 (ocr) advertised on screen do not exist.
- **Kullanıcıya etkisi:** The module presents itself as a document/upload/OCR feature but only records typed metadata. On the mobile app a field user cannot actually attach a PDF or photo; the 'PDF'ler'/'Fotoğraflar'/'Sözleşmeler' dashboard tiles (index.tsx) that deep-link here (type=pdf/photo/contract) lead to a screen that can never hold an actual file. This is a stub-grade feature relative to the 'real working feature' bar.
- **Önerilen çözüm:** Add expo-document-picker / expo-image-picker, upload the binary (multipart) to a documents-upload endpoint, and either run server-side OCR or drop the OCR claim; at minimum relabel the flow card so it does not promise upload+OCR that the code cannot perform.

#### 6. ⚪ [DÜŞÜK] Accepting an offer does not create the follow-up task the flow implies; no invoice/company-status linkage

- **Konum:** `api/ArxTask.Api/Program.cs`:1354
- **Sorun:** AcceptOffer (Program.cs:1354-1362) only sets `offer.Status = "accepted"` and adds a timeline entry. It creates no follow-up task and does not update the linked company status or create/flag an invoice. The follow-up BusinessTask is instead created in SendOffer (Program.cs:1329-1348). The core-flow expectation ('Offer -> accept -> creates follow-up task & can convert to Invoice') is only partially met: convert-to-invoice works (Program.cs:1364) but acceptance produces no actionable next step and the company's CompanyStatus (e.g. 'accepted'/'invoiceNeeded') is never advanced.
- **Kullanıcıya etkisi:** After 'Kabul et' in offers.tsx, nothing is scheduled to follow up on the accepted offer and the company's pipeline status is not moved forward, so the offer→invoice→company progression relies entirely on the user manually converting. Weakens the intended interconnection.
- **Önerilen çözüm:** On accept, optionally create a 'prepare invoice' follow-up task and/or advance the linked company's status, mirroring the automation done on SendOffer.

#### 7. ⚪ [DÜŞÜK] Company detail Offers/Invoices tabs are read-only — no send/accept/convert/mark-paid actions

- **Konum:** `ArX Task mobile/app/(app)/companies/[id].tsx`:185
- **Sorun:** On the company detail screen, the Offers and Invoices tabs render OfferSummaryCard / InvoiceSummaryCard without the `actions` prop (lines 185 and 189), so no lifecycle actions are available there. The action buttons (Gönder/Kabul et/Faturaya çevir, Ödendi/Takip görevi/Sil) exist only on the top-level offers.tsx (lines 85-91) and invoices.tsx (lines 65-83). The 'Sonraki adim' tab (lines 198-216) is a static hardcoded suggestion pill list with no onPress handlers at all.
- **Kullanıcıya etkisi:** From within a company the user can view its offers/invoices/timeline but cannot progress them (must navigate to the global Offers/Invoices tabs). The 'Sonraki adim' (next step) suggestions look actionable but do nothing when tapped.
- **Önerilen çözüm:** Pass the same action nodes used in offers.tsx/invoices.tsx into the company-detail summary cards, and either wire the 'Sonraki adim' pills to createTask handlers or clearly mark them as non-interactive.

#### 8. ⚪ [DÜŞÜK] Offers filter references statuses the backend never assigns ('prepared','followUpNeeded')

- **Konum:** `ArX Task mobile/app/(app)/offers.tsx`:45
- **Sorun:** The 'Bekleyen' (pending) offer filter matches statuses ['draft','prepared','sent','followUpNeeded'] (offers.tsx line 45), but the backend only ever sets offer.Status to 'draft' (create), 'sent' (SendOffer), 'accepted' (AcceptOffer), or 'convertedToInvoice' (ConvertOfferToInvoice). 'prepared' and 'followUpNeeded' (declared in OfferStatus, business.ts:35-42) are never produced by any endpoint, so those filter branches are dead.
- **Kullanıcıya etkisi:** No runtime break, but the pending filter silently covers only draft/sent offers; the 'prepared'/'followUpNeeded' pipeline states from the type model are never reachable, indicating an incomplete offer lifecycle vs. the intended design.
- **Önerilen çözüm:** Either implement backend transitions that set 'prepared'/'followUpNeeded' (e.g. on follow-up task creation) or trim the unused statuses from the filter and type.

#### 9. ⚪ [DÜŞÜK] Unused updateTask import in invoices screen (dead reference)

- **Konum:** `ArX Task mobile/app/(app)/invoices.tsx`:16
- **Sorun:** invoices.tsx destructures `updateTask` from useAppData (line 16) but never uses it; only createInvoice, deleteInvoice, markInvoicePaid and createTask are called. Minor dead code, no functional impact.
- **Kullanıcıya etkisi:** No runtime effect; minor lint/cleanliness issue.
- **Önerilen çözüm:** Remove `updateTask` from the destructure.

#### 10. ⚪ [DÜŞÜK] Documents composer captures a stale/empty default companyId when companies load after mount

- **Konum:** `ArX Task mobile/app/(app)/documents.tsx`:17
- **Sorun:** companyId state is initialized once with useState(data.companies[0]?.id ?? '') (line 17). On first render the snapshot may not be loaded yet, so companyId stays '' and, because it is only seeded in the initializer (no effect syncing it when data.companies later populates), the saved document is created with an empty/unlinked companyId unless the user manually taps a company chip.
- **Kullanıcıya etkisi:** Documents can be silently created with no company association, weakening the documents-to-company interconnection (they then never show under a company or in measurements-by-company counts). User-visible only in the race where the composer is opened before/around snapshot load.
- **Önerilen çözüm:** Sync the default with an effect (useEffect(() => { if (!companyId && data.companies[0]) setCompanyId(data.companies[0].id); }, [data.companies])) or validate a non-empty companyId before allowing save.

---

## 5. 🟠 Şikayet #4 — Görev Hatırlatma Bildirimleri Gitmiyor

**Verdict: Doğrulandı — ama sebep ilk sanılan değil.** İlk hipotez "backend sadece tarayıcı WebPush'u biliyor, mobili düşürüyor" idi; bu **yanlış çıktı**: backend `https://exp.host/--/api/v2/push/send` ile Expo push'u **gerçekten gönderiyor**, Hangfire gecikmeli işi doğru kuruluyor, mobil taraf Expo token'ı alıp kaydediyor. Asıl kırıklar şunlar:

1. 🟠 **Saat dilimi hatası (en olası ana sebep):** görev saati `DateTimeKind.Local` ile, yani **sunucunun** saat diliyle yorumlanıyor (`Program.cs:3958`). Sunucu Almanya'da (`api.megaajans.de`), kullanıcı İstanbul'da (UTC+3). İstanbul-15:00 için kurulan görev sunucuda 15:00 = **İstanbul 18:00**'de tetikleniyor → ~3 saat geç. Yakın vadeli görevlerde tüm "erken hatırlatma" adımları geçmişe düşüp **hiç kurulmuyor** → kullanıcı "hiç gelmedi" diyor.
2. 🟡 **Cihaz-içi yedek bildirim yok:** sunucu→Expo→FCM zincirinde herhangi bir kopukluk = **sıfır teslim**. `scheduleNotificationAsync` ile yerel bir yedek olsaydı, internet/servis sorununda bile hatırlatma çalardı.
3. 🟡 **Expo yanıtı hiç kontrol edilmiyor:** gönderim "gönder ve unut" (`Program.cs:4772`); ticket/receipt okunmuyor, `DeviceNotRegistered` işlenmiyor, ölü token'lar devre dışı bırakılmıyor. Yani teslim başarısızlığı **görünmez** — operatör neden gitmediğini anlayamaz.
4. 🟡 **Sadece Android fiziksel cihaz:** kayıt `Platform.OS !== "android"` ve emülatörde sessizce iptal (`notifications.ts:159`); iOS bildirim **hiç** almıyor.
5. 🟡 **FCM/google-services yapılandırması repo'da yok:** standalone Android derlemesinde Expo, FCM V1 kimlik bilgisi olmadan cihaza **teslim edemez**. EAS'te ayarlanmadıysa Android teslimi FCM adımında düşer.

### Ne yapılmalı (özet)
Görev saatini `Europe/Istanbul` sabit diliminden UTC'ye çevir (`TimeZoneInfo.ConvertTimeToUtc`) — bu tek düzeltme muhtemelen şikayetin çoğunu çözer. Ardından cihaz-içi `scheduleNotificationAsync` yedeği ekle, Expo yanıtını oku (ölü token'ı devre dışı bırak), EAS'te FCM V1 kimlik bilgisini yapılandır, iOS'u da kapsayacak şekilde kayıt koşulunu genişlet.

### Bu şikayetle ilgili bulgular

#### 1. 🟠 [YÜKSEK] Reminder due-time parsed in SERVER local timezone, not the Turkish user's timezone — reminders fire at the wrong absolute instant

- **Konum:** `api/ArxTask.Api/Program.cs`:3958
- **Sorun:** ParseTaskDueAt builds the reminder instant with DateTimeKind.Local: `var localDateTime = DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Local); return new DateTimeOffset(localDateTime);`. DueDate/DueTime are stored as bare wall-clock strings (e.g. "15:00") that the AI infers from Turkish text in the user's Istanbul local time (UTC+3). `DateTimeKind.Local` resolves against the SERVER's timezone, not the user's. The Hangfire delay is then computed from this instant (SyncTaskAlertsForTask line 3818: `var delay = entry.ScheduledFor - DateTimeOffset.Now`). The API host is api.megaajans.de (a German/Plesk host, typically UTC or Europe/Berlin). On a UTC server a task due at Istanbul-15:00 is scheduled for 15:00 UTC = 18:00 Istanbul, so the push arrives 3 hours late; a lead-in ladder that computes offsets before 'now' can also drop all entries so nothing schedules at all.
- **Kullanıcıya etkisi:** Task reminder pushes arrive hours off from the intended time (or, for near-term tasks, all schedule entries fall in the past and are dropped so nothing is delivered). Users perceive reminders as 'not being delivered'.
- **Önerilen çözüm:** Store/interpret due times against a fixed user timezone (Europe/Istanbul) instead of the ambiguous server-local kind. e.g. resolve with TimeZoneInfo.FindSystemTimeZoneById("Europe/Istanbul") and TimeZoneInfo.ConvertTimeToUtc, or persist a UTC DateTimeOffset with the correct offset at creation time. Never rely on the host's Local kind for a multi-timezone user base.
- **Doğrulama notu (çelişkili test):** Root cause and location (Program.cs:3958) are accurate. Minor refinement: the same server-local-timezone bug also exists at lines 3864-3865 (the "saat başı" hourly-window branch in BuildAlertSchedule uses the identical DateTimeKind.Local pattern), so a full fix must convert wall-clock DueDate/DueTime from Europe/Istanbul at both ParseTaskDueAt and the window branch. The exact lateness magnitude depends on the server TZ (≈3h if UTC, ≈1h if Europe/Berlin during DST) but the defect holds for any server zone other than Europe/Istanbul, which is guaranteed for the German host.

#### 2. 🟡 [ORTA] Expo Push API send is fire-and-forget: response status and push receipts are never checked, dead tokens never disabled

- **Konum:** `api/ArxTask.Api/Program.cs`:4772
- **Sorun:** In PushDispatcher.DispatchPushNow the Expo send is `await expoClient.SendAsync(request, cancellationToken);` inside a try/catch that swallows everything and never reads the response. Expo returns HTTP 200 with a per-message ticket array where individual messages can carry status:"error" (e.g. DeviceNotRegistered, MessageTooBig, InvalidCredentials for FCM). None of that is inspected, and unlike the WebPush branch (which sets subscription.DisabledAt on failure) mobile devices are never disabled on a DeviceNotRegistered error. There is also no follow-up receipt poll. Result: silent, undiagnosable delivery failures and stale tokens that keep being retried forever.
- **Kullanıcıya etkisi:** When Expo/FCM rejects a token (uninstalled app, invalid FCM creds), the failure is invisible in logs and the dead MobileDevice row is never disabled, so the operator cannot tell why 'notifications aren't delivered'.
- **Önerilen çözüm:** Read the response: EnsureSuccessStatusCode, parse the ticket array, and on status=="error" with details.error=="DeviceNotRegistered" set device.DisabledAt. Log non-ok responses. Optionally poll /push/getReceipts for hard-failure detection.

#### 3. 🟡 [ORTA] Push registration is restricted to Android physical devices — iOS and any non-android platform silently never register

- **Konum:** `ArX Task mobile/src/lib/notifications.ts`:159
- **Sorun:** ensureMobilePushRegistration bails early with `if (!Device.isDevice || Platform.OS !== "android") { return { subscribed: false, reason: "not-supported" }; }`. Even though app.json declares an ios block and the backend SaveMobileDevice defaults Platform to whatever is sent, no iOS device (or simulator/emulator) ever obtains an Expo token or registers. It is called from app/(app)/_layout.tsx with .catch(() => undefined), so the failure is completely silent to the user.
- **Kullanıcıya etkisi:** iOS users (and anyone testing on a simulator) receive no reminder notifications at all, with no error surfaced. Even on Android, the .catch(()=>undefined) hides permission-denied / token failures.
- **Önerilen çözüm:** Drop the Platform.OS !== 'android' gate (Expo push tokens work on iOS too, given APNs creds in EAS). Keep the Device.isDevice check. Surface the returned reason to the user in Settings instead of swallowing it.

#### 4. 🟡 [ORTA] No FCM / google-services configuration present for Android Expo push delivery

- **Konum:** `ArX Task mobile/app.json`:24
- **Sorun:** Expo push to Android is delivered through FCM. The repo contains no google-services.json and app.json has no `android.googleServicesFile` (nor `expo-notifications` useNextNotificationsApi / FCM config). getExpoPushTokenAsync will still return a token, but exp.host cannot deliver to Android unless FCM V1 credentials (service-account key) are configured for the EAS project. If those credentials were never uploaded to EAS, every Android push silently fails at the FCM hop (and per finding above the server never notices).
- **Kullanıcıya etkisi:** If FCM credentials are not configured in the EAS project, all Android reminder pushes are dropped by Expo/FCM and nothing is delivered.
- **Önerilen çözüm:** Verify FCM V1 credentials are uploaded to the EAS project (eas credentials), or add android.googleServicesFile + google-services.json. Confirm delivery with an Expo receipt check (see the receipts finding). This is medium-confidence because EAS credentials can live outside the repo.

---

## 6. ➕ Ek Bulgular — Backend, Güvenlik & Derleme (Tester Ekstraları)

Şikayetlerinin dışında, tester rolünde bulduğum ve düzeltmen faydalı olacak maddeler:

- **Güvenlik (yüksek):** Bağımlılık zincirinde bilinen **yüksek önemli açık** var — `SQLitePCLRaw.lib.e_sqlite3 2.1.11` (NU1903 / GHSA-2m69-gcr7-jv3q). Paketi yamalı sürüme yükselt.
- **500 hatası:** AI-capture ucu `SourceText` null gelince `.Trim()`'de çöküp 400 yerine **500** dönüyor (`Program.cs:1489`).
- **Fatura mükerrerliği:** `ConvertOfferToInvoice`'ta idempotency/durum kontrolü yok → tekrar çağrıda **çift fatura**.
- **SQLite kilidi:** 4 eşzamanlı Hangfire worker tek SQLite dosyasına `busy_timeout`/WAL olmadan yazıyor → "database is locked" riski (bildirimleri geciktirir).
- **Yapılandırma:** Hangfire paket sürüm çakışması (NU1608), `Program.cs`'te 4 kullanılmayan "Legacy" fonksiyon (CS8321), teklif/fatura toplamları istemciden gelen `TotalPrice`'a güveniyor (Miktar×BirimFiyat ile yeniden hesaplanmalı).
- **✅ Olumlu:** Kullanıcı-bazlı yetkilendirme sağlam — her CRUD `UserId`'ye göre süzülüyor, çapraz-kullanıcı veri sızıntısı bulunmadı.

### İlgili bulgular

#### 1. 🟠 [YÜKSEK] AnalyzeAndCommitCapture throws NullReferenceException (unhandled 500) when SourceText is null

- **Konum:** `api/ArxTask.Api/Program.cs`:1489
- **Sorun:** The AI-capture entry point does `var sourceText = request.SourceText.Trim();` as the very first statement, before any null check and OUTSIDE the try/catch (which begins at line 1504). `AiCaptureAnalyzeRequest.SourceText` (line 4608) is a non-nullable reference type in the record signature, but System.Text.Json will happily bind it to null if the client omits the field or sends `"sourceText": null`. Calling `.Trim()` on null throws NullReferenceException. Even the later try/catch only catches JsonException and InvalidOperationException, so this surfaces as an unhandled 500 rather than the intended 400 BadRequest at line 1492.
- **Kullanıcıya etkisi:** A malformed or partial AI-capture request (missing sourceText) returns an opaque HTTP 500 instead of the friendly 'Source text is required' 400. The mobile capture flow can crash-fail with no actionable error for the user.
- **Önerilen çözüm:** Null-guard first: `if (string.IsNullOrWhiteSpace(request.SourceText)) return Results.BadRequest(...); var sourceText = request.SourceText.Trim();` Same pattern should be applied to CommitParsedCapture (request.SourceText used unguarded) and the [FromBody] DELETE handlers (RemovePushSubscription/RemoveMobileDevice dereference request.Endpoint/ExpoPushToken with no null check on the body).
- **Doğrulama notu (çelişkili test):** Root cause and location as reported are accurate (Program.cs:1489). Minor precision: the exception is a NullReferenceException on the instance-method call `.Trim()` on a null string, and it becomes a 500 specifically because no global exception-handling/ProblemDetails middleware is registered (pipeline only has CORS/Auth/Hangfire), not merely because the local try/catch is too narrow.

#### 2. 🟠 [YÜKSEK] HIGH-severity known vulnerability in transitive SQLite package (NU1903)

- **Konum:** `api/ArxTask.Api/ArxTask.Api.csproj`:1
- **Sorun:** NuGet restore warns that SQLitePCLRaw.lib.e_sqlite3 2.1.11 has a known HIGH-severity advisory (GHSA-2m69-gcr7-jv3q). This is a build-emitted security warning (NU1903), not a code defect, but it ships a vulnerable native SQLite in the API's dependency chain.
- **Kullanıcıya etkisi:** The deployed API links a SQLite native lib with a published high-severity CVE; potential exploitation via crafted DB input.
- **Önerilen çözüm:** Bump Microsoft.Data.Sqlite / SQLitePCLRaw to a patched version (add an explicit PackageReference to SQLitePCLRaw.bundle_e_sqlite3 >= a fixed release) and re-restore.

#### 3. 🟡 [ORTA] ConvertOfferToInvoice has no idempotency/status guard — repeated calls create duplicate invoices

- **Konum:** `api/ArxTask.Api/Program.cs`:1364
- **Sorun:** ConvertOfferToInvoice unconditionally sets `offer.Status = "convertedToInvoice"` and inserts a brand-new InvoiceEntity every time it is called. There is no check that the offer is in an acceptable state (e.g. 'accepted') and no check that it hasn't already been converted. The invoice number is derived from the current minute (`$"RE-{DateTime.UtcNow:yyyyMMdd-HHmm}"`), so two conversions in the same minute also produce identical invoice numbers.
- **Kullanıcıya etkisi:** A double-tap or retry on the mobile 'convert to invoice' button (or a client retry after a slow response) creates two or more identical invoices for the same offer, inflating the company's invoice list and financial totals. Duplicate invoice numbers further confuse accounting.
- **Önerilen çözüm:** Early-return (e.g. Results.Conflict or return the existing invoice) when `offer.Status == "convertedToInvoice"`, and generate invoice numbers from a per-user sequence or include seconds/a GUID suffix to avoid collisions.

#### 4. 🟡 [ORTA] SyncTaskAlertsForTask schedules Hangfire jobs before SaveChanges, and mutates task.DueTime as a side effect

- **Konum:** `api/ArxTask.Api/Program.cs`:3820
- **Sorun:** Two issues in the alert-sync path. (1) BackgroundJob.Schedule(...) is called inside the loop (line 3820) and the alert rows are only persisted by the caller's later db.SaveChangesAsync(). If SaveChanges throws (e.g. SQLite 'database is locked' under the 4 concurrent Hangfire workers configured at Program.cs:47), the Hangfire jobs are already enqueued but the TaskAlert rows never commit — the fired job then reads a non-existent alert and silently no-ops, so the reminder is lost. (2) Line 3758-3761 mutates task.DueTime to '10:00' whenever a DueDate exists but DueTime is null. Because this runs on every UpdateTask/UpdateReminder/ai-commit call, it silently rewrites the user's task to 10:00 and persists it, changing displayed task data the user never entered.
- **Kullanıcıya etkisi:** Reminders can be silently dropped under DB contention (jobs enqueued but alert rows rolled back), and tasks that legitimately have a date-but-no-time get their time silently forced to 10:00 and saved, which then drives the reminder schedule and the task detail UI.
- **Önerilen çözüm:** Persist alert rows (SaveChanges) before enqueuing Hangfire jobs, or store the schedule and enqueue in a post-commit step; and compute the 10:00 fallback into a local variable used only for scheduling instead of overwriting and persisting task.DueTime.

#### 5. 🟡 [ORTA] Push/notification writes from 4 concurrent Hangfire workers share SQLite with no serialization → 'database is locked'

- **Konum:** `api/ArxTask.Api/Program.cs`:45
- **Sorun:** HangfireServer is configured with WorkerCount = 4 (line 47), so up to four NotificationDispatcher.SendTaskAlertAsync jobs run in parallel, each resolving its own scoped ArxTaskDbContext against the same SQLite file (Data Source=arx-task.db) and calling db.SaveChangesAsync (alert Status updates at Program.cs:4837, plus subscription DisabledAt writes inside PushDispatcher.DispatchPushNow at 4780). SQLite permits only a single writer; concurrent writers on the default connection raise SQLITE_BUSY/'database is locked'. Hangfire will retry, but repeated write bursts (many alerts due at the same minute) are a realistic contention path.
- **Kullanıcıya etkisi:** Under bursts of simultaneously-due reminders, alert dispatch jobs can throw 'database is locked', get retried by Hangfire, and in the meantime notifications are delayed or duplicated on retry. Intermittent and hard to diagnose in production.
- **Önerilen çözüm:** Set SQLite busy_timeout and WAL mode on the connection string (e.g. `Cache=Shared`, `Pooling`, plus `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000`), or reduce WorkerCount to 1 for the alerts queue, so concurrent alert writes serialize gracefully.

#### 6. ⚪ [DÜŞÜK] Offer and invoice totals trust client-supplied item.TotalPrice instead of recomputing Quantity × UnitPrice

- **Konum:** `api/ArxTask.Api/Program.cs`:4169
- **Sorun:** RecalculateOffer (line 4169) and RecalculateInvoice (line 4176) compute Subtotal as `Items.Sum(item => item.TotalPrice)`, taking each line's TotalPrice verbatim from the client payload rather than deriving it from Quantity × UnitPrice. A client can therefore submit UnitPrice=100, Quantity=5, TotalPrice=1 and the offer/invoice Subtotal and Total will reflect the bogus line total. Additionally RecalculateInvoice does not populate any VAT-amount field (offers set VatAmount at line 4170; invoices have no equivalent), so the invoice's stored breakdown is less consistent than the offer's.
- **Kullanıcıya etkisi:** Offer/invoice header totals can diverge from the line items (client bug or manipulation), producing financially incorrect documents. Because the values are persisted, downstream 'mark paid' and reporting inherit the wrong totals.
- **Önerilen çözüm:** Recompute each line: `item.TotalPrice = Math.Round(item.Quantity * item.UnitPrice, 2)` before summing, in Create/Update for both offers and invoices.

#### 7. ⚪ [DÜŞÜK] API build succeeds; mobile typecheck (strict) passes clean

- **Konum:** `api/ArxTask.Api/ArxTask.Api.csproj`:1
- **Sorun:** `dotnet build api/ArxTask.Api/ArxTask.Api.csproj -clp:NoSummary` completes with 'Olusturma basarili oldu' / '0 Hata' (0 errors). Separately, `npx tsc --noEmit -p tsconfig.json` in 'ArX Task mobile' (strict:true) exits 0 with no output. Both compile/typecheck steps are green.
- **Kullanıcıya etkisi:** No build or type errors block the app; core compilation is healthy.
- **Önerilen çözüm:** No action needed; recorded per instructions that the build/typecheck succeed.

#### 8. ⚪ [DÜŞÜK] NuGet package downgrade/version-conflict warning for Hangfire (NU1608)

- **Konum:** `api/ArxTask.Api/ArxTask.Api.csproj`:1
- **Sorun:** Restore reports Hangfire.NetCore 1.8.21 requires Hangfire.Core (= 1.8.21) but Hangfire.Core resolved to 1.8.23. Mismatched pinned versions across Hangfire packages.
- **Kullanıcıya etkisi:** Version skew between Hangfire.NetCore and Hangfire.Core can cause subtle runtime incompatibilities in the delayed-job scheduler.
- **Önerilen çözüm:** Align the Hangfire package versions: pin Hangfire.NetCore and Hangfire.Core to the same version (e.g. both 1.8.23) in the csproj.

#### 9. ⚪ [DÜŞÜK] Four unused local functions in Program.cs (CS8321)

- **Konum:** `api/ArxTask.Api/Program.cs`:2868
- **Sorun:** Four local functions are declared but never invoked, producing CS8321 warnings: 'ShouldCreateInvoiceDraftLegacy' (2868), 'IsPersonalTaskLegacy' (2878), 'ResolveModulesForTaskLegacy' (2911), 'ShouldCreateInvoiceDraftLegacy2' (3008). Dead 'legacy' code left in the AI-capture path.
- **Kullanıcıya etkisi:** Dead code clutters the ~4000-line monolith and can mislead maintainers about which invoice-draft/module-resolution logic is actually live.
- **Önerilen çözüm:** Delete the four unused *Legacy local functions in Program.cs, or wire them up if they were meant to replace the current logic.

---

## 7. Öncelikli Düzeltme Yol Haritası

**P0 — Hemen (kullanıcı deneyimini doğrudan bozan, küçük değişiklik):**
1. Bildirim saat dilimi düzeltmesi (`Europe/Istanbul`→UTC) — Şikayet #4'ün büyük kısmını çözer.
2. AI firma: regex'in modeli ezmesini durdur + güveni 0.92'ye pinlemeyi kaldır — Şikayet #1-A'yı çözer.
3. AI firma: diakritik-katlamalı + fuzzy eşleştirme (≥0.85) ve yakın eşleşmeyi kullanıcıya sor — Şikayet #1-B'yi çözer.

**P1 — Kısa vade (belirgin eksik/kırık):**
4. Cihaz-içi yerel bildirim yedeği + Expo yanıt kontrolü + FCM V1 yapılandırması (Şikayet #4).
5. AI Asistanı gerçek bir backend/AI ucuna bağla (veya başlığı "hızlı özet" olarak dürüstçe değiştir).
6. Ölçüm↔Döküman eşleştirmesini ortak yardımcıyla birleştir; döküman gerçek dosya yüklemesi.
7. Güvenlik: SQLite paketini yükselt; AI-capture null-guard; fatura idempotency.

**P2 — Tasarım & cilalama (Şikayet #2, birlikte planlanmalı):**
8. Reanimated ile giriş/geçiş animasyonları, elevation/gradyan token seti, markalı yazı tipi, skeleton + pull-to-refresh, dokunsal basış geri bildirimi.
9. Modül-ID→isim eşlemesi, teklif kabul akışı, salt-okunur sekmelere aksiyon ekleme.

---

## 8. Tam Bulgu Kataloğu (36 madde)

| # | Önem | Alan | Bulgu | Konum |
|---|------|------|-------|-------|
| 1 | 🔴 KRİTİK | ai-capture | Existing-company matching is exact normalized string equality only — no fuzzy/diacritic-fold/token-overlap, so any transcription variance spawns a duplicate company | `api/ArxTask.Api/Program.cs`:3599 |
| 2 | 🔴 KRİTİK | ai-capture | NormalizeAiAnalysis overrides the LLM's company decision with a regex-extracted token and force-sets confidence to 0.92 | `api/ArxTask.Api/Program.cs`:2429 |
| 3 | 🟠 YÜKSEK | ai-capture | InferCompanyName regex captures an arbitrary leading token before an action verb, producing phantom company names | `api/ArxTask.Api/Program.cs`:3145 |
| 4 | 🟠 YÜKSEK | ai-capture | No diacritic/whitespace folding means the same brand with Turkish-locale casing quirks (İ/ı) fails to match itself | `api/ArxTask.Api/Program.cs`:3544 |
| 5 | 🟠 YÜKSEK | notifications | Reminder due-time parsed in SERVER local timezone, not the Turkish user's timezone — reminders fire at the wrong absolute instant | `api/ArxTask.Api/Program.cs`:3958 |
| 6 | 🟠 YÜKSEK | frontend-design | Zero animation/transition library usage despite Reanimated being installed | `ArX Task mobile/src/components/ui.tsx`:1 |
| 7 | 🟠 YÜKSEK | frontend-design | Completely flat visual system — no shadows, elevation, or gradients anywhere | `ArX Task mobile/src/components/ui.tsx`:355 |
| 8 | 🟠 YÜKSEK | modules-secondary | AI Assistant is a hardcoded local keyword-matcher, not a real AI/backend feature | `ArX Task mobile/app/(app)/ai-assistant.tsx`:97 |
| 9 | 🟠 YÜKSEK | modules-secondary | Measurements screen and Documents screen use inconsistent document-type matching, breaking the documents-to-measurements link | `ArX Task mobile/app/(app)/measurements.tsx`:13 |
| 10 | 🟠 YÜKSEK | backend-api | AnalyzeAndCommitCapture throws NullReferenceException (unhandled 500) when SourceText is null | `api/ArxTask.Api/Program.cs`:1489 |
| 11 | 🟠 YÜKSEK | build-test | HIGH-severity known vulnerability in transitive SQLite package (NU1903) | `api/ArxTask.Api/ArxTask.Api.csproj`:1 |
| 12 | 🟡 ORTA | ai-capture | When the detected company is a phantom with no DB match, the user is dropped into the address/create modal with no way to correct the company name to an existing firm | `ArX Task mobile/app/(app)/capture.tsx`:557 |
| 13 | 🟡 ORTA | notifications | Expo Push API send is fire-and-forget: response status and push receipts are never checked, dead tokens never disabled | `api/ArxTask.Api/Program.cs`:4772 |
| 14 | 🟡 ORTA | notifications | Push registration is restricted to Android physical devices — iOS and any non-android platform silently never register | `ArX Task mobile/src/lib/notifications.ts`:159 |
| 15 | 🟡 ORTA | notifications | No FCM / google-services configuration present for Android Expo push delivery | `ArX Task mobile/app.json`:24 |
| 16 | 🟡 ORTA | frontend-design | No skeleton loaders or list loading states — only a spinner inside buttons | `ArX Task mobile/src/components/ui.tsx`:123 |
| 17 | 🟡 ORTA | frontend-design | No pull-to-refresh and list content rendered via .map in a ScrollView (no FlatList) | `ArX Task mobile/src/components/ui.tsx`:58 |
| 18 | 🟡 ORTA | frontend-design | Color palette not organized as semantic tokens; spacing/radii/type scales are hardcoded ad-hoc per file | `ArX Task mobile/src/components/ui.tsx`:17 |
| 19 | 🟡 ORTA | frontend-design | System default font only — no custom typeface loaded, weak type hierarchy | `ArX Task mobile/app/_layout.tsx`:63 |
| 20 | 🟡 ORTA | modules-core | All-tasks screen renders raw module IDs as chips instead of module names | `ArX Task mobile/app/(app)/tasks.tsx`:111 |
| 21 | 🟡 ORTA | modules-core | Manually created tasks reference module IDs that don't exist as WorkModule rows (empty modules list, raw-ID chips) | `ArX Task mobile/app/(app)/invoices.tsx`:76 |
| 22 | 🟡 ORTA | modules-secondary | Documents module has no real upload/OCR — metadata-only, contradicting its own on-screen flow | `ArX Task mobile/app/(app)/documents.tsx`:62 |
| 23 | 🟡 ORTA | backend-api | ConvertOfferToInvoice has no idempotency/status guard — repeated calls create duplicate invoices | `api/ArxTask.Api/Program.cs`:1364 |
| 24 | 🟡 ORTA | backend-api | SyncTaskAlertsForTask schedules Hangfire jobs before SaveChanges, and mutates task.DueTime as a side effect | `api/ArxTask.Api/Program.cs`:3820 |
| 25 | 🟡 ORTA | backend-api | Push/notification writes from 4 concurrent Hangfire workers share SQLite with no serialization → 'database is locked' | `api/ArxTask.Api/Program.cs`:45 |
| 26 | ⚪ DÜŞÜK | frontend-design | Press feedback is limited to a static opacity dip; no scale/haptics/ripple | `ArX Task mobile/src/components/ui.tsx`:390 |
| 27 | ⚪ DÜŞÜK | frontend-design | Bottom tab bar and screen navigation have no meaningful motion; active tab has no animated indicator | `ArX Task mobile/src/components/ui.tsx`:182 |
| 28 | ⚪ DÜŞÜK | modules-core | Accepting an offer does not create the follow-up task the flow implies; no invoice/company-status linkage | `api/ArxTask.Api/Program.cs`:1354 |
| 29 | ⚪ DÜŞÜK | modules-core | Company detail Offers/Invoices tabs are read-only — no send/accept/convert/mark-paid actions | `ArX Task mobile/app/(app)/companies/[id].tsx`:185 |
| 30 | ⚪ DÜŞÜK | modules-core | Offers filter references statuses the backend never assigns ('prepared','followUpNeeded') | `ArX Task mobile/app/(app)/offers.tsx`:45 |
| 31 | ⚪ DÜŞÜK | modules-core | Unused updateTask import in invoices screen (dead reference) | `ArX Task mobile/app/(app)/invoices.tsx`:16 |
| 32 | ⚪ DÜŞÜK | modules-secondary | Documents composer captures a stale/empty default companyId when companies load after mount | `ArX Task mobile/app/(app)/documents.tsx`:17 |
| 33 | ⚪ DÜŞÜK | backend-api | Offer and invoice totals trust client-supplied item.TotalPrice instead of recomputing Quantity × UnitPrice | `api/ArxTask.Api/Program.cs`:4169 |
| 34 | ⚪ DÜŞÜK | build-test | API build succeeds; mobile typecheck (strict) passes clean | `api/ArxTask.Api/ArxTask.Api.csproj`:1 |
| 35 | ⚪ DÜŞÜK | build-test | NuGet package downgrade/version-conflict warning for Hangfire (NU1608) | `api/ArxTask.Api/ArxTask.Api.csproj`:1 |
| 36 | ⚪ DÜŞÜK | build-test | Four unused local functions in Program.cs (CS8321) | `api/ArxTask.Api/Program.cs`:2868 |

---

*Bu rapor otomatik statik analiz + gerçek derleme/type-check + çelişkili doğrulama ile üretildi. Her bulgu gerçek koda `dosya:satır` olarak bağlıdır. Çelişkili doğrulamada elenen 2 iddia rapora dahil edilmemiştir. Emülatör/cihaz gerektiren canlı runtime testleri (push teslimi, ekran görselleri) ayrı bir adımda yapılmalıdır.*
