-- ============================================================
-- 캠레이더 확장 스키마 (HTML 템플릿과 100% 컬럼명 싱크 맞춤)
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

-- 1. 인플루언서 프로필
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  phone TEXT,
  phone_verified BOOLEAN DEFAULT false,
  is_admin BOOLEAN DEFAULT false,
  -- 네이버 블로그
  blog_url TEXT,
  blog_visitors INT,
  blog_fetched_at TIMESTAMPTZ,
  -- 인스타그램
  instagram_id TEXT,
  instagram_followers INT,
  instagram_fetched_at TIMESTAMPTZ,
  -- 유튜브
  youtube_url TEXT,
  youtube_subscribers INT,
  youtube_fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  -- 채널 1개 이상 필수: CHECK 제약 (blog_url OR instagram_id OR youtube_url)
  CONSTRAINT has_at_least_one_channel CHECK (
    blog_url IS NOT NULL OR instagram_id IS NOT NULL OR youtube_url IS NOT NULL
  )
);

-- 2. 캠레이더 자체 체험단 게시글
CREATE TABLE IF NOT EXISTS own_campaigns (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  channel TEXT,             -- '블로그', '인스타', '유튜브' (기존 campaign_type 대체)
  delivery_type TEXT,       -- '배송형', '방문형', '구매평'
  capacity INT,
  deadline_date DATE,       -- 마감일 (기존 deadline 대체)
  min_visitors INT DEFAULT 0,
  min_followers INT DEFAULT 0,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','closed','announced')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 체험단 신청
CREATE TABLE IF NOT EXISTS applications (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT REFERENCES own_campaigns(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  comment TEXT,             -- 지원동기/한줄어필 (기존 message 대체)
  status TEXT DEFAULT '대기' CHECK (status IN ('대기','선정','탈락')), -- 한국어 매칭
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(campaign_id, user_id)
);

-- 4. 사업자 서비스 신청
CREATE TABLE IF NOT EXISTS service_requests (
  id BIGSERIAL PRIMARY KEY,
  service_type TEXT NOT NULL, -- '블로그 관리대행', '블로그 체험단' 등
  company_name TEXT,
  manager_name TEXT NOT NULL, -- 담당자 성함 (contact_name 대체)
  contact_phone TEXT NOT NULL,-- 연락처 (contact_phone 대체)
  budget TEXT,
  requirements TEXT,          -- 요청 사항 (message 대체)
  status TEXT DEFAULT '접수' CHECK (status IN ('접수','완료')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================

-- profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_read_all" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);

-- own_campaigns
ALTER TABLE own_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_read_all" ON own_campaigns FOR SELECT USING (true);
CREATE POLICY "campaigns_admin_write" ON own_campaigns FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- applications
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "applications_insert_own" ON applications FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "applications_select_own_or_admin" ON applications FOR SELECT USING (
  auth.uid() = user_id OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "applications_admin_update" ON applications FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- service_requests
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_requests_anyone_insert" ON service_requests
  FOR INSERT WITH CHECK (true);
CREATE POLICY "service_requests_admin_read" ON service_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- ============================================================
-- DB Trigger: 회원가입 시 profiles 자동 생성
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, nickname, phone_verified)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'nickname',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
