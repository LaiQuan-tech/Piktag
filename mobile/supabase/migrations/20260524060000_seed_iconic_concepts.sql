-- 20260524060000_seed_iconic_concepts.sql
--
-- Seed the rest of PikTag's "iconic" concept set so the alias map
-- carries the most-likely searched terms in all 19 launch locales
-- before any real user types them. Each block follows the same
-- pattern as the Mazu/Mary migration (20260524050000):
--
--   1. SELECT concept_id from tag_aliases using a known anchor.
--   2. If none exists, INSERT a new tag_concepts row.
--   3. INSERT all aliases ON CONFLICT (alias) DO NOTHING.
--
-- Idempotent. Anchors are deliberately the most common form in each
-- language family so the lookup hits.
--
-- COVERAGE (22 concepts):
--   Religious / mythological (4): Jesus, Buddha, Guanyin, Confucius
--   Careers (8): Designer, Software Engineer, Doctor, Lawyer, Teacher,
--                CEO, Founder, Product Manager
--   Interests (9): Coffee, Yoga, Fitness, Running, Hiking, Music,
--                  Reading, Cooking, Travel
--   Tech / Business (2): AI, Startup
--
-- Already covered by earlier migrations (NOT repeated here):
--   Mazu, Virgin Mary, Japanese language, Rotary Club, Photography.
--
-- DESIGN NOTE — "PM": the existing concept already groups PM with
-- 專案管理 (Project Management). We do NOT add "PM" as alias of
-- the new Product Manager concept — it'd violate the unique
-- constraint and PM is ambiguous (means both in TW tech parlance).
-- Users who type "PM" land on Project; "產品經理 / Product Manager"
-- lands on Product. Acceptable trade-off.

-- ═══════════════════════════════════════════════════════════════
-- RELIGIOUS / MYTHOLOGICAL FIGURES
-- ═══════════════════════════════════════════════════════════════

