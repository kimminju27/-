-- =============================================
-- bloginfo360.com 체험단 검색 사이트 DB 스키마
-- Supabase SQL Editor에서 전체 실행 (재실행 안전)
-- =============================================

-- 1. platforms 테이블
CREATE TABLE IF NOT EXISTS platforms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  badge_color TEXT DEFAULT '#6366f1',
  crawler_type TEXT DEFAULT 'html_parser',
  crawler_config JSONB DEFAULT '{}',
  crawl_interval_minutes INTEGER DEFAULT 60,
  last_crawled_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. campaigns 테이블
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  platform_id UUID REFERENCES platforms(id) ON DELETE SET NULL,
  platform_name TEXT NOT NULL,
  title TEXT NOT NULL,
  campaign_url TEXT NOT NULL,
  campaign_type TEXT DEFAULT '블로그',
  applicants INTEGER DEFAULT 0,
  capacity INTEGER,
  deadline_text TEXT,
  content_hash TEXT UNIQUE,
  crawled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(is_active, crawled_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_platform ON campaigns(platform_name);
CREATE INDEX IF NOT EXISTS idx_campaigns_type ON campaigns(campaign_type);
CREATE INDEX IF NOT EXISTS idx_campaigns_fts ON campaigns USING gin(to_tsvector('simple', title));

-- 3. search_logs 테이블
CREATE TABLE IF NOT EXISTS search_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL,
  searched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_keyword ON search_logs(keyword);
CREATE INDEX IF NOT EXISTS idx_search_date ON search_logs(searched_at DESC);

-- 인기 검색어 뷰 (최근 7일)
CREATE OR REPLACE VIEW popular_keywords AS
  SELECT keyword, COUNT(*) as count
  FROM search_logs
  WHERE searched_at > NOW() - INTERVAL '7 days'
  GROUP BY keyword
  ORDER BY count DESC
  LIMIT 50;

-- 4. visitor_stats 테이블
CREATE TABLE IF NOT EXISTS visitor_stats (
  date DATE PRIMARY KEY,
  visit_count INTEGER DEFAULT 0
);

-- 방문자 증가 함수
CREATE OR REPLACE FUNCTION increment_visitor()
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO visitor_stats (date, visit_count)
  VALUES (CURRENT_DATE, 1)
  ON CONFLICT (date)
  DO UPDATE SET visit_count = visitor_stats.visit_count + 1;
$$;

-- =============================================
-- RLS (Row Level Security) 설정
-- =============================================

ALTER TABLE platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_stats ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제 후 재생성 (재실행 안전)
DROP POLICY IF EXISTS "platforms_public_read" ON platforms;
DROP POLICY IF EXISTS "campaigns_public_read" ON campaigns;
DROP POLICY IF EXISTS "search_logs_public_insert" ON search_logs;
DROP POLICY IF EXISTS "search_logs_public_read" ON search_logs;
DROP POLICY IF EXISTS "visitor_stats_public_insert" ON visitor_stats;
DROP POLICY IF EXISTS "visitor_stats_public_update" ON visitor_stats;
DROP POLICY IF EXISTS "visitor_stats_public_read" ON visitor_stats;

CREATE POLICY "platforms_public_read" ON platforms
  FOR SELECT USING (is_active = TRUE);

CREATE POLICY "campaigns_public_read" ON campaigns
  FOR SELECT USING (is_active = TRUE);

CREATE POLICY "search_logs_public_insert" ON search_logs
  FOR INSERT WITH CHECK (true);
CREATE POLICY "search_logs_public_read" ON search_logs
  FOR SELECT USING (true);

CREATE POLICY "visitor_stats_public_insert" ON visitor_stats
  FOR INSERT WITH CHECK (true);
CREATE POLICY "visitor_stats_public_update" ON visitor_stats
  FOR UPDATE USING (true);
CREATE POLICY "visitor_stats_public_read" ON visitor_stats
  FOR SELECT USING (true);

-- =============================================
-- 37개 플랫폼 초기 데이터 (수정된 명칭)
-- =============================================

INSERT INTO platforms (name, url, badge_color, crawler_type) VALUES
  ('어포스푼',          'https://m.blog.naver.com/aspooncj',          '#f97316', 'rss'),
  ('원더블',            'https://blog.naver.com/wonderble',            '#8b5cf6', 'rss'),
  ('미블',              'https://www.mrblog.net/',                     '#3b82f6', 'html_parser'),
  ('디너의여왕',        'https://dinnerqueen.net/',                    '#ec4899', 'html_parser'),
  ('아싸뷰',            'https://assaview.co.kr/',                     '#10b981', 'html_parser'),
  ('리뷰노트',          'https://www.reviewnote.co.kr/',               '#f59e0b', 'html_parser'),
  ('리얼리뷰',          'https://www.real-review.kr/',                 '#6366f1', 'html_parser'),
  ('투잡커넥트',        'https://www.tojobcn.com/',                    '#ef4444', 'html_parser'),
  ('블로그체험단',      'https://xn--939au0g4vj8sq.net/',             '#14b8a6', 'html_parser'),
  ('티블',              'https://www.tble.kr/',                        '#f97316', 'html_parser'),
  ('링블',              'https://www.ringble.co.kr/index_mobile.php', '#8b5cf6', 'html_parser'),
  ('클라우드리뷰',      'https://cloudreview.co.kr/',                  '#3b82f6', 'html_parser'),
  ('서울오빠',          'https://www.seoulouba.co.kr/',                '#ec4899', 'html_parser'),
  ('위리뷰',            'https://www.wereview.fun/',                   '#10b981', 'html_parser'),
  ('블로그체험',        'https://xn--5y2bw0fi0u.kr/',                  '#f59e0b', 'html_parser'),
  ('리뷰쉐어',          'https://reviewshare.io/',                     '#6366f1', 'html_parser'),
  ('체험단',            'https://chehumdan.com/',                      '#ef4444', 'html_parser'),
  ('컴투플레이',        'https://www.cometoplay.kr/index.php',         '#14b8a6', 'html_parser'),
  ('스토리엔',          'https://storyn.kr/index.php',                 '#f97316', 'html_parser'),
  ('모단',              'https://www.modan.kr/',                       '#8b5cf6', 'html_parser'),
  ('체뷰',              'https://chvu.co.kr/',                         '#3b82f6', 'html_parser'),
  ('4블로그',           'https://4blog.net/',                          '#ec4899', 'html_parser'),
  ('캐시노트인플루언서','https://place.cashnote.kr/influence',         '#10b981', 'html_parser'),
  ('덩덩뷰',            'https://www.dengdengview.co.kr/index.php',    '#f59e0b', 'html_parser'),
  ('태그바이',          'https://tagby.io/',                           '#6366f1', 'html_parser'),
  ('레뷰',              'https://www.revu.net/',                       '#ef4444', 'html_parser'),
  ('체험단모음',        'https://xn--o39a04kpnjo4k9hgflp.com/',       '#14b8a6', 'html_parser'),
  ('파블로체험',        'https://pavlovu.com/index.php',               '#f97316', 'html_parser'),
  ('리뷰팅',            'https://www.reviewting.net/index.php',        '#8b5cf6', 'html_parser'),
  ('가보자체험단',      'https://xn--vk1bn0kvydxrlprb.com/',          '#3b82f6', 'html_parser'),
  ('리뷰진',            'https://reviewjin.com/',                      '#ec4899', 'html_parser'),
  ('포블로그',          'https://www.from-blog.com/',                  '#10b981', 'html_parser'),
  ('리뷰플레이스',      'https://www.reviewplace.co.kr/',              '#f59e0b', 'html_parser'),
  ('리뷰의민족',        'https://remin.co.kr/',                        '#6366f1', 'html_parser'),
  ('블로그랩',          'https://bloglab.kr/index.php',                '#ef4444', 'html_parser'),
  ('메타체험단',        'https://meta-chehumdan.com/index.php',        '#14b8a6', 'html_parser'),
  ('오마이블로그',      'https://www.ohmyblog.co.kr/',                 '#f97316', 'html_parser')
ON CONFLICT (name) DO NOTHING;
