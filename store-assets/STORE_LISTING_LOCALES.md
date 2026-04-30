# PikTag — Per-Locale Store Listing Copy

Last revised: 2026-04-30

This file contains the **highest-leverage** store-listing strings for the
13 non-English / non-zh-TW locales. Each locale gets:

1. **Subtitle** — Apple App Store, ≤30 chars, appears in search + install
2. **Short description** — Google Play, ≤80 chars, appears in search results
3. **Keywords** — Apple only, ≤100 chars, hidden, drives ASO discovery

The **full long-form description** (≤4000 chars) is intentionally NOT
translated for v1.0 — it falls through to en for these locales in App
Store Connect / Play Console. We'll add per-locale long-form copy in
Phase 2 of the rollout, prioritized by post-launch install / conversion
data.

zh-TW (primary) and en (fallback) live in `STORE_LISTING_FILLOUT.md`.

Brand voice anchors (from launch decisions):
- Hero slogan (brand-locked English everywhere): **Pick. Tag. Connect.**
- Primary positioning: locale's natural expression of "Pick your people."
- Functional clarity: locale's natural expression of "Search by need,
  not by name."

> Translator note: avoid word-for-word translation. Each locale should
> read as if a native copywriter wrote it. The English template is
> illustrative, not prescriptive.

---

## zh-CN (Simplified Chinese, China + global Chinese diaspora)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | 找对的人，从标签开始 | 10 / 30 |
| Short (Play) | 不靠名字找人，靠标签找人。把人脉标签化，老朋友主动找上你。 | 28 / 80 |
| Keywords (Apple) | 社交,人脉,标签,二维码,认识,活动,创业,设计,联系人,提醒 | 27 / 100 |

---

## ja (Japanese)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | 必要な人と、自然に出会う | 12 / 30 |
| Short (Play) | 名前ではなく、必要で人を探す。タグで人脈を整理し、必要なときに必要な人と再会する。 | 41 / 80 |
| Keywords (Apple) | 人脈,タグ,QRコード,出会い,SNS,名刺,連絡先,イベント,スタートアップ,デザイナー | 40 / 100 |

---

## ko (Korean)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | 당신의 사람들을 찾으세요 | 12 / 30 |
| Short (Play) | 이름이 아닌 필요로 만나세요. 태그로 인맥을 정리하고, 옛 친구가 알아서 찾아오게. | 36 / 80 |
| Keywords (Apple) | 인맥,태그,QR,만남,SNS,명함,연락처,이벤트,스타트업,디자이너 | 33 / 100 |

---

## es (Spanish, Spain + Latin America)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | Encuentra a tu gente | 20 / 30 |
| Short (Play) | Busca por necesidad, no por nombre. Etiqueta tu red y encuentra a tu gente. | 75 / 80 |
| Keywords (Apple) | networking,CRM,etiquetas,QR,conectar,contactos,eventos,emprendedor,diseñador | 79 / 100 |

---

## fr (French, France + Canada + Africa)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | Trouve tes gens | 15 / 30 |
| Short (Play) | Cherche par besoin, pas par nom. Étiquette ton réseau, retrouve tes gens. | 73 / 80 |
| Keywords (Apple) | réseau,CRM,tags,QR,contacts,événement,startup,designer,communauté | 65 / 100 |

---

## pt (Portuguese, Brazil + Portugal)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | Encontre suas pessoas | 21 / 30 |
| Short (Play) | Busque por necessidade, não por nome. Etiquete sua rede, encontre suas pessoas. | 79 / 80 |
| Keywords (Apple) | networking,CRM,tags,QR,contatos,eventos,startup,designer,comunidade | 67 / 100 |

---

## ru (Russian, Russia + CIS)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | Найди своих | 11 / 30 |
| Short (Play) | Ищи по нужде, а не по имени. Тегируй свою сеть — старые друзья сами тебя найдут. | 80 / 80 |
| Keywords (Apple) | нетворкинг,CRM,теги,QR,контакты,события,стартап,дизайнер | 56 / 100 |

---

## ar (Arabic, MENA region — RTL script)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | اعثر على شعبك | 14 / 30 |
| Short (Play) | ابحث بالحاجة، لا بالاسم. صنّف شبكتك بالوسوم، يجدك أصدقاؤك القدامى وقت الحاجة. | 73 / 80 |
| Keywords (Apple) | تواصل,وسوم,رمز QR,معارف,أحداث,شركات ناشئة,مصممون | 47 / 100 |

> Apple App Store supports ar fully. Make sure listing screenshots show
> the RTL UI orientation correctly when testing.

---