-- ── Jesus Christ ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Jesus', 'Jesus Christ', '耶穌', '耶稣') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Jesus Christ', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('耶穌'), ('耶稣'), ('耶穌基督'), ('耶稣基督'), ('基督'), ('救世主'),
    ('Jesus'), ('Jesus Christ'), ('Christ'), ('Lord Jesus'), ('Son of God'),
    ('イエス'), ('イエス・キリスト'), ('キリスト'),
    ('예수'), ('예수 그리스도'), ('그리스도'),
    ('Jesús'), ('Jesucristo'), ('Cristo'),
    ('Jesus Cristo'),
    ('Jésus'), ('Jésus-Christ'),
    ('Gesù'), ('Gesù Cristo'),
    ('Jesus Christus'), ('Christus'),
    ('Иисус'), ('Иисус Христос'), ('Христос'),
    ('يسوع'), ('عيسى'), ('المسيح'),
    ('यीशु'), ('ईसा मसीह'),
    ('যীশু'), ('ঈসা মসিহ'),
    ('พระเยซู'), ('พระเยซูคริสต์'),
    ('İsa'), ('İsa Mesih'),
    ('عیسیٰ'),
    ('Giê-su'), ('Chúa Giê-su'),
    ('Yesus'), ('Yesus Kristus'), ('Kristus')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Buddha (Sakyamuni) ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Buddha', '佛陀', 'ブッダ', '釋迦牟尼') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Buddha', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('佛陀'), ('釋迦牟尼'), ('释迦牟尼'), ('釋迦摩尼'), ('释迦摩尼'),
    ('如來'), ('如来'), ('釋尊'), ('释尊'),
    ('Buddha'), ('Gautama Buddha'), ('Sakyamuni'), ('Shakyamuni'),
    ('Siddhartha Gautama'), ('The Buddha'),
    ('仏陀'), ('ブッダ'), ('釈迦'), ('釈尊'), ('お釈迦様'),
    ('부처'), ('부처님'), ('석가'), ('석가모니'),
    ('Buda'), ('Gautama Buda'),
    ('Bouddha'), ('Gautama Bouddha'),
    ('Будда'), ('Гаутама Будда'),
    ('بوذا'),
    ('बुद्ध'), ('गौतम बुद्ध'), ('सिद्धार्थ गौतम'),
    ('বুদ্ধ'), ('গৌতম বুদ্ধ'),
    ('พระพุทธเจ้า'), ('พระโคตมพุทธเจ้า'),
    ('بدھ'), ('گوتم بدھ'),
    ('Đức Phật'), ('Phật'), ('Thích Ca Mâu Ni'),
    ('Sang Buddha'), ('Siddhartha')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Guanyin (Bodhisattva of Compassion) ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Guanyin', '觀音', '观音', 'Kuan Yin') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Guanyin', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('觀音'), ('观音'),
    ('觀音菩薩'), ('观音菩萨'),
    ('觀世音'), ('观世音'),
    ('觀世音菩薩'), ('观世音菩萨'),
    ('Guanyin'), ('Kuan Yin'), ('Kwan Yin'),
    ('Goddess of Mercy'), ('Goddess of Compassion'),
    ('Avalokiteshvara'), ('Bodhisattva of Compassion'),
    ('観音'), ('観世音'), ('観音菩薩'), ('カンノン'),
    ('관음'), ('관세음'), ('관음보살'),
    ('Quan Âm'), ('Bồ Tát Quan Âm'), ('Quán Thế Âm'),
    ('เจ้าแม่กวนอิม'), ('กวนอิม'),
    ('Kwan Im'), ('Dewi Kwan Im')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Confucius ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Confucius', '孔子') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Confucius', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('孔子'), ('孔丘'), ('孔仲尼'), ('至聖先師'), ('至圣先师'),
    ('Confucius'), ('Kongzi'), ('Kong Zi'), ('Master Kong'),
    ('こうし'),
    ('공자'),
    ('Confucio'), ('Confúcio'),
    ('Konfuzius'),
    ('Конфуций'),
    ('كونفوشيوس'),
    ('कन्फ्यूशियस'),
    ('কনফুসিয়াস'),
    ('ขงจื๊อ'),
    ('Konfüçyüs'),
    ('کنفیوشس'),
    ('Khổng Tử'),
    ('Kong Hu Cu'), ('Konfusius')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- CAREERS
-- ═══════════════════════════════════════════════════════════════

