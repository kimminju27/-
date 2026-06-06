<?php get_header(); ?>

<?php while (have_posts()) : the_post();
  $campaign_url  = get_post_meta(get_the_ID(), 'campaign_url', true);
  $channel       = get_post_meta(get_the_ID(), 'channel', true) ?: '블로그';
  $delivery_type = get_post_meta(get_the_ID(), 'delivery_type', true);
  $capacity      = get_post_meta(get_the_ID(), 'capacity', true);
  $deadline_text = get_post_meta(get_the_ID(), 'deadline_text', true);
  $platform_name = get_post_meta(get_the_ID(), 'platform_name', true);
  $channelEmoji  = ['블로그'=>'📝','인스타'=>'📸','릴스'=>'🎞','유튜브'=>'▶','클립'=>'📎'][$channel] ?? '📋';
?>

<main class="max-w-2xl mx-auto px-4 py-10">
  <a href="<?php echo home_url('/'); ?>" class="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-indigo-600 mb-6 transition-colors">
    ← 목록으로 돌아가기
  </a>

  <article class="bg-white rounded-3xl border border-slate-100 p-8 shadow-sm">
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-600"><?php echo $channelEmoji . ' ' . esc_html($channel); ?></span>
      <?php if ($delivery_type) : ?>
        <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500"><?php echo esc_html($delivery_type); ?></span>
      <?php endif; ?>
      <?php if ($platform_name) : ?>
        <span class="px-2.5 py-1 rounded-full text-xs bg-slate-50 text-slate-400 border border-slate-100"><?php echo esc_html($platform_name); ?></span>
      <?php endif; ?>
    </div>

    <h1 class="text-xl font-black text-slate-900 leading-snug mb-6"><?php the_title(); ?></h1>

    <div class="grid grid-cols-2 gap-3 mb-6 text-sm">
      <?php if ($capacity) : ?>
        <div class="bg-indigo-50 rounded-xl p-3 text-center">
          <div class="text-xs text-slate-400 mb-0.5">모집 인원</div>
          <div class="font-black text-indigo-600"><?php echo esc_html($capacity); ?>명</div>
        </div>
      <?php endif; ?>
      <?php if ($deadline_text) : ?>
        <div class="bg-amber-50 rounded-xl p-3 text-center">
          <div class="text-xs text-slate-400 mb-0.5">신청 마감</div>
          <div class="font-black text-amber-600"><?php echo esc_html($deadline_text); ?></div>
        </div>
      <?php endif; ?>
    </div>

    <?php if ($campaign_url && $campaign_url !== '#') : ?>
      <a href="<?php echo esc_url($campaign_url); ?>" target="_blank" rel="noopener noreferrer"
        class="block w-full text-center text-white font-black py-4 rounded-2xl text-base hover:opacity-90 active:scale-95 transition-all"
        style="background:linear-gradient(135deg,#6366f1,#4f46e5);">
        신청하러 가기 →
      </a>
      <p class="text-center text-xs text-slate-400 mt-3">해당 체험단 플랫폼으로 이동합니다</p>
    <?php endif; ?>
  </article>
</main>

<?php endwhile; ?>

<?php get_footer(); ?>
