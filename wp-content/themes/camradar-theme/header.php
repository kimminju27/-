<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="naver-site-verification" content="8d911d2c19b710aba3ada77284691b9beee6e358">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<header class="sticky top-0 z-50 bg-white border-b border-slate-100" style="box-shadow:0 1px 4px rgba(0,0,0,0.06);">
  <div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
    <div class="flex items-center gap-6">
      <a href="<?php echo home_url('/'); ?>" class="flex items-center gap-2">
        <span class="text-xl">📡</span>
        <span class="text-lg font-black tracking-tight text-primary-600" style="color:#4f46e5;">캠레이더</span>
      </a>
      <nav class="hidden md:flex items-center gap-5 text-sm font-semibold text-slate-500">
        <a href="<?php echo home_url('/'); ?>" class="hover:text-slate-900 transition-colors <?php echo is_front_page() && !is_page('jache') ? 'text-indigo-600 font-bold' : ''; ?>">체험단 찾기</a>
        <a href="<?php echo home_url('/jache/'); ?>" class="hover:text-slate-900 transition-colors <?php echo is_page('jache') ? 'text-indigo-600 font-bold' : ''; ?>">자체 체험단</a>
        <a href="<?php echo home_url('/services/'); ?>" class="hover:text-slate-900 transition-colors <?php echo is_page('services') ? 'text-indigo-600 font-bold' : ''; ?>">서비스 신청</a>
      </nav>
    </div>
    <div class="flex items-center gap-4 text-sm">
      <?php if (is_user_logged_in()) :
        $current_user = wp_get_current_user();
        // display_name이 user_login과 같으면(자동생성 계정) 소셜 이름 우선
        $show_name = ($current_user->display_name && $current_user->display_name !== $current_user->user_login)
            ? $current_user->display_name
            : (get_user_meta($current_user->ID, 'nickname', true) ?: $current_user->user_login);
        ?>
        <a href="<?php echo home_url('/my-page/'); ?>" class="text-xs text-slate-500 hover:text-indigo-600 transition-colors hidden sm:inline font-semibold">
          <?php echo esc_html($show_name); ?>님 ▾
        </a>
        <a href="<?php echo home_url('/my-page/'); ?>" class="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl font-bold text-xs transition-colors border border-indigo-200">마이페이지</a>
        <a href="<?php echo wp_logout_url(home_url()); ?>" class="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold text-xs transition-colors">로그아웃</a>
      <?php else : ?>
        <a href="<?php echo home_url('/login/'); ?>" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs transition-colors">로그인 / 가입</a>
      <?php endif; ?>
    </div>
  </div>
</header>