-- ── Designer ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Designer', '設計師', 'デザイナー', '디자이너') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Designer', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('設計師'), ('设计师'), ('設計'),
    ('Designer'),
    ('デザイナー'), ('設計家'),
    ('디자이너'),
    ('Diseñador'), ('Diseñadora'),
    ('Desenhista'), ('Designer Gráfico'),
    ('Designeur'),
    ('Disegnatore'),
    ('Дизайнер'),
    ('مصمم'), ('مصممة'),
    ('डिज़ाइनर'), ('डिजाइनर'),
    ('ডিজাইনার'),
    ('นักออกแบบ'), ('ดีไซเนอร์'),
    ('Tasarımcı'),
    ('ڈیزائنر'),
    ('Nhà thiết kế'),
    ('Desainer')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Software Engineer ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Software Engineer', '軟體工程師', '软件工程师') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Software Engineer', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('軟體工程師'), ('软件工程师'),
    ('程式設計師'), ('程序员'), ('程序設計師'),
    ('開發者'), ('开发者'), ('開發工程師'),
    ('Software Engineer'), ('SWE'), ('Developer'), ('Programmer'),
    ('Software Developer'), ('Software Dev'),
    ('ソフトウェアエンジニア'), ('プログラマー'), ('開発者'),
    ('소프트웨어 엔지니어'), ('프로그래머'), ('개발자'),
    ('Ingeniero de Software'), ('Desarrollador'), ('Programador'),
    ('Engenheiro de Software'),
    ('Ingénieur logiciel'), ('Développeur'),
    ('Ingegnere del Software'), ('Sviluppatore'),
    ('Softwareentwickler'), ('Programmierer'),
    ('Программист'), ('Разработчик'),
    ('مهندس برمجيات'), ('مبرمج'),
    ('सॉफ़्टवेयर इंजीनियर'), ('प्रोग्रामर'),
    ('সফটওয়্যার ইঞ্জিনিয়ার'), ('প্রোগ্রামার'),
    ('วิศวกรซอฟต์แวร์'), ('โปรแกรมเมอร์'),
    ('Yazılım Mühendisi'), ('Programcı'),
    ('سافٹ ویئر انجینئر'),
    ('Kỹ sư phần mềm'), ('Lập trình viên'),
    ('Insinyur Perangkat Lunak'), ('Pengembang')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Doctor / Physician ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Doctor', '醫生', '医生', '醫師') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Doctor', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('醫生'), ('医生'), ('醫師'), ('医师'), ('大夫'),
    ('Doctor'), ('Physician'),
    ('医者'), ('ドクター'),
    ('의사'),
    ('Médico'), ('Doctora'), ('Médica'),
    ('Doutor'),
    ('Médecin'), ('Docteur'),
    ('Medico'), ('Dottore'),
    ('Arzt'), ('Ärztin'), ('Mediziner'),
    ('Врач'),
    ('طبيب'), ('طبيبة'),
    ('डॉक्टर'), ('चिकित्सक'),
    ('ডাক্তার'), ('চিকিৎসক'),
    ('หมอ'), ('แพทย์'),
    ('Doktor'), ('Hekim'),
    ('ڈاکٹر'), ('طبیب'),
    ('Bác sĩ'),
    ('Dokter')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Lawyer ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Lawyer', '律師', '律师') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Lawyer', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('律師'), ('律师'),
    ('Lawyer'), ('Attorney'), ('Counsel'),
    ('弁護士'),
    ('변호사'),
    ('Abogado'), ('Abogada'),
    ('Advogado'), ('Advogada'),
    ('Avocat'), ('Avocate'),
    ('Avvocato'), ('Avvocata'),
    ('Anwalt'), ('Rechtsanwalt'), ('Anwältin'),
    ('Юрист'), ('Адвокат'),
    ('محامي'), ('محامية'),
    ('वकील'), ('अधिवक्ता'),
    ('আইনজীবী'), ('উকিল'),
    ('ทนายความ'),
    ('Avukat'),
    ('وکیل'),
    ('Luật sư'),
    ('Pengacara'), ('Advokat')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Teacher ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Teacher', '老師', '老师', '教師') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Teacher', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('老師'), ('老师'), ('教師'), ('教师'),
    ('Teacher'), ('Educator'),
    ('先生'),  -- 先生 in Japanese context = teacher
    ('선생님'), ('교사'),
    ('Profesor'), ('Profesora'), ('Maestro'), ('Maestra'),
    ('Professor'), ('Professora'),
    ('Enseignant'), ('Enseignante'),
    ('Insegnante'),
    ('Lehrer'), ('Lehrerin'),
    ('Учитель'), ('Преподаватель'),
    ('مدرس'), ('معلم'), ('معلمة'),
    ('शिक्षक'), ('अध्यापक'),
    ('শিক্ষক'),
    ('ครู'), ('อาจารย์'),
    ('Öğretmen'),
    ('استاد'), ('ٹیچر'),
    ('Giáo viên'), ('Thầy giáo'), ('Cô giáo'),
    ('Guru')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── CEO / Chief Executive ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('CEO', '執行長', '总裁', '总经理') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('CEO', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('CEO'),
    ('執行長'), ('总裁'), ('总经理'), ('總經理'), ('总裁'),
    ('Chief Executive Officer'), ('Chief Executive'),
    ('最高経営責任者'), ('社長'),
    ('최고경영자'), ('대표이사'), ('대표'),
    ('Director Ejecutivo'), ('Directora Ejecutiva'),
    ('Diretor Executivo'), ('Diretora Executiva'),
    ('PDG'), ('Président-directeur général'), ('Directeur Général'),
    ('Amministratore Delegato'), ('AD'),
    ('Geschäftsführer'), ('Geschäftsführerin'), ('Vorstandsvorsitzender'),
    ('Генеральный директор'), ('Гендиректор'),
    ('الرئيس التنفيذي'), ('المدير التنفيذي'),
    ('मुख्य कार्यकारी अधिकारी'), ('सीईओ'),
    ('প্রধান নির্বাহী'),
    ('ซีอีโอ'), ('ประธานเจ้าหน้าที่บริหาร'),
    ('Genel Müdür'), ('Üst Yönetici'),
    ('سی ای او'),
    ('Giám đốc điều hành'), ('Tổng giám đốc'),
    ('Direktur Utama')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Founder / Co-founder ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Founder', '創辦人', '创始人') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Founder', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('創辦人'), ('创始人'), ('共同創辦人'), ('联合创始人'),
    ('Founder'), ('Co-founder'), ('Cofounder'), ('Co-Founder'),
    ('創業者'), ('共同創業者'), ('ファウンダー'),
    ('창업자'), ('공동 창업자'), ('공동창업자'),
    ('Fundador'), ('Fundadora'), ('Cofundador'), ('Cofundadora'),
    ('Fondateur'), ('Fondatrice'), ('Cofondateur'),
    ('Fondatore'), ('Fondatrice'), ('Cofondatore'),
    ('Gründer'), ('Gründerin'), ('Mitgründer'),
    ('Основатель'), ('Сооснователь'),
    ('مؤسس'), ('شريك مؤسس'),
    ('संस्थापक'), ('सह-संस्थापक'),
    ('প্রতিষ্ঠাতা'), ('সহ-প্রতিষ্ঠাতা'),
    ('ผู้ก่อตั้ง'), ('ผู้ร่วมก่อตั้ง'),
    ('Kurucu'), ('Kurucu Ortak'),
    ('بانی'), ('شریک بانی'),
    ('Người sáng lập'), ('Đồng sáng lập'),
    ('Pendiri'), ('Pendiri Bersama')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Product Manager ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Product Manager', '產品經理', '产品经理', 'PdM') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Product Manager', 'career') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    -- "PM" is intentionally NOT here — it lives on the Project Manager
    -- concept already and is ambiguous in TW tech parlance.
    ('產品經理'), ('产品经理'),
    ('Product Manager'), ('PdM'),
    ('プロダクトマネージャー'),
    ('프로덕트 매니저'), ('프로덕트매니저'),
    ('Gerente de Producto'), ('Gerente de Productos'),
    ('Gerente de Produto'),
    ('Chef de produit'),
    ('Product Manager'),  -- en/it/de same
    ('Produktmanager'),
    ('Продакт-менеджер'), ('Менеджер продукта'),
    ('مدير المنتج'),
    ('प्रोडक्ट मैनेजर'),
    ('পণ্য ব্যবস্থাপক'),
    ('ผู้จัดการผลิตภัณฑ์'),
    ('Ürün Yöneticisi'),
    ('پروڈکٹ مینیجر'),
    ('Quản lý sản phẩm'),
    ('Manajer Produk')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- INTERESTS / HOBBIES
