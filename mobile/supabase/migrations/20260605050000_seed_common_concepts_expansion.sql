-- 20260605050000_seed_common_concepts_expansion.sql
--
-- WHY
-- ----
-- The synchronous alias→concept trigger (20260530150000) resolves a new
-- tag's concept_id INSTANTLY on insert IF the tag name is already a curated
-- alias. So every alias we seed turns a would-be 5-minute-linker-wait (and
-- an embedding API call + a gray-zone LLM judge for cross-language) into a
-- deterministic, zero-latency, zero-cost day-1 cross-language match. Seeding
-- the highest-frequency concepts is therefore the single cheapest lever on
-- cold-start matching density — the North Star's "媒合新朋友 across
-- language/wording" works from the first tag, not the first cron cycle.
--
-- WHAT
-- ----
-- Extends tag_concepts + tag_aliases with the common networking/social
-- concepts NOT yet seeded (see 20260524060000 iconic set + the base
-- multilingual seeds). Same idempotent block pattern as the iconic
-- migration:
--   1. SELECT concept_id from tag_aliases via known anchors.
--   2. If none, INSERT a tag_concepts row.
--   3. INSERT aliases ON CONFLICT (alias) DO NOTHING.
--
-- COVERAGE — 18 NEW concepts + 2 EXTENSIONS of existing concepts:
--   NEW Pets (2): Cat, Dog    ← #養貓 is the CLAUDE.md canonical example,
--                               and had NO seed until now.
--   NEW Interests (12): Gaming, Movies, Anime, Wine, Tea, Baseball,
--                   Basketball, Golf, Camping, Fishing, Crypto, Fashion
--   NEW Careers (4): Nurse, Accountant, Architect, Sales, Consultant
--                    (and Student → identity)
--   EXTEND existing (2): Engineer→Software Engineer, Investing→Investment
--
-- PRECISION OVER RECALL (founder rule, 2026-06-05): a WRONG alias mis-routes
-- a real tag to the wrong concept — strictly worse than a MISSING alias,
-- which the 5-minute embedding linker still resolves. So each block carries
-- the CJK + English + major-European forms (high confidence) plus the
-- harder-script forms ONLY where the term is a common, certain word. Where
-- a translation would be a guess (esp. ar/hi/bn/th/ur for niche terms), it
-- is deliberately OMITTED — the linker is the safety net for those.
--
-- COLLISION NOTES (both are intentional EXTENSIONS via the anchor lookup,
-- not new concepts — verified against the base seeds):
--   * "Engineer": the base seed (20260328010000 line 74) already maps bare
--     "工程師" → the Software Engineer concept (TW parlance treats bare
--     工程師 as SWE). So this block's anchor RESOLVES to Software Engineer
--     and EXTENDS it with the generic cross-language engineer terms it was
--     missing (bare エンジニア / 엔지니어 / Ingeniero / Ingénieur / Инженер /
--     مهندس / Kỹ sư ...). Net effect: a JP user who tags エンジニア now
--     matches a TW 工程師 — more cross-language reach on the same concept.
--     The mild over-collapse (a civil engineer bucketed with software) is
--     consistent with the base seed's existing 工程師→SWE choice and is the
--     right cold-start trade (more matches, not fewer).
--   * "Investing/股票/理財" anchors onto the existing Investment concept
--     (base seed) and EXTENDS it rather than minting a fragment.

-- ═══════════════════════════════════════════════════════════════
-- PETS
-- ═══════════════════════════════════════════════════════════════

