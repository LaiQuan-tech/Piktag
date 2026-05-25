-- Seed aliases for 4 new languages: Korean, Indonesian, Thai, Turkish
-- Added to existing concepts

-- 1. Project Management
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Project Management';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('프로젝트 관리', cid, 'ko'),
      ('Manajemen Proyek', cid, 'id'),
      ('การจัดการโครงการ', cid, 'th'),
      ('Proje Yönetimi', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 2. Entrepreneur
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Entrepreneur';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('창업', cid, 'ko'),
      ('창업가', cid, 'ko'),
      ('기업가', cid, 'ko'),
      ('스타트업', cid, 'ko'),
      ('Wirausaha', cid, 'id'),
      ('Pengusaha', cid, 'id'),
      ('Startup', cid, 'id'),
      ('ผู้ประกอบการ', cid, 'th'),
      ('สตาร์ทอัพ', cid, 'th'),
      ('Girişimci', cid, 'tr'),
      ('Kurucu', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 3. Software Engineer
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Software Engineer';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('소프트웨어 엔지니어', cid, 'ko'),
      ('개발자', cid, 'ko'),
      ('프로그래머', cid, 'ko'),
      ('Insinyur Perangkat Lunak', cid, 'id'),
      ('Pengembang', cid, 'id'),
      ('Programmer', cid, 'id'),
      ('วิศวกรซอฟต์แวร์', cid, 'th'),
      ('นักพัฒนา', cid, 'th'),
      ('Yazılım Mühendisi', cid, 'tr'),
      ('Geliştirici', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 4. Design
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Design';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('디자인', cid, 'ko'),
      ('디자이너', cid, 'ko'),
      ('Desain', cid, 'id'),
      ('Desainer', cid, 'id'),
      ('การออกแบบ', cid, 'th'),
      ('นักออกแบบ', cid, 'th'),
      ('Tasarım', cid, 'tr'),
      ('Tasarımcı', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 5. Marketing
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Marketing';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('마케팅', cid, 'ko'),
      ('Pemasaran', cid, 'id'),
      ('การตลาด', cid, 'th'),
      ('Pazarlama', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 6. Photography
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Photography';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('사진', cid, 'ko'),
      ('사진작가', cid, 'ko'),
      ('Fotografi', cid, 'id'),
      ('Fotografer', cid, 'id'),
      ('การถ่ายภาพ', cid, 'th'),
      ('ช่างภาพ', cid, 'th'),
      ('Fotoğrafçılık', cid, 'tr'),
      ('Fotoğrafçı', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 7. AI
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Artificial Intelligence';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('인공지능', cid, 'ko'),
      ('머신러닝', cid, 'ko'),
      ('Kecerdasan Buatan', cid, 'id'),
      ('ปัญญาประดิษฐ์', cid, 'th'),
      ('Yapay Zeka', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 8. Investment
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Investment';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('투자', cid, 'ko'),
      ('투자자', cid, 'ko'),
      ('벤처캐피탈', cid, 'ko'),
      ('Investasi', cid, 'id'),
      ('Investor', cid, 'id'),
      ('การลงทุน', cid, 'th'),
      ('นักลงทุน', cid, 'th'),
      ('Yatırım', cid, 'tr'),
      ('Yatırımcı', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 9. Coffee
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Coffee';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('커피', cid, 'ko'),
      ('Kopi', cid, 'id'),
      ('กาแฟ', cid, 'th'),
      ('Kahve', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 10. Yoga
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Yoga';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('요가', cid, 'ko'),
      ('โยคะ', cid, 'th'),
      ('Yoga', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 11. Cooking
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Cooking';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('요리', cid, 'ko'),
      ('셰프', cid, 'ko'),
      ('Memasak', cid, 'id'),
      ('Koki', cid, 'id'),
      ('ทำอาหาร', cid, 'th'),
      ('เชฟ', cid, 'th'),
      ('Yemek', cid, 'tr'),
      ('Aşçı', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 12. Music
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Music';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('음악', cid, 'ko'),
      ('뮤지션', cid, 'ko'),
      ('Musik', cid, 'id'),
      ('Musisi', cid, 'id'),
      ('ดนตรี', cid, 'th'),
      ('นักดนตรี', cid, 'th'),
      ('Müzik', cid, 'tr'),
      ('Müzisyen', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 13. Travel
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Travel';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('여행', cid, 'ko'),
      ('Perjalanan', cid, 'id'),
      ('Wisata', cid, 'id'),
      ('ท่องเที่ยว', cid, 'th'),
      ('การเดินทาง', cid, 'th'),
      ('Seyahat', cid, 'tr'),
      ('Gezi', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 14. Privacy
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Privacy';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('개인정보', cid, 'ko'),
      ('프라이버시', cid, 'ko'),
      ('Privasi', cid, 'id'),
      ('ความเป็นส่วนตัว', cid, 'th'),
      ('Gizlilik', cid, 'tr'),
      ('Kişisel Veri', cid, 'tr')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;

-- 15. Mazu
DO $$
DECLARE cid uuid;
BEGIN
  SELECT id INTO cid FROM tag_concepts WHERE canonical_name = 'Mazu';
  IF cid IS NOT NULL THEN
    INSERT INTO tag_aliases (alias, concept_id, language) VALUES
      ('마주', cid, 'ko'),
      ('มาจู่', cid, 'th')
    ON CONFLICT (alias) DO NOTHING;
  END IF;
END $$;