## bn (Bengali, Bangladesh + India)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | তোমার মানুষ খুঁজে পাও | 17 / 30 |
| Short (Play) | নাম নয়, প্রয়োজন দিয়ে খুঁজুন। আপনার নেটওয়ার্ক ট্যাগ করুন, পুরোনো বন্ধু ফিরে আসবে। | 70 / 80 |
| Keywords (Apple) | নেটওয়ার্কিং,ট্যাগ,QR,যোগাযোগ,ইভেন্ট,স্টার্টআপ,ডিজাইনার | 52 / 100 |

---

## hi (Hindi, India)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | अपने लोग खोजो | 14 / 30 |
| Short (Play) | नाम से नहीं, ज़रूरत से खोजें। अपने नेटवर्क को टैग करें, पुराने दोस्त खुद आ जाएंगे। | 76 / 80 |
| Keywords (Apple) | नेटवर्किंग,टैग,QR,संपर्क,इवेंट,स्टार्टअप,डिज़ाइनर | 47 / 100 |

---

## id (Indonesian)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | Temukan orang-orangmu | 21 / 30 |
| Short (Play) | Cari berdasarkan kebutuhan, bukan nama. Tag jaringanmu, teman lama akan datang. | 78 / 80 |
| Keywords (Apple) | networking,CRM,tag,QR,kontak,acara,startup,desainer,komunitas | 60 / 100 |

---

## th (Thai)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | หาคนที่ใช่ของคุณ | 17 / 30 |
| Short (Play) | ค้นหาด้วยความต้องการ ไม่ใช่ชื่อ แท็กเครือข่ายของคุณ เพื่อนเก่าจะกลับมาหาคุณ | 65 / 80 |
| Keywords (Apple) | คอนเน็กชั่น,แท็ก,QR,ผู้ติดต่อ,อีเวนต์,สตาร์ทอัพ,นักออกแบบ | 53 / 100 |

---

## tr (Turkish)

| Field | Copy | Chars |
|-------|------|-------|
| Subtitle (Apple) | İnsanlarını bul | 15 / 30 |
| Short (Play) | İsimle değil, ihtiyaçla ara. Ağını etiketle, eski dostların seni bulsun. | 72 / 80 |
| Keywords (Apple) | networking,CRM,etiket,QR,kişiler,etkinlik,girişim,tasarımcı,topluluk | 67 / 100 |

---

## Locale rollout priority (recommendation)

For Apple App Store Connect + Google Play Console, fill in these locales
in this order. Each takes ~3-5 minutes if you copy-paste the strings above.

**Day 1 (launch, P0):**
- zh-TW (already in `STORE_LISTING_FILLOUT.md`)
- en (already in `STORE_LISTING_FILLOUT.md`)
- ja — Japan is a high-conversion premium market for tag-based apps
- ko — same logic, Korea is strong on networking-style apps

**Day 2-7 (P1):**
- zh-CN, es, pt, fr — large total addressable population
- de — NOT covered above (we don't ship German UI), skip
- ru, ar — important for global reach but lower priority

**Week 2 (P2):**
- bn, hi, id, th, tr — fill in once analytics show install signal from
  these markets

> Note: Google Play allows up to 77 localized listings, App Store
> Connect allows ~40. Both let you add more locales after launch
> without affecting the existing app build, so this is purely a
> store-listing exercise. The app binary itself is untouched.

---

## Translator quality notes

These translations were drafted to honor the brand voice rather than
match English word-for-word. A native speaker reviewer for each locale
should sanity-check before paste-and-publish. Specific notes:

- **ja**: 「自然に出会う」 conveys serendipity, which is the Ask /
  reverse-search pivot. If a Japanese reviewer prefers more direct
  「探せる」, that's a defensible alternative.
- **ko**: 「당신의 사람들」 is warm and aspirational, matches "your
  people" in en. Some reviewers may suggest 「내 사람들」 (my people)
  for a more personal voice — both are valid.
- **ar**: RTL ordering must be preserved when copying into App Store
  Connect; the field accepts UTF-8 RTL natively.
- **th**: Keep the spacing pattern — Thai doesn't use spaces between
  words natively but Apple/Play render line breaks better when phrases
  are visually separated.
- **bn / hi**: The Bengali and Hindi short descriptions are at the
  upper bound of the 80-char limit because Devanagari/Bengali script
  characters take more visual space; keep them as drafted unless a
  native speaker has a tighter alternative.

---

## What's intentionally missing

- **Long-form descriptions (≤4000 chars)** for these 13 locales —
  ~600-1500 chars each, ~10× the work of the hooks above. Skipped for
  v1.0 launch; will be added Phase 2 once analytics tell us which
  markets convert.
- **Promotional text (Apple, ≤170 chars)** for these 13 locales — same
  reason; the en promotional text is good enough to fall through to
  while we measure.
- **App preview videos** — none for v1.0. Static screenshots only.