-- ═══════════════════════════════════════════════════════════════

-- ── Coffee ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Coffee', '咖啡') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Coffee', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('咖啡'),
    ('Coffee'), ('Cafe'), ('Café'),
    ('コーヒー'), ('カフェ'), ('珈琲'),
    ('커피'),
    ('Café'), -- es/pt/fr — same spelling, ON CONFLICT handles
    ('Caffè'),
    ('Kaffee'),
    ('Кофе'),
    ('قهوة'),
    ('कॉफ़ी'),
    ('কফি'),
    ('กาแฟ'),
    ('Kahve'),
    ('کافی'),
    ('Cà phê'),
    ('Kopi')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Yoga ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Yoga', '瑜伽') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Yoga', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('瑜伽'), ('瑜珈'),
    ('Yoga'),
    ('ヨガ'),
    ('요가'),
    ('Ioga'),  -- pt sometimes spells as Ioga
    ('Йога'),
    ('يوغا'),
    ('योग'), ('योगा'),
    ('যোগ'), ('যোগব্যায়াম'),
    ('โยคะ'),
    ('یوگا'),
    ('Yô-ga')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Fitness / Gym ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Fitness', '健身', 'Gym') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Fitness', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('健身'), ('健身房'), ('重訓'), ('重训'),
    ('Fitness'), ('Gym'), ('Workout'), ('Working out'),
    ('フィットネス'), ('ジム'), ('筋トレ'),
    ('헬스'), ('피트니스'), ('운동'),
    ('Gimnasio'), ('Entrenamiento'),
    ('Academia'), ('Ginásio'),
    ('Musculation'),
    ('Palestra'), ('Allenamento'),
    ('Krafttraining'),
    ('Фитнес'), ('Спортзал'), ('Тренировка'),
    ('لياقة بدنية'), ('جيم'),
    ('फिटनेस'), ('जिम'),
    ('ফিটনেস'), ('জিম'),
    ('ฟิตเนส'), ('ออกกำลังกาย'),
    ('Spor salonu'),
    ('فٹنس'), ('جم'),
    ('Tập gym'), ('Thể hình'),
    ('Olahraga')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Running ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Running', '跑步') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Running', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('跑步'), ('慢跑'), ('路跑'),
    ('Running'), ('Jogging'),
    ('ランニング'), ('ジョギング'),
    ('달리기'), ('러닝'), ('조깅'),
    ('Correr'), ('Carrera'),
    ('Corrida'),
    ('Course'), ('Course à pied'),
    ('Correre'), ('Corsa'),
    ('Laufen'), ('Joggen'),
    ('Бег'), ('Пробежка'),
    ('جري'), ('ركض'),
    ('दौड़ना'), ('दौड़'),
    ('দৌড়'),
    ('วิ่ง'),
    ('Koşu'),
    ('دوڑنا'),
    ('Chạy bộ'),
    ('Lari')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Hiking ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Hiking', '登山', '爬山') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Hiking', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('登山'), ('爬山'), ('健行'),
    ('Hiking'), ('Mountain climbing'), ('Trekking'),
    ('ハイキング'), ('トレッキング'),
    ('등산'), ('하이킹'),
    ('Senderismo'), ('Excursionismo'),
    ('Caminhada'), ('Trilha'),
    ('Randonnée'),
    ('Escursionismo'),
    ('Wandern'), ('Bergsteigen'),
    ('Походы'), ('Альпинизм'),
    ('المشي لمسافات طويلة'),
    ('ट्रेकिंग'), ('हाइकिंग'),
    ('ট্রেকিং'),
    ('เดินป่า'), ('ปีนเขา'),
    ('Doğa yürüyüşü'),
    ('ٹریکنگ'),
    ('Đi bộ đường dài'), ('Leo núi'),
    ('Mendaki')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Music ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Music', '音樂', '音乐') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Music', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('音樂'), ('音乐'),
    ('Music'),
    ('音楽'),
    ('음악'),
    ('Música'),
    ('Musique'),
    ('Musica'),
    ('Musik'),
    ('Музыка'),
    ('موسيقى'),
    ('संगीत'),
    ('সঙ্গীত'), ('সংগীত'),
    ('ดนตรี'), ('เพลง'),
    ('Müzik'),
    ('موسیقی'),
    ('Âm nhạc'), ('Nhạc')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Reading ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Reading', '閱讀', '阅读') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Reading', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('閱讀'), ('阅读'), ('看書'), ('看书'),
    ('Reading'),
    ('読書'),
    ('독서'), ('책 읽기'),
    ('Lectura'), ('Leer'),
    ('Leitura'), ('Ler'),
    ('Lecture'), ('Lire'),
    ('Lettura'), ('Leggere'),
    ('Lesen'),
    ('Чтение'),
    ('قراءة'),
    ('पढ़ना'), ('अध्ययन'),
    ('পড়া'),
    ('อ่านหนังสือ'), ('การอ่าน'),
    ('Okuma'), ('Kitap okumak'),
    ('مطالعہ'),
    ('Đọc sách'),
    ('Membaca')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Cooking ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Cooking', '烹飪', '烹饪', '料理') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Cooking', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('烹飪'), ('烹饪'), ('煮飯'), ('煮饭'), ('做菜'),
    ('Cooking'),
    ('料理'),
    ('요리'),
    ('Cocinar'), ('Cocina'),
    ('Culinária'), ('Cozinhar'),
    ('Cuisine'), ('Cuisiner'),
    ('Cucinare'), ('Cucina'),
    ('Kochen'),
    ('Готовка'), ('Кулинария'),
    ('طبخ'),
    ('खाना पकाना'), ('रसोई'),
    ('রান্না'),
    ('ทำอาหาร'), ('ทำกับข้าว'),
    ('Yemek pişirme'),
    ('کھانا پکانا'),
    ('Nấu ăn'),
    ('Memasak')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Travel ──
