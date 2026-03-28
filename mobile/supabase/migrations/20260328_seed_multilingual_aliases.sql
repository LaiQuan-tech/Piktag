-- Seed multilingual aliases for common tag concepts
-- Languages: en, zh-TW, zh-CN, hi, es, ar

-- Helper: insert concept if not exists, then add multilingual aliases
-- Each DO block handles one concept

-- ============================================================
-- 1. Project Management / 專案管理
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Project Management', 'skill')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'skill'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Project Management', cid, 'en'),
    ('PM', cid, 'en'),
    ('專案管理', cid, 'zh-TW'),
    ('項目管理', cid, 'zh-TW'),
    ('项目管理', cid, 'zh-CN'),
    ('प्रोजेक्ट प्रबंधन', cid, 'hi'),
    ('Gestión de proyectos', cid, 'es'),
    ('إدارة المشاريع', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 2. Entrepreneur / 創業
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Entrepreneur', 'identity')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'identity'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Entrepreneur', cid, 'en'),
    ('Startup', cid, 'en'),
    ('Founder', cid, 'en'),
    ('創業', cid, 'zh-TW'),
    ('創業者', cid, 'zh-TW'),
    ('創業家', cid, 'zh-TW'),
    ('创业', cid, 'zh-CN'),
    ('创业者', cid, 'zh-CN'),
    ('उद्यमी', cid, 'hi'),
    ('Emprendedor', cid, 'es'),
    ('ريادي', cid, 'ar'),
    ('رائد أعمال', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 3. Software Engineer / 軟體工程師
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Software Engineer', 'identity')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'identity'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Software Engineer', cid, 'en'),
    ('Developer', cid, 'en'),
    ('Programmer', cid, 'en'),
    ('SWE', cid, 'en'),
    ('軟體工程師', cid, 'zh-TW'),
    ('工程師', cid, 'zh-TW'),
    ('程式設計師', cid, 'zh-TW'),
    ('软件工程师', cid, 'zh-CN'),
    ('程序员', cid, 'zh-CN'),
    ('सॉफ्टवेयर इंजीनियर', cid, 'hi'),
    ('Ingeniero de software', cid, 'es'),
    ('مهندس برمجيات', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 4. Design / 設計
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Design', 'skill')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'skill'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Design', cid, 'en'),
    ('Designer', cid, 'en'),
    ('UI Design', cid, 'en'),
    ('UX Design', cid, 'en'),
    ('設計', cid, 'zh-TW'),
    ('設計師', cid, 'zh-TW'),
    ('设计', cid, 'zh-CN'),
    ('设计师', cid, 'zh-CN'),
    ('डिज़ाइन', cid, 'hi'),
    ('Diseño', cid, 'es'),
    ('تصميم', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 5. Marketing / 行銷
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Marketing', 'skill')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'skill'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Marketing', cid, 'en'),
    ('Digital Marketing', cid, 'en'),
    ('行銷', cid, 'zh-TW'),
    ('數位行銷', cid, 'zh-TW'),
    ('营销', cid, 'zh-CN'),
    ('市场营销', cid, 'zh-CN'),
    ('मार्केटिंग', cid, 'hi'),
    ('Marketing', cid, 'es'),
    ('تسويق', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 6. Photography / 攝影
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Photography', 'interest')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'interest'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Photography', cid, 'en'),
    ('Photographer', cid, 'en'),
    ('攝影', cid, 'zh-TW'),
    ('攝影師', cid, 'zh-TW'),
    ('摄影', cid, 'zh-CN'),
    ('摄影师', cid, 'zh-CN'),
    ('फोटोग्राफी', cid, 'hi'),
    ('Fotografía', cid, 'es'),
    ('تصوير', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 7. AI / 人工智慧
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Artificial Intelligence', 'interest')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'interest'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Artificial Intelligence', cid, 'en'),
    ('AI', cid, 'en'),
    ('Machine Learning', cid, 'en'),
    ('ML', cid, 'en'),
    ('人工智慧', cid, 'zh-TW'),
    ('AI技術', cid, 'zh-TW'),
    ('人工智能', cid, 'zh-CN'),
    ('机器学习', cid, 'zh-CN'),
    ('कृत्रिम बुद्धिमत्ता', cid, 'hi'),
    ('Inteligencia artificial', cid, 'es'),
    ('IA', cid, 'es'),
    ('ذكاء اصطناعي', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 8. Investment / 投資
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Investment', 'interest')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'interest'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Investment', cid, 'en'),
    ('Investor', cid, 'en'),
    ('VC', cid, 'en'),
    ('Venture Capital', cid, 'en'),
    ('投資', cid, 'zh-TW'),
    ('投資人', cid, 'zh-TW'),
    ('投资', cid, 'zh-CN'),
    ('投资人', cid, 'zh-CN'),
    ('निवेश', cid, 'hi'),
    ('Inversión', cid, 'es'),
    ('استثمار', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 9. Coffee / 咖啡
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Coffee', 'interest')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'interest'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Coffee', cid, 'en'),
    ('Coffee Lover', cid, 'en'),
    ('咖啡', cid, 'zh-TW'),
    ('咖啡愛好者', cid, 'zh-TW'),
    ('咖啡', cid, 'zh-CN'),
    ('कॉफ़ी', cid, 'hi'),
    ('Café', cid, 'es'),
    ('قهوة', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 10. Mazu / 媽祖
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Mazu', 'interest')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'interest'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Mazu', cid, 'en'),
    ('媽祖', cid, 'zh-TW'),
    ('天上聖母', cid, 'zh-TW'),
    ('天后', cid, 'zh-TW'),
    ('妈祖', cid, 'zh-CN'),
    ('天上圣母', cid, 'zh-CN')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 11. Privacy / 個資 / 個人資料
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Privacy', 'interest')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'interest'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Privacy', cid, 'en'),
    ('Data Privacy', cid, 'en'),
    ('Personal Data', cid, 'en'),
    ('個資', cid, 'zh-TW'),
    ('個人資料', cid, 'zh-TW'),
    ('隱私', cid, 'zh-TW'),
    ('个人信息', cid, 'zh-CN'),
    ('隐私', cid, 'zh-CN'),
    ('गोपनीयता', cid, 'hi'),
    ('Privacidad', cid, 'es'),
    ('خصوصية', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 12. Yoga / 瑜伽
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Yoga', 'interest')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'interest'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Yoga', cid, 'en'),
    ('瑜伽', cid, 'zh-TW'),
    ('瑜珈', cid, 'zh-TW'),
    ('瑜伽', cid, 'zh-CN'),
    ('योग', cid, 'hi'),
    ('Yoga', cid, 'es'),
    ('يوغا', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 13. Cooking / 料理
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Cooking', 'interest')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'interest'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Cooking', cid, 'en'),
    ('Chef', cid, 'en'),
    ('料理', cid, 'zh-TW'),
    ('烹飪', cid, 'zh-TW'),
    ('廚師', cid, 'zh-TW'),
    ('烹饪', cid, 'zh-CN'),
    ('厨师', cid, 'zh-CN'),
    ('खाना बनाना', cid, 'hi'),
    ('Cocina', cid, 'es'),
    ('طبخ', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 14. Music / 音樂
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Music', 'interest')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'interest'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Music', cid, 'en'),
    ('Musician', cid, 'en'),
    ('音樂', cid, 'zh-TW'),
    ('音乐', cid, 'zh-CN'),
    ('संगीत', cid, 'hi'),
    ('Música', cid, 'es'),
    ('موسيقى', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;

-- ============================================================
-- 15. Travel / 旅行
-- ============================================================
DO $$
DECLARE cid uuid;
BEGIN
  INSERT INTO tag_concepts (canonical_name, semantic_type)
  VALUES ('Travel', 'interest')
  ON CONFLICT (canonical_name) DO UPDATE SET semantic_type = 'interest'
  RETURNING id INTO cid;

  INSERT INTO tag_aliases (alias, concept_id, language) VALUES
    ('Travel', cid, 'en'),
    ('Traveler', cid, 'en'),
    ('旅行', cid, 'zh-TW'),
    ('旅遊', cid, 'zh-TW'),
    ('旅行', cid, 'zh-CN'),
    ('旅游', cid, 'zh-CN'),
    ('यात्रा', cid, 'hi'),
    ('Viaje', cid, 'es'),
    ('سفر', cid, 'ar')
  ON CONFLICT (alias) DO NOTHING;
END $$;
