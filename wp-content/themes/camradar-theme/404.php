<?php get_header(); ?>

<main class="max-w-2xl mx-auto px-4 py-24 text-center">
  <div class="text-6xl mb-4">📡</div>
  <h1 class="text-2xl font-black text-slate-900 mb-2">페이지를 찾을 수 없어요</h1>
  <p class="text-slate-400 text-sm mb-8">요청하신 페이지가 존재하지 않거나 이동되었습니다.</p>
  <a href="<?php echo home_url('/'); ?>"
    class="inline-block px-8 py-3 rounded-xl text-white font-bold text-sm hover:opacity-90 transition-all"
    style="background:#4f46e5;">
    홈으로 돌아가기
  </a>
</main>

<?php get_footer(); ?>