-- An existing concept already groups `traveler / 旅行` per the
-- earlier audit. This block uses 旅行 as anchor and attaches more
-- variants if found, or creates a new concept if not.
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Travel', '旅行', 'traveler', '旅遊') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Travel', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('旅行'), ('旅遊'), ('旅游'), ('出國'), ('出国'),
    ('Travel'), ('Traveler'), ('Traveller'), ('Travelling'), ('Traveling'),
    ('旅'),
    ('여행'),
    ('Viaje'), ('Viajar'), ('Viajero'),
    ('Viagem'), ('Viajar'),
    ('Voyage'), ('Voyager'),
    ('Viaggio'), ('Viaggiare'),
    ('Reisen'), ('Reise'),
    ('Путешествие'), ('Путешествия'),
    ('سفر'), ('السفر'),
    ('यात्रा'),
    ('ভ্রমণ'),
    ('ท่องเที่ยว'), ('การเดินทาง'),
    ('Seyahat'), ('Gezi'),
    ('Du lịch'),
    ('Wisata'), ('Jalan-jalan')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- TECH / BUSINESS
-- ═══════════════════════════════════════════════════════════════

-- ── AI / Artificial Intelligence ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('AI', 'Artificial Intelligence', '人工智慧', '人工智能') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Artificial Intelligence', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('AI'), ('Artificial Intelligence'),
    ('人工智慧'), ('人工智能'),
    ('Machine Learning'), ('ML'),
    ('機器學習'), ('机器学习'),
    ('人工知能'),
    ('인공지능'),
    ('Inteligencia Artificial'),
    ('Inteligência Artificial'),
    ('Intelligence Artificielle'),
    ('Intelligenza Artificiale'),
    ('Künstliche Intelligenz'),
    ('Искусственный интеллект'), ('ИИ'),
    ('ذكاء اصطناعي'),
    ('कृत्रिम बुद्धिमत्ता'),
    ('কৃত্রিম বুদ্ধিমত্তা'),
    ('ปัญญาประดิษฐ์'),
    ('Yapay Zeka'),
    ('مصنوعی ذہانت'),
    ('Trí tuệ nhân tạo'),
    ('Kecerdasan Buatan')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ── Startup ──
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT concept_id INTO v_id FROM public.tag_aliases
    WHERE alias IN ('Startup', '新創', '创业') LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Startup', 'interest') RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_id FROM (VALUES
    ('Startup'), ('Start-up'),
    ('新創'), ('新创'), ('創業'), ('创业'),
    ('スタートアップ'), ('起業'),
    ('스타트업'), ('창업'),
    ('Emprendimiento'), ('Empresa emergente'),
    ('Empreendedorismo'),
    ('Entreprise en démarrage'),
    ('Стартап'),
    ('شركة ناشئة'),
    ('स्टार्टअप'),
    ('স্টার্টআপ'),
    ('สตาร์ทอัพ'),
    ('Girişim'),
    ('سٹارٹ اپ'),
    ('Khởi nghiệp')
  ) AS v(alias) ON CONFLICT (alias) DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- (End of iconic seeds)
-- ═══════════════════════════════════════════════════════════════