-- ── Cat (the #養貓 canonical concept) ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Cat', '貓', '猫', '養貓', 'ネコ', '고양이') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Cat', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('貓'), ('猫'), ('養貓'), ('养猫'), ('貓奴'), ('猫奴'), ('喵星人'), ('貓咪'), ('猫咪'),
    ('Cat'), ('Cats'), ('Cat lover'), ('Kitten'), ('Kitty'),
    ('ネコ'), ('猫好き'), ('愛猫'),
    ('고양이'), ('냥이'), ('집사'),
    ('Gato'), ('Gata'), ('Gatos'),
    ('Chat'), ('Chats'),
    ('Gatto'), ('Gatti'),
    ('Katze'), ('Katzen'),
    ('Кот'), ('Кошка'), ('Коты'),
    ('قطة'), ('قطط'),
    ('बिल्ली'),
    ('বিড়াল'),
    ('แมว'),
    ('Kedi'),
    ('بلی'),
    ('Mèo'),
    ('Kucing')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Dog ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Dog', '狗', '養狗', 'イヌ', '강아지') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Dog', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('狗'), ('養狗'), ('养狗'), ('狗狗'), ('汪星人'), ('狗奴'),
    ('Dog'), ('Dogs'), ('Dog lover'), ('Puppy'), ('Doggo'),
    ('犬'), ('イヌ'), ('犬好き'), ('愛犬'), ('わんこ'),
    ('개'), ('강아지'), ('멍멍이'),
    ('Perro'), ('Perra'), ('Perros'),
    ('Cachorro'), ('Cão'),
    ('Chien'), ('Chiens'),
    ('Cane'), ('Cani'),
    ('Hund'), ('Hunde'),
    ('Собака'), ('Пёс'), ('Собаки'),
    ('كلب'), ('كلاب'),
    ('कुत्ता'),
    ('কুকুর'),
    ('สุนัข'), ('หมา'),
    ('Köpek'),
    ('کتا'),
    ('Chó'),
    ('Anjing')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- INTERESTS / HOBBIES
-- ═══════════════════════════════════════════════════════════════

-- ── Gaming / Video games ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Gaming', '電玩', '电玩', 'ゲーム', '게임') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Gaming', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('電玩'), ('电玩'), ('遊戲'), ('游戏'), ('電競'), ('电竞'), ('打電動'), ('電動'),
    ('Gaming'), ('Video games'), ('Videogames'), ('Gamer'), ('Esports'), ('Games'),
    ('ゲーム'), ('ゲーマー'), ('eスポーツ'),
    ('게임'), ('게이머'), ('이스포츠'),
    ('Videojuegos'), ('Juegos'),
    ('Jogos'), ('Videojogos'),
    ('Jeux vidéo'),
    ('Videogiochi'),
    ('Videospiele'), ('Gaming'),
    ('Игры'), ('Видеоигры'),
    ('ألعاب'), ('ألعاب فيديو'),
    ('गेमिंग'),
    ('গেমিং'),
    ('เกม'),
    ('Oyun'),
    ('Trò chơi'), ('Game')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Movies / Film ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Movies', '電影', '电影', '映画', '영화') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Movies', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('電影'), ('电影'), ('看電影'), ('看电影'),
    ('Movies'), ('Movie'), ('Film'), ('Films'), ('Cinema'),
    ('映画'),
    ('영화'),
    ('Película'), ('Películas'), ('Cine'),
    ('Filme'), ('Filmes'),
    ('Cinéma'),
    ('Cinema'),  -- it/pt share
    ('Kino'), ('Filme'),
    ('Кино'), ('Фильмы'),
    ('أفلام'), ('سينما'),
    ('फ़िल्में'),
    ('সিনেমা'),
    ('ภาพยนตร์'), ('หนัง'),
    ('Sinema'), ('Film'),
    ('Phim')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Anime / Manga ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Anime', '動漫', '动漫', 'アニメ', '애니메이션') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Anime', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('動漫'), ('动漫'), ('動畫'), ('动画'), ('漫畫'), ('漫画'), ('ACG'),
    ('Anime'), ('Manga'),
    ('アニメ'),
    ('애니메이션'), ('애니'), ('만화'),
    ('Аниме'), ('Манга'),
    ('أنيمي'),
    ('एनीमे'),
    ('อนิเมะ'), ('การ์ตูน'),
    ('انیمے')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Wine ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Wine', '葡萄酒', '紅酒', 'ワイン', '와인') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Wine', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('葡萄酒'), ('紅酒'), ('红酒'), ('品酒'), ('葡萄酒愛好者'),
    ('Wine'), ('Red wine'), ('Wine lover'), ('Sommelier'),
    ('ワイン'),
    ('와인'),
    ('Vino'),
    ('Vinho'),
    ('Vin'),
    ('Wein'),
    ('Вино'),
    ('نبيذ'),
    ('वाइन'),
    ('ওয়াইন'),
    ('ไวน์'),
    ('Şarap'),
    ('Rượu vang')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Tea ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Tea', '茶', '喝茶', 'お茶', '차') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Tea', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('茶'), ('喝茶'), ('泡茶'), ('茶道'), ('品茶'),
    ('Tea'),
    ('お茶'), ('日本茶'),
    ('차'),
    ('Té'),
    ('Chá'),
    ('Thé'),
    ('Tè'),
    ('Tee'),
    ('Чай'),
    ('شاي'),
    ('चाय'),
    ('চা'),
    ('ชา'),
    ('Çay'),
    ('چائے'),
    ('Trà'),
    ('Teh')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Baseball ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Baseball', '棒球', '野球', '야구') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Baseball', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('棒球'), ('野球'),
    ('Baseball'),
    ('야구'),
    ('Béisbol'),
    ('Beisebol'),
    ('Бейсбол'),
    ('بيسبول'),
    ('เบสบอล'),
    ('Beyzbol'),
    ('Bóng chày')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Basketball ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Basketball', '籃球', '篮球', 'バスケ', '농구') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Basketball', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('籃球'), ('篮球'), ('打籃球'),
    ('Basketball'),
    ('バスケ'), ('バスケットボール'),
    ('농구'),
    ('Baloncesto'), ('Básquetbol'),
    ('Basquete'),
    ('Basket-ball'),
    ('Basket'),  -- it
    ('Баскетбол'),
    ('كرة السلة'),
    ('बास्केटबॉल'),
    ('บาสเกตบอล'), ('บาส'),
    ('Basketbol'),
    ('Bóng rổ')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Golf (loanword-regular, low risk) ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Golf', '高爾夫', '高尔夫', 'ゴルフ', '골프') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Golf', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('高爾夫'), ('高尔夫'), ('打高爾夫'), ('高球'),
    ('Golf'),
    ('ゴルフ'),
    ('골프'),
    ('Гольф'),
    ('جولف'), ('غولف'),
    ('गोल्फ'),
    ('กอล์ฟ'),
    ('Gôn')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Camping ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Camping', '露營', '露营', 'キャンプ', '캠핑') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Camping', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('露營'), ('露营'), ('野營'), ('野营'),
    ('Camping'), ('Camp'),
    ('キャンプ'),
    ('캠핑'),
    ('Acampar'), ('Acampada'),
    ('Acampamento'),
    ('Кемпинг'),
    ('تخييم'),
    ('แคมป์ปิ้ง'), ('ตั้งแคมป์'),
    ('Kamp'),
    ('Cắm trại'),
    ('Berkemah')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Fishing ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Fishing', '釣魚', '钓鱼', '釣り', '낚시') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Fishing', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('釣魚'), ('钓鱼'), ('海釣'),
    ('Fishing'), ('Angling'),
    ('釣り'),
    ('낚시'),
    ('Pesca'),  -- es/pt/it share
    ('Pêche'),
    ('Angeln'),
    ('Рыбалка'),
    ('صيد السمك'),
    ('ตกปลา'),
    ('Balık tutma'),
    ('Câu cá'),
    ('Memancing')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Crypto / Blockchain (loanword-regular) ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Crypto', '加密貨幣', '加密货币', '암호화폐') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Cryptocurrency', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('加密貨幣'), ('加密货币'), ('虛擬貨幣'), ('虚拟货币'),
    ('區塊鏈'), ('区块链'), ('比特幣'), ('比特币'),
    ('Crypto'), ('Cryptocurrency'), ('Bitcoin'), ('Blockchain'), ('Web3'), ('NFT'),
    ('暗号資産'), ('仮想通貨'),
    ('암호화폐'), ('가상화폐'), ('블록체인'),
    ('Criptomoneda'),
    ('Criptomoeda'),
    ('Cryptomonnaie'),
    ('Kryptowährung'),
    ('Криптовалюта'),
    ('عملة مشفرة'),
    ('क्रिप्टोकरेंसी'),
    ('คริปโต'),
    ('Kripto'),
    ('Tiền mã hóa'), ('Tiền điện tử')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Fashion ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Fashion', '時尚', '时尚', 'ファッション', '패션') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Fashion', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('時尚'), ('时尚'), ('穿搭'), ('時裝'), ('時尚穿搭'),
    ('Fashion'), ('Style'), ('Streetwear'), ('OOTD'),
    ('ファッション'),
    ('패션'),
    ('Moda'),  -- es/pt/it/tr share
    ('Mode'),  -- fr/de/id share
    ('Мода'),
    ('موضة'),
    ('फैशन'),
    ('ফ্যাশন'),
    ('แฟชั่น'),
    ('فیشن'),
    ('Thời trang'),
    ('Fesyen')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- CAREERS
-- ═══════════════════════════════════════════════════════════════

-- ── Nurse ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Nurse', '護理師', '护士', '看護師', '간호사') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Nurse', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('護理師'), ('护士'), ('護士'), ('看護'),
    ('Nurse'), ('Nursing'),
    ('看護師'), ('ナース'),
    ('간호사'),
    ('Enfermero'), ('Enfermera'),
    ('Enfermeiro'), ('Enfermeira'),
    ('Infirmier'), ('Infirmière'),
    ('Infermiere'), ('Infermiera'),
    ('Krankenschwester'), ('Krankenpfleger'),
    ('Медсестра'), ('Медбрат'),
    ('ممرض'), ('ممرضة'),
    ('नर्स'),
    ('নার্স'),
    ('พยาบาล'),
    ('Hemşire'),
    ('نرس'),
    ('Y tá'),
    ('Perawat')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Accountant ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Accountant', '會計師', '会计师', '会計士', '회계사') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Accountant', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('會計師'), ('会计师'), ('會計'), ('会计'),
    ('Accountant'), ('CPA'), ('Accounting'),
    ('会計士'), ('公認会計士'),
    ('회계사'),
    ('Contador'), ('Contadora'), ('Contable'),
    ('Contabilista'),
    ('Comptable'),
    ('Commercialista'),
    ('Buchhalter'), ('Buchhalterin'),
    ('Бухгалтер'),
    ('محاسب'),
    ('लेखाकार'),
    ('হিসাবরক্ষক'),
    ('นักบัญชี'),
    ('Muhasebeci'),
    ('اکاؤنٹنٹ'),
    ('Kế toán'),
    ('Akuntan')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Architect ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Architect', '建築師', '建筑师', '建築家', '건축가') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Architect', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('建築師'), ('建筑师'), ('建築設計師'),
    ('Architect'), ('Architecture'),
    ('建築家'),
    ('건축가'),
    ('Arquitecto'), ('Arquitecta'),
    ('Arquiteto'), ('Arquiteta'),
    ('Architecte'),
    ('Architetto'),
    ('Architekt'), ('Architektin'),
    ('Архитектор'),
    ('مهندس معماري'),
    ('वास्तुकार'),
    ('স্থপতি'),
    ('สถาปนิก'),
    ('Mimar'),
    ('Kiến trúc sư'),
    ('Arsitek')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Sales ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Sales', '業務', '业务', '営業', '영업') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Sales', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('業務'), ('业务'), ('銷售'), ('销售'), ('業務員'), ('業務代表'),
    ('Sales'), ('Salesperson'), ('Sales Rep'), ('Account Executive'),
    ('営業'),
    ('영업'),
    ('Ventas'), ('Vendedor'), ('Vendedora'),
    ('Vendas'),
    ('Commercial'), ('Vente'),
    ('Vendite'),
    ('Vertrieb'),
    ('Продажи'),
    ('مبيعات'),
    ('बिक्री'),
    ('বিক্রয়'),
    ('ฝ่ายขาย'), ('พนักงานขาย'),
    ('Satış'),
    ('سیلز'),
    ('Kinh doanh'),
    ('Penjualan')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Consultant ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Consultant', '顧問', '顾问', 'コンサルタント', '컨설턴트') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Consultant', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('顧問'), ('顾问'), ('諮詢顧問'),
    ('Consultant'), ('Consulting'), ('Advisor'),
    ('コンサルタント'), ('コンサル'),
    ('컨설턴트'),
    ('Consultor'), ('Consultora'),
    ('Consultant'),  -- fr same as en
    ('Consulente'),
    ('Berater'), ('Beraterin'),
    ('Консультант'),
    ('مستشار'),
    ('सलाहकार'),
    ('পরামর্শদাতা'),
    ('ที่ปรึกษา'),
    ('Danışman'),
    ('مشیر'),
    ('Tư vấn'),
    ('Konsultan')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Student ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Student', '學生', '学生', '학생') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Student', 'identity') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('學生'), ('学生'), ('大學生'), ('大学生'), ('研究生'),
    ('Student'), ('College student'), ('University student'),
    ('生徒'), ('学生'),
    ('학생'), ('대학생'),
    ('Estudiante'),
    ('Estudante'),
    ('Étudiant'), ('Étudiante'),
    ('Studente'), ('Studentessa'),
    ('Student'),  -- de same
    ('Студент'), ('Студентка'),
    ('طالب'), ('طالبة'),
    ('छात्र'), ('विद्यार्थी'),
    ('ছাত্র'), ('শিক্ষার্থী'),
    ('นักเรียน'), ('นักศึกษา'),
    ('Öğrenci'),
    ('طالب علم'),
    ('Sinh viên'), ('Học sinh'),
    ('Pelajar'), ('Mahasiswa')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Engineer (generic) — EXTENDS Software Engineer (base seed maps bare
--    工程師 there; we add the cross-language generic-engineer terms it
--    lacked, so エンジニア/엔지니어/Ingeniero/Ingénieur/Инженер all match). ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Engineer', '工程師', '工程师', 'エンジニア', '엔지니어', 'Software Engineer', '軟體工程師') LIMIT 1;
  IF v_id IS NULL THEN
    -- Defensive only — 工程師 is seeded, so this branch never fires.
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Software Engineer', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('工程師'), ('工程师'),
    ('Engineer'), ('Engineering'),
    ('エンジニア'), ('技術者'),
    ('엔지니어'), ('기술자'),
    ('Ingeniero'), ('Ingeniera'),
    ('Engenheiro'), ('Engenheira'),
    ('Ingénieur'), ('Ingénieure'),
    ('Ingegnere'),
    ('Ingenieur'), ('Ingenieurin'),
    ('Инженер'),
    ('مهندس'),
    ('इंजीनियर'),
    ('প্রকৌশলী'), ('ইঞ্জিনিয়ার'),
    ('วิศวกร'),
    ('Mühendis'),
    ('انجینئر'),
    ('Kỹ sư'),
    ('Insinyur')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- INVESTING — extend the existing Investment concept (do NOT mint
-- a fragment). Anchors target the base-seed Investment concept.
-- ═══════════════════════════════════════════════════════════════
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Investment', 'Investing', '投資', '投资', '理財') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Investment', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('投資'), ('投资'), ('理財'), ('理财'), ('股票'), ('股市'), ('投資理財'),
    ('Investing'), ('Investment'), ('Investor'), ('Stocks'), ('Trading'),
    ('投資'), ('株'), ('資産運用'),
    ('투자'), ('주식'), ('재테크'),
    ('Inversión'), ('Inversor'),
    ('Investimento'),
    ('Investissement'),
    ('Investimenti'),
    ('Investitionen'), ('Geldanlage'),
    ('Инвестиции'),
    ('استثمار'),
    ('निवेश'),
    ('বিনিয়োগ'),
    ('การลงทุน'),
    ('Yatırım'),
    ('سرمایہ کاری'),
    ('Đầu tư'),
    ('Investasi')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- (End of common-concept expansion)
-- ═══════════════════════════════════════════════════════════════
